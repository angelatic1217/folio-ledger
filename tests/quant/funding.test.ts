import { describe, expect, it } from "vitest";
import { buildSheetTabCsv } from "@/lib/export/exporter";
import { runQuantEngine } from "@/lib/quant/engine";
import {
  allocateTransactionsByFundingTag,
  DEFAULT_OWN_FUNDING_TAG,
} from "@/lib/quant/funding";
import { computeLoanFacilitySummary, computePortfolioLeverageSummary } from "@/lib/quant/loan";
import { parseTransactionsGrid } from "@/lib/sheets/parser";
import type { MarketDataBundle } from "@/types/market";
import type { Asset, LoanFacility, PortfolioSheetsData, Transaction } from "@/types/sheet";

const BASE_ASSETS: Asset[] = [
  { symbol: "VT", name: "Vanguard Total World", market: "US", currency: "USD", yahooTicker: "VT", monitorMdd: true },
  { symbol: "VALU.LON", name: "VALU", market: "US", currency: "USD", yahooTicker: "VALU.L", monitorMdd: true },
  { symbol: "VXUS", name: "VXUS", market: "US", currency: "USD", yahooTicker: "VXUS", monitorMdd: true },
  { symbol: "0050", name: "元大台灣50", market: "TW", currency: "TWD", yahooTicker: "0050.TW", monitorMdd: true },
];

describe("Funding Source Allocation, Proportional DRIP/DIVIDEND, Auto Swap Pairing & SELLOUT", () => {
  it("compounds untagged & 自有資金 DRIP shares proportionally while honoring explicit loan-tagged DRIP", () => {
    const txs: Transaction[] = [
      { id: "t1", date: "2025-01-01", symbol: "VT", type: "BUY", shares: 20, price: 100, fee: 0, fxRate: 30 },
      { id: "t2", date: "2025-02-01", symbol: "VT", type: "BUY", shares: 80, price: 100, fee: 0, fxRate: 30, fundingTag: "2025信貸" },
      // Untagged DRIP -> 20% own (2), 80% loan (8) -> Own=22, Loan=88
      { id: "t3", date: "2025-03-25", symbol: "VT", type: "DRIP", shares: 10, price: 105, fee: 0, fxRate: 30 },
      // Own adds 10 more -> Own=32, Loan=88 (total 120)
      { id: "t4", date: "2025-05-01", symbol: "VT", type: "BUY", shares: 10, price: 110, fee: 0, fxRate: 30, fundingTag: "自有資金" },
      // DRIP explicitly marked 自有資金 still splits proportionally -> Own +3.2 (35.2), Loan +8.8 (96.8)
      { id: "t5", date: "2025-06-25", symbol: "VT", type: "DRIP", shares: 12, price: 112, fee: 0, fxRate: 30, fundingTag: "自有資金" },
      // Explicit loan-tagged DRIP stays 100% on 2025信貸 -> Loan +5 (101.8)
      { id: "t6", date: "2025-09-25", symbol: "VT", type: "DRIP", shares: 5, price: 115, fee: 0, fxRate: 30, fundingTag: "2025信貸" },
    ];

    const allocated = allocateTransactionsByFundingTag({
      transactions: txs,
      assets: BASE_ASSETS,
    });

    const sumShares = (tag: string) =>
      allocated
        .filter((t) => t.fundingTag === tag && (t.type === "BUY" || t.type === "DRIP"))
        .reduce((acc, t) => acc + t.shares, 0);

    expect(sumShares(DEFAULT_OWN_FUNDING_TAG)).toBeCloseTo(35.2, 6);
    expect(sumShares("2025信貸")).toBeCloseTo(101.8, 6);
    expect(sumShares(DEFAULT_OWN_FUNDING_TAG) + sumShares("2025信貸")).toBeCloseTo(137, 6);
  });

  it("enforces deterministic same-day order: DRIP uses start-of-day holdings before same-day BUY regardless of row order", () => {
    const txs: Transaction[] = [
      { id: "b1", date: "2025-01-01", symbol: "VT", type: "BUY", shares: 100, price: 100, fee: 0 },
      // Listed BUY before DRIP on the same date!
      { id: "b2", date: "2025-06-24", symbol: "VT", type: "BUY", shares: 300, price: 120, fee: 0, fundingTag: "2025信貸" },
      { id: "d1", date: "2025-06-24", symbol: "VT", type: "DRIP", shares: 4, price: 120, fee: 0 },
      // Next quarter DRIP includes both Own (104) and Loan (300)
      { id: "d2", date: "2025-09-24", symbol: "VT", type: "DRIP", shares: 4.04, price: 125, fee: 0 },
    ];

    const allocated = allocateTransactionsByFundingTag({
      transactions: txs,
      assets: BASE_ASSETS,
    });

    const juneDripLoan = allocated.filter(
      (t) => t.date === "2025-06-24" && t.type === "DRIP" && t.fundingTag === "2025信貸"
    );
    const juneDripOwn = allocated.filter(
      (t) => t.date === "2025-06-24" && t.type === "DRIP" && t.fundingTag === DEFAULT_OWN_FUNDING_TAG
    );
    expect(juneDripLoan.length).toBe(0);
    expect(juneDripOwn[0].shares).toBeCloseTo(4, 6);

    const sepDripLoan = allocated.find(
      (t) => t.date === "2025-09-24" && t.type === "DRIP" && t.fundingTag === "2025信貸"
    );
    const sepDripOwn = allocated.find(
      (t) => t.date === "2025-09-24" && t.type === "DRIP" && t.fundingTag === DEFAULT_OWN_FUNDING_TAG
    );
    expect(sepDripLoan?.shares).toBeCloseTo(3.0, 6);
    expect(sepDripOwn?.shares).toBeCloseTo(1.04, 6);
  });

  it("allocates TWD cash DIVIDEND across stock splits, handles post-liquidation dividends, and counts them in loan value", () => {
    const market: MarketDataBundle = {
      generatedAt: "2026-11-20",
      fxTicker: "TWD=X",
      fxBars: [
        { date: "2024-01-01", close: 32, adjClose: 32 },
        { date: "2026-11-20", close: 32, adjClose: 32 },
      ],
      tickers: {
        "0050": {
          symbol: "0050",
          yahooTicker: "0050.TW",
          currency: "TWD",
          lastPrice: 60,
          lastDate: "2026-11-20",
          splits: [{ date: "2025-06-18", ratio: 4 }],
          bars: [
            { date: "2024-01-15", close: 40, adjClose: 40 },
            { date: "2025-07-01", close: 50, adjClose: 50 },
            { date: "2026-11-20", close: 60, adjClose: 60 },
          ],
        },
      },
    };

    const txs: Transaction[] = [
      // Pre-split: 100 raw shares -> 400 split-adjusted shares (40%)
      { id: "tw1", date: "2024-01-15", symbol: "0050", type: "BUY", shares: 100, price: 160, fee: 0 },
      // Post-split: 600 shares (60%) funded by TWD loan
      { id: "tw2", date: "2025-07-01", symbol: "0050", type: "BUY", shares: 600, price: 50, fee: 0, fundingTag: "台幣信貸" },
      // Cash dividend 10,000 TWD -> 4,000 Own, 6,000 Loan
      { id: "tw3", date: "2026-02-11", symbol: "0050", type: "DIVIDEND", shares: 10000, price: 1, fee: 0 },
    ];

    const loan: LoanFacility = {
      id: "tw-loan",
      name: "台幣信貸",
      fundingTag: "台幣信貸",
      startDate: "2025-07-01",
      principalTwd: 30_000,
      disbursedTwd: 30_000,
      wireFeeTwd: 0,
      receivedUsd: null,
      apr: 0.025,
      termMonths: 84,
    };

    const summary = computeLoanFacilitySummary({
      loan,
      transactions: txs,
      assets: BASE_ASSETS,
      market,
      asOfDate: "2026-11-20",
      latestFxRate: 32,
    });

    expect(summary.holdings[0].shares).toBeCloseTo(600, 6);
    expect(summary.cumulativeDividendsTwd).toBeCloseTo(6_000, 2);
    expect(summary.residualCashTwd).toBeCloseTo(6_000, 2);
    // Holdings 600 * 60 = 36,000 + 6,000 dividend cash = 42,000
    expect(summary.totalValueTwd).toBeCloseTo(42_000, 2);
    expect(summary.grossPnlTwd).toBeCloseTo(12_000, 2);

    // Post-liquidation dividend falls back to last non-zero share mix (40% Own / 60% Loan)
    const txsWithPostLiqDiv: Transaction[] = [
      ...txs,
      { id: "tw4", date: "2026-06-01", symbol: "0050", type: "SELL", shares: 1000, price: 58, fee: 0, withdrawProceeds: true },
      { id: "tw5", date: "2026-07-15", symbol: "0050", type: "DIVIDEND", shares: 5000, price: 1, fee: 0 },
    ];
    const allocPost = allocateTransactionsByFundingTag({
      transactions: txsWithPostLiqDiv,
      assets: BASE_ASSETS,
      splitsBySymbol: { "0050": [{ date: "2025-06-18", ratio: 4 }] },
    });
    const postDivLoan = allocPost.find(
      (t) => t.date === "2026-07-15" && t.fundingTag === "台幣信貸"
    );
    const postDivOwn = allocPost.find(
      (t) => t.date === "2026-07-15" && t.fundingTag === DEFAULT_OWN_FUNDING_TAG
    );
    expect(postDivLoan?.shares).toBeCloseTo(3000, 6);
    expect(postDivOwn?.shares).toBeCloseTo(2000, 6);
  });

  it("pairs same-day pro-rata SELL -> untagged BUY without colliding with explicit new-loan BUY", () => {
    const txs: Transaction[] = [
      { id: "1", date: "2025-01-01", symbol: "VT", type: "BUY", shares: 20, price: 120, fee: 0 },
      { id: "2", date: "2025-07-10", symbol: "VT", type: "BUY", shares: 80, price: 130, fee: 0, fundingTag: "2025信貸" },
      // Same day (2026-10-27): explicit new loan BUY + untagged swap BUY listed BEFORE untagged SELL
      { id: "3", date: "2026-10-27", symbol: "VALU.LON", type: "BUY", shares: 7000, price: 5, fee: 0, fundingTag: "2026增貸" },
      { id: "4", date: "2026-10-27", symbol: "VALU.LON", type: "BUY", shares: 3000, price: 5, fee: 0 },
      { id: "5", date: "2026-10-27", symbol: "VT", type: "SELL", shares: 100, price: 150, fee: 0 },
    ];

    const allocated = allocateTransactionsByFundingTag({
      transactions: txs,
      assets: BASE_ASSETS,
    });

    const valuByTag = (tag: string) =>
      allocated
        .filter((t) => t.symbol === "VALU.LON" && t.type === "BUY" && t.fundingTag === tag)
        .reduce((acc, t) => acc + t.shares, 0);

    // 2026增貸 keeps 100% of its explicit 7,000 shares
    expect(valuByTag("2026增貸")).toBeCloseTo(7000, 6);
    // 2025信貸 sold 80% of VT ($12,000) -> gets 80% of untagged 3,000 VALU = 2,400 shares
    expect(valuByTag("2025信貸")).toBeCloseTo(2400, 6);
    // 自有資金 sold 20% of VT ($3,000) -> gets 20% of untagged 3,000 VALU = 600 shares
    expect(valuByTag(DEFAULT_OWN_FUNDING_TAG)).toBeCloseTo(600, 6);
  });

  it("splits same-day 1-sell-to-2-buys evenly by swap ratio and carries over ONLY unspent loan proceeds across days", () => {
    // Part A: Same-day 1-sell -> 2-buys
    const sameDayTxs: Transaction[] = [
      { id: "a1", date: "2025-01-01", symbol: "VT", type: "BUY", shares: 20, price: 100, fee: 0 },
      { id: "a2", date: "2025-02-01", symbol: "VT", type: "BUY", shares: 80, price: 100, fee: 0, fundingTag: "2025信貸" },
      { id: "a3", date: "2025-06-01", symbol: "VT", type: "SELL", shares: 100, price: 100, fee: 0 }, // $2,000 own + $8,000 loan
      { id: "a4", date: "2025-06-01", symbol: "VALU.LON", type: "BUY", shares: 800, price: 5, fee: 0 }, // $4,000
      { id: "a5", date: "2025-06-01", symbol: "VXUS", type: "BUY", shares: 100, price: 60, fee: 0 }, // $6,000
    ];

    const allocSame = allocateTransactionsByFundingTag({
      transactions: sameDayTxs,
      assets: BASE_ASSETS,
    });

    const valuLoan = allocSame.find((t) => t.symbol === "VALU.LON" && t.fundingTag === "2025信貸");
    const vxusLoan = allocSame.find((t) => t.symbol === "VXUS" && t.fundingTag === "2025信貸");
    expect(valuLoan?.shares).toBeCloseTo(640, 6); // 80% of 800
    expect(vxusLoan?.shares).toBeCloseTo(80, 6); // 80% of 100

    // Part B: Cross-day swap + extra new own cash top-up
    const crossDayTxs: Transaction[] = [
      { id: "b1", date: "2025-01-01", symbol: "VT", type: "BUY", shares: 20, price: 100, fee: 0 },
      { id: "b2", date: "2025-02-01", symbol: "VT", type: "BUY", shares: 80, price: 100, fee: 0, fundingTag: "2025信貸" },
      { id: "b3", date: "2025-06-01", symbol: "VT", type: "SELL", shares: 100, price: 100, fee: 0 }, // Loan carryover = $8,000
      // 5 days later, buy $15,000 -> Loan absorbs exact $8,000 (8/15), Own takes $7,000 (7/15)
      { id: "b4", date: "2025-06-06", symbol: "VALU.LON", type: "BUY", shares: 3000, price: 5, fee: 0 },
    ];

    const allocCross = allocateTransactionsByFundingTag({
      transactions: crossDayTxs,
      assets: BASE_ASSETS,
    });
    const crossLoan = allocCross.find((t) => t.symbol === "VALU.LON" && t.fundingTag === "2025信貸");
    const crossOwn = allocCross.find((t) => t.symbol === "VALU.LON" && t.fundingTag === DEFAULT_OWN_FUNDING_TAG);
    expect(crossLoan?.shares).toBeCloseTo(1600, 6); // $8,000 / $5
    expect(crossOwn?.shares).toBeCloseTo(1400, 6); // $7,000 / $5
  });

  it("offsets manual explicitly-tagged loan swaps so they never hijack subsequent own-fund buys", () => {
    const txs: Transaction[] = [
      { id: "m1", date: "2025-07-01", symbol: "VT", type: "BUY", shares: 100, price: 100, fee: 0, fundingTag: "2025信貸" },
      // Manual explicitly-tagged swap on the same day
      { id: "m2", date: "2025-10-01", symbol: "VT", type: "SELL", shares: 100, price: 120, fee: 0, fundingTag: "2025信貸" },
      { id: "m3", date: "2025-10-01", symbol: "VALU.LON", type: "BUY", shares: 2400, price: 5, fee: 0, fundingTag: "2025信貸" },
      // Later untagged own buy MUST stay 100% 自有資金
      { id: "m4", date: "2025-11-01", symbol: "VXUS", type: "BUY", shares: 50, price: 60, fee: 0 },
    ];

    const allocated = allocateTransactionsByFundingTag({
      transactions: txs,
      assets: BASE_ASSETS,
    });
    const vxusLoan = allocated.filter((t) => t.symbol === "VXUS" && t.fundingTag === "2025信貸");
    const vxusOwn = allocated.filter((t) => t.symbol === "VXUS" && t.fundingTag === DEFAULT_OWN_FUNDING_TAG);
    expect(vxusLoan.length).toBe(0);
    expect(vxusOwn[0].shares).toBeCloseTo(50, 6);
  });

  it("parses/exports SELLOUT, excludes SELLOUT proceeds from swap pool, and preserves recovered cash in loan P&L", () => {
    const parsed = parseTransactionsGrid([
      ["date", "symbol", "type", "shares", "price", "fee", "fx_rate", "funding_tag", "note"],
      ["2025-01-01", "VT", "BUY", "20", "100", "0", "30", "", "own"],
      ["2025-02-01", "VT", "BUY", "80", "100", "0", "30", "2025信貸", "loan"],
      ["2025-08-01", "VT", "SELLOUT", "50", "140", "0", "30", "", "cash out"],
      ["2025-08-05", "VXUS", "BUY", "100", "60", "0", "30", "", "new own buy"],
    ]);

    expect(parsed[2].type).toBe("SELL");
    expect(parsed[2].withdrawProceeds).toBe(true);

    // Round-trip CSV export preserves SELLOUT
    const csv = buildSheetTabCsv(
      {
        source: "csv",
        transactions: parsed,
        assets: BASE_ASSETS,
        cashSnapshots: [],
        benchmarks: [],
      },
      "transactions"
    );
    expect(csv).toContain(",SELLOUT,");

    // SELLOUT proceeds must NOT enter swap pool -> subsequent untagged VXUS BUY is 100% 自有資金
    const allocated = allocateTransactionsByFundingTag({
      transactions: parsed,
      assets: BASE_ASSETS,
    });
    const vxusLoan = allocated.filter((t) => t.symbol === "VXUS" && t.fundingTag === "2025信貸");
    const vxusOwn = allocated.filter((t) => t.symbol === "VXUS" && t.fundingTag === DEFAULT_OWN_FUNDING_TAG);
    expect(vxusLoan.length).toBe(0);
    expect(vxusOwn[0].shares).toBeCloseTo(100, 6);

    // Loan P&L still retains the recovered USD cash ($40 * 140 = $5,600) from SELLOUT
    const market: MarketDataBundle = {
      generatedAt: "2025-09-01",
      fxTicker: "TWD=X",
      fxBars: [
        { date: "2025-01-01", close: 30, adjClose: 30 },
        { date: "2025-09-01", close: 30, adjClose: 30 },
      ],
      tickers: {
        VT: {
          symbol: "VT",
          yahooTicker: "VT",
          currency: "USD",
          lastPrice: 150,
          lastDate: "2025-09-01",
          splits: [],
          bars: [
            { date: "2025-01-01", close: 100, adjClose: 100 },
            { date: "2025-09-01", close: 150, adjClose: 150 },
          ],
        },
        VXUS: {
          symbol: "VXUS",
          yahooTicker: "VXUS",
          currency: "USD",
          lastPrice: 60,
          lastDate: "2025-09-01",
          splits: [],
          bars: [{ date: "2025-08-05", close: 60, adjClose: 60 }],
        },
      },
    };
    const loan: LoanFacility = {
      id: "l-sellout",
      name: "2025信貸",
      fundingTag: "2025信貸",
      startDate: "2025-02-01",
      principalTwd: 240_000,
      disbursedTwd: 240_000,
      wireFeeTwd: 0,
      receivedUsd: 8_000,
      apr: 0.025,
      termMonths: 84,
    };

    const summary = computeLoanFacilitySummary({
      loan,
      transactions: parsed,
      assets: BASE_ASSETS,
      market,
      asOfDate: "2025-09-01",
      latestFxRate: 30,
    });
    // Remaining 40 VT @ 150 = $6,000 + recovered SELLOUT cash $5,600 = $11,600 ($3,600 profit)
    expect(summary.holdings[0].shares).toBeCloseTo(40, 6);
    expect(summary.residualCashUsd).toBeCloseTo(5_600, 4);
    expect(summary.totalValueUsd).toBeCloseTo(11_600, 4);
    expect(summary.grossPnlTwd).toBeCloseTo(108_000, 2);
  });

  it("preserves 100% conservation across ALL vs sum of allocated funding buckets in QuantEngine & LeverageSummary", () => {
    const market: MarketDataBundle = {
      generatedAt: "2026-11-20",
      fxTicker: "TWD=X",
      fxBars: [
        { date: "2025-01-01", close: 31, adjClose: 31 },
        { date: "2025-07-10", close: 30, adjClose: 30 },
        { date: "2026-10-27", close: 32, adjClose: 32 },
        { date: "2026-11-20", close: 32.5, adjClose: 32.5 },
      ],
      tickers: {
        VT: {
          symbol: "VT",
          yahooTicker: "VT",
          currency: "USD",
          lastPrice: 160,
          lastDate: "2026-11-20",
          splits: [],
          bars: [
            { date: "2025-01-01", close: 120, adjClose: 120 },
            { date: "2025-07-10", close: 130, adjClose: 130 },
            { date: "2026-10-27", close: 155, adjClose: 155 },
            { date: "2026-11-20", close: 160, adjClose: 160 },
          ],
        },
        "VALU.LON": {
          symbol: "VALU.LON",
          yahooTicker: "VALU.L",
          currency: "USD",
          lastPrice: 5.2,
          lastDate: "2026-11-20",
          splits: [],
          bars: [
            { date: "2026-10-27", close: 5.0, adjClose: 5.0 },
            { date: "2026-11-20", close: 5.2, adjClose: 5.2 },
          ],
        },
      },
    };

    const sheets: PortfolioSheetsData = {
      source: "csv",
      assets: BASE_ASSETS.slice(0, 2),
      cashSnapshots: [],
      benchmarks: [],
      transactions: [
        { id: "c1", date: "2025-01-01", symbol: "VT", type: "BUY", shares: 50, price: 120, fee: 0, fxRate: 31 },
        { id: "c2", date: "2025-07-10", symbol: "VT", type: "BUY", shares: 200, price: 130, fee: 0, fxRate: 30, fundingTag: "2025信貸" },
        { id: "c3", date: "2025-09-25", symbol: "VT", type: "DRIP", shares: 2.5, price: 138, fee: 0, fxRate: 30.5 },
        { id: "c4", date: "2026-06-25", symbol: "VT", type: "DRIP", shares: 3.0, price: 150, fee: 0, fxRate: 32 },
        { id: "c5", date: "2026-10-27", symbol: "VALU.LON", type: "BUY", shares: 6000, price: 5.0, fee: 0, fxRate: 32, fundingTag: "2026增貸" },
        { id: "c6", date: "2026-10-27", symbol: "VT", type: "SELL", shares: 100, price: 155, fee: 0, fxRate: 32 },
        { id: "c7", date: "2026-10-27", symbol: "VALU.LON", type: "BUY", shares: 3100, price: 5.0, fee: 0, fxRate: 32 },
      ],
      loans: [
        {
          id: "l-2025",
          name: "2025信貸",
          fundingTag: "2025信貸",
          startDate: "2025-07-10",
          principalTwd: 780_000,
          disbursedTwd: 780_000,
          wireFeeTwd: 0,
          receivedUsd: 26_000,
          apr: 0.025,
          termMonths: 84,
        },
        {
          id: "l-2026",
          name: "2026增貸",
          fundingTag: "2026增貸",
          startDate: "2026-10-27",
          principalTwd: 960_000,
          disbursedTwd: 960_000,
          wireFeeTwd: 0,
          receivedUsd: 30_000,
          apr: 0.029,
          termMonths: 84,
        },
      ],
    };

    const allEngine = runQuantEngine(sheets, market);
    const allocated = allocateTransactionsByFundingTag({
      transactions: sheets.transactions,
      assets: sheets.assets,
    });

    const tags = [DEFAULT_OWN_FUNDING_TAG, "2025信貸", "2026增貸"];
    let sumInvestedTwd = 0;
    for (const tag of tags) {
      const subEngine = runQuantEngine(
        {
          ...sheets,
          transactions: allocated.filter((t) => t.fundingTag === tag),
        },
        market
      );
      sumInvestedTwd += subEngine.totalInvestedValueTwd;
    }

    expect(sumInvestedTwd).toBeCloseTo(allEngine.totalInvestedValueTwd, 2);

    const leverage = computePortfolioLeverageSummary({
      sheets,
      market,
      engine: allEngine,
    });
    const loan2025 = leverage.facilities.find((f) => f.id === "l-2025")!;
    const vtHolding = loan2025.holdings.find((h) => h.symbol === "VT")!;
    const valuHolding = loan2025.holdings.find((h) => h.symbol === "VALU.LON")!;
    // 2025信貸 received 80% of 5.5 DRIP = 4.4 DRIP shares!
    expect(vtHolding.dripShares).toBeCloseTo(4.4, 6);
    // And received 80% of the swapped 3,100 VALU.LON = 2,480 shares!
    expect(valuHolding.shares).toBeCloseTo(2480, 4);
  });
});
