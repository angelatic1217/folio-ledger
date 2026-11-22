import { describe, expect, it } from "vitest";
import { computePeriodPerformance } from "@/lib/quant/attribution";
import { buildForwardFilledBarMap, buildUnionTradingCalendar } from "@/lib/quant/calendar";
import { computeDrawdownSeries } from "@/lib/quant/drawdown";
import { runQuantEngine, sliceSeriesByRange } from "@/lib/quant/engine";
import { getCumulativeSplitFactorAfter, toSplitAdjustedShares } from "@/lib/quant/holdings";
import { computeDailySubperiodReturn, computeModifiedDietz } from "@/lib/quant/returns";
import type { MarketDataBundle } from "@/types/market";
import type { PortfolioSheetsData } from "@/types/sheet";

describe("Quant Engine: Core Financial Formulas", () => {
  it("computes exact day-weighted Modified Dietz return", () => {
    // 100-day window: V0 = 100,000; inflow of 50,000 on day 25 (weight = 0.75); V1 = 165,000
    // Gain = 165,000 - 100,000 - 50,000 = 15,000
    // Weighted Capital = 100,000 + 0.75 * 50,000 = 137,500
    // R = 15,000 / 137,500 = 0.1090909...
    const r = computeModifiedDietz({
      startDate: "2025-01-01",
      endDate: "2025-04-11", // exactly 100 days
      startValue: 100_000,
      endValue: 165_000,
      cashFlows: [{ date: "2025-01-26", amount: 50_000 }], // day 25
    });
    expect(r).toBeCloseTo(15_000 / 137_500, 6);
  });

  it("handles brand-new portfolio initial buy (V0 = 0) and full liquidation cleanly in Daily TWR", () => {
    // Day 1: V_prev = 0, buy 100k, closes at 102k (+2%)
    const r1 = computeDailySubperiodReturn({
      prevValue: 0,
      endValue: 102_000,
      inflow: 100_000,
      outflow: 0,
    });
    expect(r1).toBeCloseTo(0.02, 6);

    // Day 2: V_prev = 102k, sell everything at 107.1k (+5%), V_end = 0
    const r2 = computeDailySubperiodReturn({
      prevValue: 102_000,
      endValue: 0,
      inflow: 0,
      outflow: 107_100,
    });
    expect(r2).toBeCloseTo(0.05, 6);

    // Chained TWR = 1.02 * 1.05 - 1 = 7.1%
    expect((1 + r1) * (1 + r2) - 1).toBeCloseTo(0.071, 6);
  });

  it("handles cash dividend without losing total return on ex-dividend drop", () => {
    // Yesterday 100k; today drops to 97.5k + receives 2.5k cash dividend -> 0% net return
    const r = computeDailySubperiodReturn({
      prevValue: 100_000,
      endValue: 97_500,
      inflow: 0,
      outflow: 2_500,
    });
    expect(r).toBeCloseTo(0, 6);
  });

  it("aligns historical pre-split shares accurately (0050 1-for-4 split)", () => {
    const splits = [{ date: "2025-06-18", ratio: 4 }];
    expect(getCumulativeSplitFactorAfter("2024-03-15", splits)).toBe(4);
    expect(getCumulativeSplitFactorAfter("2025-06-18", splits)).toBe(1);
    expect(getCumulativeSplitFactorAfter("2025-07-01", splits)).toBe(1);

    const preSplitTx = {
      id: "1",
      date: "2024-03-15",
      symbol: "0050",
      type: "BUY" as const,
      shares: 1000,
      price: 180,
      fee: 0,
    };
    // 1000 pre-split shares * 4 = 4000 split-adjusted shares
    // Multiplied by Yahoo split-adjusted close (45 TWD) = 180,000 TWD exact!
    expect(toSplitAdjustedShares(preSplitTx, splits)).toBe(4000);
    expect(toSplitAdjustedShares(preSplitTx, splits) * 45).toBe(180_000);
  });

  it("computes MDD, peak/trough dates, recovery days, and current drawdown accurately", () => {
    const { summary } = computeDrawdownSeries([
      { date: "2025-01-01", value: 100 },
      { date: "2025-01-10", value: 120 }, // Peak 1
      { date: "2025-01-20", value: 96 },  // -20% trough
      { date: "2025-02-09", value: 120 }, // Full recovery (20 calendar days after trough)
      { date: "2025-02-20", value: 114 }, // Current drawdown = -5%
    ]);

    expect(summary.maxDrawdown).toBeCloseTo(-0.2, 6);
    expect(summary.maxDrawdownPeakDate).toBe("2025-01-10");
    expect(summary.maxDrawdownDate).toBe("2025-01-20");
    expect(summary.recoveryDays).toBe(20);
    expect(summary.currentDrawdown).toBeCloseTo(-0.05, 6);
    expect(summary.currentPeakDate).toBe("2025-02-09");
    expect(summary.currentDaysUnderwater).toBe(1);
  });

  it("ensures large inflows/outflows do NOT distort Portfolio TWR MDD or Underwater series", () => {
    // Stock price stays flat at 100 every day.
    // Day 1: Buy 1000 shares (100k)
    // Day 2: Sell 500 shares (50k outflow) -> market value drops 50%, but TWR & MDD MUST stay 0%!
    // Day 3: Buy 2000 shares (200k inflow) -> market value jumps 5x, TWR & MDD MUST stay 0%!
    const market: MarketDataBundle = {
      generatedAt: "2025-01-10",
      fxTicker: "TWD=X",
      fxBars: [
        { date: "2025-01-02", close: 32, adjClose: 32 },
        { date: "2025-01-03", close: 32, adjClose: 32 },
        { date: "2025-01-06", close: 32, adjClose: 32 },
      ],
      tickers: {
        "0050": {
          symbol: "0050",
          yahooTicker: "0050.TW",
          currency: "TWD",
          lastPrice: 100,
          lastDate: "2025-01-06",
          splits: [],
          bars: [
            { date: "2025-01-02", close: 100, adjClose: 100 },
            { date: "2025-01-03", close: 100, adjClose: 100 },
            { date: "2025-01-06", close: 100, adjClose: 100 },
          ],
        },
      },
    };

    const sheets: PortfolioSheetsData = {
      source: "demo",
      assets: [
        {
          symbol: "0050",
          name: "元大台灣50",
          market: "TW",
          currency: "TWD",
          yahooTicker: "0050.TW",
          monitorMdd: true,
        },
      ],
      transactions: [
        { id: "t1", date: "2025-01-02", symbol: "0050", type: "BUY", shares: 1000, price: 100, fee: 0 },
        { id: "t2", date: "2025-01-03", symbol: "0050", type: "SELL", shares: 500, price: 100, fee: 0 },
        { id: "t3", date: "2025-01-06", symbol: "0050", type: "BUY", shares: 2000, price: 100, fee: 0 },
      ],
      cashSnapshots: [],
      benchmarks: [],
    };

    const output = runQuantEngine(sheets, market);
    const { drawdownSummary, rangeTwr } = sliceSeriesByRange(output.investedSeries, "ALL");

    expect(rangeTwr).toBeCloseTo(0, 6);
    expect(drawdownSummary.maxDrawdown).toBeCloseTo(0, 6);
    expect(drawdownSummary.currentDrawdown).toBeCloseTo(0, 6);
    expect(output.totalInvestedValueTwd).toBe(250_000);
  });

  it("forward-fills TW/US holiday gaps and computes US FX Impact attribution accurately", () => {
    const market: MarketDataBundle = {
      generatedAt: "2025-01-10",
      fxTicker: "TWD=X",
      fxBars: [
        { date: "2025-01-02", close: 30, adjClose: 30 },
        { date: "2025-01-03", close: 31.5, adjClose: 31.5 }, // +5% USD appreciation
        { date: "2025-01-06", close: 33, adjClose: 33 },     // +10% USD appreciation vs Jan 2
      ],
      tickers: {
        VOO: {
          symbol: "VOO",
          yahooTicker: "VOO",
          currency: "USD",
          lastPrice: 550,
          lastDate: "2025-01-06",
          splits: [],
          bars: [
            { date: "2025-01-02", close: 500, adjClose: 500 },
            // Jan 3 missing (simulated holiday) -> should forward-fill 500
            { date: "2025-01-06", close: 550, adjClose: 550 }, // +10% local return
          ],
        },
      },
    };

    const calendar = buildUnionTradingCalendar(market);
    const filled = buildForwardFilledBarMap(market.tickers.VOO.bars, calendar);
    expect(filled.get("2025-01-03")?.close).toBe(500);

    const sheets: PortfolioSheetsData = {
      source: "demo",
      assets: [
        {
          symbol: "VOO",
          name: "Vanguard S&P 500",
          market: "US",
          currency: "USD",
          yahooTicker: "VOO",
          monitorMdd: true,
        },
      ],
      transactions: [
        { id: "1", date: "2025-01-02", symbol: "VOO", type: "BUY", shares: 10, price: 500, fee: 0, fxRate: 30 },
      ],
      cashSnapshots: [],
      benchmarks: [],
    };

    const output = runQuantEngine(sheets, market);
    const period = computePeriodPerformance({
      startDate: "2025-01-02",
      endDate: "2025-01-06",
      transactions: sheets.transactions,
      assets: sheets.assets,
      market,
      dailySeries: output.investedSeries,
      scope: "invested",
    });

    // Local return = +10%, FX return = +10% -> TWD return = 1.1 * 1.1 - 1 = +21%, FX impact = +11%
    expect(period.holdings[0].localReturn).toBeCloseTo(0.1, 6);
    expect(period.holdings[0].twdReturn).toBeCloseTo(0.21, 6);
    expect(period.holdings[0].fxImpact).toBeCloseTo(0.11, 6);
  });
});
