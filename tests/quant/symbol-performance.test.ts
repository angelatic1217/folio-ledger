import { describe, expect, it } from "vitest";
import { runQuantEngine } from "@/lib/quant/engine";
import { computeXirr } from "@/lib/quant/returns";
import { computeSubsetAggregateXirr } from "@/lib/quant/symbol-performance";
import type { MarketDataBundle } from "@/types/market";
import type { PortfolioSheetsData } from "@/types/sheet";

function generateLinearBars(
  startYear: number,
  days: number,
  startPrice: number,
  dailyGrowth: number
) {
  const bars = [];
  const startMs = Date.UTC(startYear, 0, 2);
  let price = startPrice;
  for (let i = 0; i < days; i++) {
    const dt = new Date(startMs + i * 86_400_000);
    // Skip weekends
    const dow = dt.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const date = dt.toISOString().slice(0, 10);
    bars.push({
      date,
      close: Number(price.toFixed(4)),
      adjClose: Number(price.toFixed(4)),
    });
    price *= 1 + dailyGrowth;
  }
  return bars;
}

describe("Symbol Performance & XIRR Engine", () => {
  it("computes exact XIRR for single-period, multi-cashflow, and guards < 30 day windows", () => {
    // Exact 1-year +10%
    const oneYear = computeXirr([
      { date: "2024-01-01", amount: -100_000 },
      { date: "2025-01-01", amount: 110_000 },
    ]);
    // 2024 is leap year (366 days), so (1.1)^(365/366) - 1 ≈ 0.099713
    expect(oneYear).not.toBeNull();
    expect(oneYear!).toBeCloseTo(Math.pow(1.1, 365 / 366) - 1, 5);

    // Non-leap year: exact 365 days -> exact 12%
    const exactNonLeap = computeXirr([
      { date: "2025-01-01", amount: -50_000 },
      { date: "2026-01-01", amount: 56_000 },
    ]);
    expect(exactNonLeap).toBeCloseTo(0.12, 6);

    // DCA two-tranche cashflow: verify NPV(xirr) == 0
    const dcaFlows = [
      { date: "2025-01-01", amount: -100_000 },
      { date: "2025-07-02", amount: -100_000 },
      { date: "2025-10-01", amount: 4_000 }, // dividend
      { date: "2026-01-01", amount: 225_000 },
    ];
    const dcaXirr = computeXirr(dcaFlows);
    expect(dcaXirr).not.toBeNull();
    expect(dcaXirr!).toBeGreaterThan(0.12);
    expect(dcaXirr!).toBeLessThan(0.25);

    // Too short (< 30 days) -> null
    const tooShort = computeXirr([
      { date: "2026-01-01", amount: -100_000 },
      { date: "2026-01-20", amount: 103_000 },
    ]);
    expect(tooShort).toBeNull();

    // Only outflows -> null
    expect(
      computeXirr([
        { date: "2025-01-01", amount: -10_000 },
        { date: "2026-01-01", amount: -10_000 },
      ])
    ).toBeNull();
  });

  it("handles 0050 1-for-4 split average cost, cash dividends breakeven, and DRIP", () => {
    const market: MarketDataBundle = {
      generatedAt: "2026-06-30",
      fxTicker: "TWD=X",
      fxBars: [
        { date: "2024-06-01", close: 32, adjClose: 32 },
        { date: "2025-06-18", close: 32, adjClose: 32 },
        { date: "2026-06-01", close: 32, adjClose: 32 },
      ],
      tickers: {
        "0050": {
          symbol: "0050",
          yahooTicker: "0050.TW",
          currency: "TWD",
          lastPrice: 55,
          lastDate: "2026-06-01",
          splits: [{ date: "2025-06-18", ratio: 4 }],
          bars: [
            { date: "2024-06-01", close: 45, adjClose: 43 },
            { date: "2025-06-18", close: 50, adjClose: 49 },
            { date: "2026-06-01", close: 55, adjClose: 55 },
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
        // Pre-split: 1000 shares @ 180 TWD -> 4000 split-adjusted shares, cost = 180,000 TWD (avg = 45.00)
        { id: "1", date: "2024-06-01", symbol: "0050", type: "BUY", shares: 1000, price: 180, fee: 0 },
        // Cash dividend: 12,000 TWD
        { id: "2", date: "2025-07-01", symbol: "0050", type: "DIVIDEND", shares: 4000, price: 3, fee: 0 },
        // Post-split DRIP: 200 shares @ 0 external cost -> total 4200 shares
        { id: "3", date: "2025-12-01", symbol: "0050", type: "DRIP", shares: 200, price: 50, fee: 0 },
      ],
      cashSnapshots: [],
      benchmarks: [],
    };

    const out = runQuantEngine(sheets, market);
    const row = out.symbolPerformance.find((r) => r.symbol === "0050")!;

    expect(row.status).toBe("held");
    expect(row.shares).toBe(4200);
    expect(row.dripShares).toBe(200);
    expect(row.costBasisTwd).toBe(180_000);
    // Split-adjusted + DRIP average cost: 180,000 / 4200 = 42.8571...
    expect(row.avgCostLocal).toBeCloseTo(180_000 / 4200, 4);
    // Breakeven price after 12,000 cash dividend: (180,000 - 12,000) / 4200 = 40.00
    expect(row.breakevenPriceLocal).toBeCloseTo(40, 4);
    // Market value: 4200 * 55 = 231,000; unrealized = +51,000; total incl div = +63,000
    expect(row.marketValueTwd).toBe(231_000);
    expect(row.unrealizedPnlTwd).toBe(51_000);
    expect(row.cumulativeDividendsTwd).toBe(12_000);
    expect(row.totalPnlTwd).toBe(63_000);
    expect(row.wealthMultipleTwd).toBeCloseTo((180_000 + 63_000) / 180_000, 5);
    expect(row.xirrTwd).not.toBeNull();
    expect(row.xirrTwd!).toBeGreaterThan(0.15);
    expect(row.wealthSeries.length).toBeGreaterThanOrEqual(3);
  });

  it("reconciles US stock equity vs FX P&L identically and differentiates held, closed, and watch", () => {
    const vooBars = generateLinearBars(2024, 400, 500, 0.0005);
    const vtBars = generateLinearBars(2024, 400, 100, 0.0004);
    const qqqBars = generateLinearBars(2024, 400, 400, 0.0006);
    const lastDate = vooBars[vooBars.length - 1].date;
    const firstDate = vooBars[0].date;

    const market: MarketDataBundle = {
      generatedAt: lastDate,
      fxTicker: "TWD=X",
      fxBars: [
        { date: firstDate, close: 30, adjClose: 30 },
        { date: lastDate, close: 33, adjClose: 33 }, // +10% USD appreciation
      ],
      tickers: {
        VOO: {
          symbol: "VOO",
          yahooTicker: "VOO",
          currency: "USD",
          lastPrice: vooBars[vooBars.length - 1].close,
          lastDate,
          splits: [],
          bars: vooBars,
        },
        VT: {
          symbol: "VT",
          yahooTicker: "VT",
          currency: "USD",
          lastPrice: vtBars[vtBars.length - 1].close,
          lastDate,
          splits: [],
          bars: vtBars,
        },
        QQQ: {
          symbol: "QQQ",
          yahooTicker: "QQQ",
          currency: "USD",
          lastPrice: qqqBars[qqqBars.length - 1].close,
          lastDate,
          splits: [],
          bars: qqqBars,
        },
      },
    };

    const sheets: PortfolioSheetsData = {
      source: "demo",
      assets: [
        { symbol: "VOO", name: "VOO", market: "US", currency: "USD", yahooTicker: "VOO", monitorMdd: true },
        { symbol: "VT", name: "VT", market: "US", currency: "USD", yahooTicker: "VT", monitorMdd: true },
        { symbol: "QQQ", name: "QQQ", market: "US", currency: "USD", yahooTicker: "QQQ", monitorMdd: true },
      ],
      transactions: [
        // VOO: held
        { id: "1", date: firstDate, symbol: "VOO", type: "BUY", shares: 10, price: 500, fee: 0, fxRate: 30 },
        // VT: bought then fully sold (closed)
        { id: "2", date: firstDate, symbol: "VT", type: "BUY", shares: 100, price: 100, fee: 0, fxRate: 30 },
        { id: "3", date: lastDate, symbol: "VT", type: "SELL", shares: 100, price: 110, fee: 0, fxRate: 33 },
        // QQQ: never traded (watch)
      ],
      cashSnapshots: [],
      benchmarks: [],
    };

    const out = runQuantEngine(sheets, market);
    const voo = out.symbolPerformance.find((r) => r.symbol === "VOO")!;
    const vt = out.symbolPerformance.find((r) => r.symbol === "VT")!;
    const qqq = out.symbolPerformance.find((r) => r.symbol === "QQQ")!;

    // VOO: open FX attribution reconciles exactly
    expect(voo.status).toBe("held");
    expect(voo.avgEntryFxRate).toBeCloseTo(30, 5);
    expect(voo.fxPnlTwd).not.toBeNull();
    // 5000 USD * (33 - 30) = +15,000 TWD FX gain
    expect(voo.fxPnlTwd!).toBeCloseTo(15_000, 4);
    expect(voo.equityPnlTwd + voo.fxPnlTwd!).toBeCloseTo(voo.unrealizedPnlTwd, 4);
    expect(voo.xirrTwd!).toBeGreaterThan(voo.xirrUsd!); // USD strengthened -> TWD XIRR > USD XIRR

    // VT: closed position retains realized P&L and historical XIRR
    expect(vt.status).toBe("closed");
    expect(vt.held).toBe(false);
    expect(vt.shares).toBe(0);
    // Bought 10,000 USD @ 30 = 300,000 TWD; Sold 11,000 USD @ 33 = 363,000 TWD -> +63,000 TWD
    expect(vt.realizedPnlTwd).toBeCloseTo(63_000, 4);
    expect(vt.totalPnlTwd).toBeCloseTo(63_000, 4);
    expect(vt.xirrTwd).not.toBeNull();

    // QQQ: watch position still exposes long-term market CAGR & volatility
    expect(qqq.status).toBe("watch");
    expect(qqq.marketMetrics.MAX.cagr).not.toBeNull();
    expect(qqq.marketMetrics.MAX.cagr!).toBeGreaterThan(0.1);
    expect(qqq.marketMetrics.MAX.volatility).not.toBeNull();

    // Aggregate subset XIRR works for held symbols
    const aggXirr = computeSubsetAggregateXirr({
      symbols: new Set(["VOO"]),
      rows: out.symbolPerformance,
      transactions: sheets.transactions,
      assets: sheets.assets,
      market,
      asOfDate: lastDate,
      latestFxRate: 33,
      currency: "TWD",
    });
    expect(aggXirr).toBeCloseTo(voo.xirrTwd!, 5);
  });
});
