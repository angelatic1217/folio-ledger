import { describe, expect, it } from "vitest";
import { runQuantEngine } from "@/lib/quant/engine";
import {
  buildAmortizationSchedule,
  computeEffectiveApr,
  computeLoanFacilitySummary,
  computeMonthlyPayment,
  computePortfolioLeverageSummary,
  simulateLumpSumVsDca,
} from "@/lib/quant/loan";
import {
  normalizeFundingTag,
  normalizeSymbol,
  parseLoansGrid,
  parseTransactionsGrid,
} from "@/lib/sheets/parser";
import type { MarketDataBundle } from "@/types/market";
import type { LoanFacility, PortfolioSheetsData } from "@/types/sheet";

describe("Loan Amortization, Leverage Risk & Parser Extensions", () => {
  it("matches Excel PMT, PPMT/IPMT schedule, and effective APR with origination fees", () => {
    // 2,100,000 TWD at 2.46% APR for 84 months
    const pmt = computeMonthlyPayment(2_100_000, 0.0246, 84);
    expect(pmt).toBeCloseTo(27239.7994, 2);

    // Effective APR with 9,000 origination fee (net disbursed 2,091,000) -> ~2.587%
    const effApr = computeEffectiveApr({
      netDisbursed: 2_091_000,
      monthlyPayment: pmt,
      termMonths: 84,
    });
    expect(effApr).toBeCloseTo(0.02587, 4);

    const loan: LoanFacility = {
      id: "l1",
      name: "Test Loan",
      fundingTag: "loan-A",
      startDate: "2025-07-11",
      principalTwd: 2_100_000,
      disbursedTwd: 2_091_000,
      wireFeeTwd: 420,
      receivedUsd: 70_000,
      apr: 0.0246,
      termMonths: 84,
    };

    const schedule = buildAmortizationSchedule(loan, "2026-11-20");
    expect(schedule.length).toBe(84);
    expect(schedule[0].interestTwd).toBeCloseTo(4305, 2);
    expect(schedule[0].principalTwd).toBeCloseTo(22934.8, 1);
    expect(schedule[83].remainingPrincipalTwd).toBeCloseTo(0, 4);

    // Paid installments: 2025-08-11 .. 2026-11-11 = 16 installments
    const paidCount = schedule.filter((r) => r.paid).length;
    expect(paidCount).toBe(16);
  });

  it("scales schedule interest proportionally when totalInterestOverrideTwd is provided", () => {
    const loan: LoanFacility = {
      id: "topup",
      name: "Incremental Top-up",
      fundingTag: "loan-B",
      startDate: "2026-10-27",
      principalTwd: 1_250_000,
      disbursedTwd: 1_224_000,
      wireFeeTwd: 420,
      apr: 0.0299,
      termMonths: 84,
      monthlyPaymentTwd: 12_122,
      totalInterestOverrideTwd: 140_248,
    };

    const schedule = buildAmortizationSchedule(loan, "2026-11-20");
    expect(schedule[83].cumulativeInterestTwd).toBeCloseTo(140_248, 2);
    expect(schedule[0].paymentTwd).toBe(12_122);
    expect(schedule.filter((r) => r.paid).length).toBe(0);
  });

  it("decomposes FX vs Equity P&L exactly, tracks residual USD cash, and guards <30d annualization", () => {
    const market: MarketDataBundle = {
      generatedAt: "2026-11-20",
      fxTicker: "TWD=X",
      fxBars: [
        { date: "2025-07-11", close: 30, adjClose: 30 },
        { date: "2026-11-10", close: 32, adjClose: 32 },
        { date: "2026-11-20", close: 33, adjClose: 33 },
      ],
      tickers: {
        VT: {
          symbol: "VT",
          yahooTicker: "VT",
          currency: "USD",
          lastPrice: 140,
          lastDate: "2026-11-20",
          splits: [],
          bars: [
            { date: "2025-07-11", close: 120, adjClose: 120 },
            { date: "2026-11-10", close: 138, adjClose: 138 },
            { date: "2026-11-20", close: 140, adjClose: 140 },
          ],
        },
        "VALU.LON": {
          symbol: "VALU.LON",
          yahooTicker: "VALU.L",
          currency: "USD",
          lastPrice: 4.5,
          lastDate: "2026-11-20",
          splits: [],
          bars: [
            { date: "2026-11-10", close: 5.0, adjClose: 5.0 },
            { date: "2026-11-20", close: 4.5, adjClose: 4.5 },
          ],
        },
      },
    };

    const sheets: PortfolioSheetsData = {
      source: "demo",
      assets: [
        { symbol: "VT", name: "VT", market: "US", currency: "USD", yahooTicker: "VT", monitorMdd: true },
        { symbol: "VALU.LON", name: "VALU", market: "US", currency: "USD", yahooTicker: "VALU.L", monitorMdd: true },
      ],
      transactions: [
        // Loan 1: Buy 100 VT @ 120 ($12,000) out of $12,100 received -> $100 residual USD cash
        { id: "t1", date: "2025-07-11", symbol: "VT", type: "BUY", shares: 100, price: 120, fee: 0, fxRate: 30, fundingTag: "loan1" },
        // Loan 2: Held only 10 days -> annualizedGrossReturn MUST be null
        { id: "t2", date: "2026-11-10", symbol: "VALU.LON", type: "BUY", shares: 1000, price: 5.0, fee: 0, fxRate: 32, fundingTag: "loan2" },
      ],
      cashSnapshots: [],
      benchmarks: [],
      loans: [
        {
          id: "loan1",
          name: "Loan 1",
          fundingTag: "loan1",
          startDate: "2025-07-11",
          principalTwd: 365_000,
          disbursedTwd: 362_600,
          wireFeeTwd: 400,
          receivedUsd: 12_100, // totalCostTwd = 363,000 => entry FX = 30.0
          apr: 0.025,
          termMonths: 84,
        },
        {
          id: "loan2",
          name: "Loan 2 (<30d)",
          fundingTag: "loan2",
          startDate: "2026-11-10",
          principalTwd: 160_000,
          disbursedTwd: 160_000,
          wireFeeTwd: 0,
          receivedUsd: 5_000,
          apr: 0.03,
          termMonths: 84,
        },
      ],
    };

    const s1 = computeLoanFacilitySummary({
      loan: sheets.loans![0],
      transactions: sheets.transactions,
      assets: sheets.assets,
      market,
      asOfDate: "2026-11-20",
      latestFxRate: 33,
    });

    // Holdings = 100 * 140 = 14,000 USD; Residual cash = 100 USD; Total = 14,100 USD = 465,300 TWD
    expect(s1.residualCashUsd).toBeCloseTo(100, 4);
    expect(s1.totalValueUsd).toBeCloseTo(14_100, 4);
    expect(s1.totalValueTwd).toBeCloseTo(465_300, 2);
    // Gross P&L = 465,300 - 363,000 = 102,300
    expect(s1.grossPnlTwd).toBeCloseTo(102_300, 2);
    // FX P&L = 12,100 * 33 - 363,000 = 36,300; Equity P&L = 2,000 * 33 = 66,000
    expect(s1.fxPnlTwd).toBeCloseTo(36_300, 2);
    expect(s1.equityPnlTwd).toBeCloseTo(66_000, 2);
    expect((s1.fxPnlTwd ?? 0) + s1.equityPnlTwd).toBeCloseTo(s1.grossPnlTwd, 2);
    expect(s1.annualizedGrossReturn).not.toBeNull();

    const engine = runQuantEngine(sheets, market);
    const leverage = computePortfolioLeverageSummary({ sheets, market, engine });
    expect(leverage.facilities.length).toBe(2);
    expect(leverage.facilities[1].annualizedGrossReturn).toBeNull();
    expect(leverage.netWorthTwd).toBeCloseTo(
      leverage.grossPortfolioAssetsTwd - leverage.totalRemainingDebtTwd,
      2
    );
  });

  it("normalizes symbols, funding tags, negative sell shares, and loans grid headers", () => {
    expect(normalizeSymbol("LON:VALU")).toBe("VALU.LON");
    expect(normalizeSymbol("006208富邦台50")).toBe("006208");
    expect(normalizeFundingTag("[2025信貸]")).toBe("2025信貸");

    const txs = parseTransactionsGrid([
      ["交易日期", "資金來源標籤", "交易類別", "標的代號", "成交單價 (USD)", "變動股數", "參考匯率", "交易備註說明"],
      ["2026-10-28", "[2025信貸]", "賣出換股", "VT", "156.88", "-112.7274", "32.39", "換股"],
      ["2026-10-28", "[2025信貸]", "買入配置", "LON:VALU", "4.91", "3620.36", "32.39", "轉買VALU"],
    ]);
    expect(txs.length).toBe(2);
    expect(txs[0].type).toBe("SELL");
    expect(txs[0].shares).toBeCloseTo(112.7274, 4);
    expect(txs[0].fundingTag).toBe("2025信貸");
    expect(txs[1].symbol).toBe("VALU.LON");
    expect(txs[1].type).toBe("BUY");

    const loans = parseLoansGrid([
      ["id", "name", "funding_tag", "start_date", "principal_twd", "disbursed_twd", "wire_fee_twd", "received_usd", "apr", "term_months"],
      ["l1", "首期信貸", "[2025信貸]", "2025/07/11", "2,100,000", "2,090,960", "420", "71,991.17", "2.46%", "84"],
    ]);
    expect(loans.length).toBe(1);
    expect(loans[0].fundingTag).toBe("2025信貸");
    expect(loans[0].apr).toBeCloseTo(0.0246, 6);
    expect(loans[0].principalTwd).toBe(2_100_000);
  });

  it("simulates lump-sum loan vs monthly DCA comparison accurately", () => {
    const res = simulateLumpSumVsDca({
      principalTwd: 2_100_000,
      originationFeeTwd: 9_000,
      apr: 0.0246,
      termMonths: 84,
      expectedAnnualGrowth: 0.08,
      dividendYield: 0.0129,
    });
    expect(res.yearlyPoints.length).toBe(7);
    expect(res.monthlyPaymentTwd).toBeCloseTo(27239.8, 1);
    expect(res.finalAdvantageTwd).toBeGreaterThan(400_000);
  });
});
