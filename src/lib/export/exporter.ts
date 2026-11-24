import type { LocalAppSettings } from "@/lib/storage/indexeddb";
import type { MarketDataBundle } from "@/types/market";
import type { PortfolioScope, QuantEngineOutput } from "@/types/quant";
import type { PortfolioSheetsData } from "@/types/sheet";

function escapeCsvCell(value: unknown): string {
  const str = String(value ?? "");
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((r) => r.map(escapeCsvCell).join(",")),
  ];
  return "\uFEFF" + lines.join("\r\n");
}

export function triggerFileDownload(
  filename: string,
  content: string,
  mimeType = "text/plain;charset=utf-8"
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface DataHealthCheck {
  missingMarketSymbols: string[];
  zeroPriceTransactions: number;
  preMarketTransactions: Array<{ date: string; symbol: string; firstBarDate: string }>;
  detectedSplits: Array<{ symbol: string; date: string; ratio: number }>;
  totalTransactions: number;
  dateRange: { first: string | null; last: string | null };
}

export function runDataHealthCheck(
  sheets: PortfolioSheetsData,
  market: MarketDataBundle
): DataHealthCheck {
  const missingSet = new Set<string>();
  const preMarketTransactions: Array<{
    date: string;
    symbol: string;
    firstBarDate: string;
  }> = [];
  let zeroPriceTransactions = 0;

  for (const a of sheets.assets) {
    if (!market.tickers[a.symbol] || market.tickers[a.symbol].bars.length === 0) {
      missingSet.add(a.symbol);
    }
  }

  for (const tx of sheets.transactions) {
    if (tx.price <= 0 && tx.type !== "DRIP") zeroPriceTransactions++;
    const ticker = market.tickers[tx.symbol];
    if (!ticker || ticker.bars.length === 0) {
      missingSet.add(tx.symbol);
    } else if (tx.date < ticker.bars[0].date) {
      preMarketTransactions.push({
        date: tx.date,
        symbol: tx.symbol,
        firstBarDate: ticker.bars[0].date,
      });
    }
  }

  const detectedSplits: Array<{ symbol: string; date: string; ratio: number }> = [];
  for (const a of sheets.assets) {
    const splits = market.tickers[a.symbol]?.splits ?? [];
    for (const s of splits) {
      detectedSplits.push({ symbol: a.symbol, date: s.date, ratio: s.ratio });
    }
  }

  const sortedDates = sheets.transactions.map((t) => t.date).sort();
  return {
    missingMarketSymbols: Array.from(missingSet),
    zeroPriceTransactions,
    preMarketTransactions,
    detectedSplits,
    totalTransactions: sheets.transactions.length,
    dateRange: {
      first: sortedDates[0] ?? null,
      last: sortedDates[sortedDates.length - 1] ?? null,
    },
  };
}

export function buildFullExportJson(params: {
  sheets: PortfolioSheetsData;
  engine: QuantEngineOutput;
  market: MarketDataBundle;
  settings: LocalAppSettings;
}): string {
  const { sheets, engine, market, settings } = params;
  const health = runDataHealthCheck(sheets, market);

  const payload = {
    exportedAt: new Date().toISOString(),
    exportType: "full-backup-and-diagnostics",
    asOfDate: engine.asOfDate,
    marketGeneratedAt: market.generatedAt,
    latestFxRate: engine.latestFxRate,
    mddThresholds: settings.mddThresholds,
    healthCheck: health,
    summary: {
      totalInvestedValueTwd: Number(engine.totalInvestedValueTwd.toFixed(2)),
      totalCashValueTwd: Number(engine.totalCashValueTwd.toFixed(2)),
      totalTwValueTwd: Number(engine.totalTwValueTwd.toFixed(2)),
      totalUsValueTwd: Number(engine.totalUsValueTwd.toFixed(2)),
      totalCostBasisTwd: Number(engine.totalCostBasisTwd.toFixed(2)),
      cumulativeDividendsTwd: Number(engine.cumulativeDividendsTwd.toFixed(2)),
      cumulativeNetInvestedTwd: Number(engine.cumulativeNetInvestedTwd.toFixed(2)),
    },
    sheets: {
      source: sheets.source,
      syncedAt: sheets.syncedAt,
      transactions: sheets.transactions,
      assets: sheets.assets,
      cashSnapshots: sheets.cashSnapshots,
      benchmarks: sheets.benchmarks,
      loans: sheets.loans ?? [],
    },
    mddMatrix: engine.mddMatrix.map(({ underwaterSeries, ...rest }) => ({
      ...rest,
      recentUnderwaterPoints: underwaterSeries.slice(-15),
    })),
    annualByScope: engine.annualByScope,
    investedDailySeries: engine.investedSeries,
    totalDailySeries: engine.totalSeries,
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Scales all monetary values and share counts proportionally so that totalInvestedValueTwd = 1,000,000,
 * preserving 100% identical TWR, Modified Dietz, MDD, weights, dates, prices, and FX rates
 * without exposing real personal wealth when sharing diagnostics for debugging.
 */
export function buildAnonymizedDiagnosticJson(params: {
  sheets: PortfolioSheetsData;
  engine: QuantEngineOutput;
  market: MarketDataBundle;
  settings: LocalAppSettings;
}): string {
  const { sheets, engine, market, settings } = params;
  const health = runDataHealthCheck(sheets, market);
  const scale =
    engine.totalInvestedValueTwd > 0
      ? 1_000_000 / engine.totalInvestedValueTwd
      : 1;

  const r2 = (n: number) => Number((n * scale).toFixed(2));
  const r4 = (n: number) => Number((n * scale).toFixed(4));

  const payload = {
    exportedAt: new Date().toISOString(),
    exportType: "anonymized-diagnostic-report",
    note: "所有金額與股數已等比例縮放至基準市值 NT$ 1,000,000，報酬率 / MDD / 權重 / 成交單價 / 匯率皆 100% 與原始帳本一致。",
    asOfDate: engine.asOfDate,
    marketGeneratedAt: market.generatedAt,
    latestFxRate: engine.latestFxRate,
    mddThresholds: settings.mddThresholds,
    healthCheck: health,
    summaryScaled: {
      totalInvestedValueTwd: r2(engine.totalInvestedValueTwd),
      totalCashValueTwd: r2(engine.totalCashValueTwd),
      totalTwValueTwd: r2(engine.totalTwValueTwd),
      totalUsValueTwd: r2(engine.totalUsValueTwd),
      totalCostBasisTwd: r2(engine.totalCostBasisTwd),
      cumulativeDividendsTwd: r2(engine.cumulativeDividendsTwd),
      cumulativeNetInvestedTwd: r2(engine.cumulativeNetInvestedTwd),
    },
    sheetsScaled: {
      source: sheets.source,
      assets: sheets.assets,
      benchmarks: sheets.benchmarks,
      cashSnapshots: sheets.cashSnapshots.map((c) => ({
        date: c.date,
        currency: c.currency,
        balanceScaled: r2(c.balance),
      })),
      transactions: sheets.transactions.map((t) => ({
        date: t.date,
        symbol: t.symbol,
        type: t.type,
        sharesScaled: r4(t.shares),
        price: t.price,
        feeScaled: r2(t.fee),
        fxRate: t.fxRate ?? null,
        fundingTag: t.fundingTag ?? null,
      })),
      loansScaled: (sheets.loans ?? []).map((l) => ({
        id: l.id,
        name: l.name,
        fundingTag: l.fundingTag,
        startDate: l.startDate,
        principalScaled: r2(l.principalTwd),
        disbursedScaled: r2(l.disbursedTwd),
        wireFeeScaled: r2(l.wireFeeTwd),
        receivedUsdScaled: l.receivedUsd ? r2(l.receivedUsd) : null,
        apr: l.apr,
        termMonths: l.termMonths,
      })),
    },
    mddMatrix: engine.mddMatrix.map(({ underwaterSeries, ...row }) => ({
      ...row,
      shares: r4(row.shares),
      marketValueTwd: r2(row.marketValueTwd),
      costBasisTwd: r2(row.costBasisTwd),
      recentUnderwaterPoints: underwaterSeries.slice(-10),
    })),
    annualByScope: Object.fromEntries(
      Object.entries(engine.annualByScope).map(([scope, rows]) => [
        scope,
        rows.map((r) => ({
          ...r,
          startValueTwd: r2(r.startValueTwd),
          netInflowTwd: r2(r.netInflowTwd),
          endValueTwd: r2(r.endValueTwd),
          netPnlTwd: r2(r.netPnlTwd),
        })),
      ])
    ),
    investedDailySeriesSampled: engine.investedSeries.map((pt) => ({
      date: pt.date,
      investedValueScaled: r2(pt.investedValueTwd),
      cashValueScaled: r2(pt.cashValueTwd),
      twValueScaled: r2(pt.twValueTwd),
      usValueScaled: r2(pt.usValueTwd),
      fxRate: pt.fxRate,
      externalCashFlowScaled: r2(pt.externalCashFlowTwd),
      dailyReturn: Number(pt.dailyReturn.toFixed(6)),
      twrIndex: Number(pt.twrIndex.toFixed(4)),
      drawdown: Number(pt.drawdown.toFixed(6)),
      daysUnderwater: pt.daysUnderwater,
    })),
  };

  return JSON.stringify(payload, null, 2);
}

export function buildDailySeriesCsv(
  engine: QuantEngineOutput,
  scope: PortfolioScope
): string {
  const series = scope === "total" ? engine.totalSeries : engine.investedSeries;
  const headers = [
    "date",
    "invested_value_twd",
    "cash_value_twd",
    "total_value_twd",
    "tw_value_twd",
    "us_value_twd",
    "fx_rate",
    "external_cash_flow_twd",
    "dividend_income_twd",
    "daily_return",
    "twr_index",
    "peak_twr_index",
    "drawdown",
    "peak_date",
    "days_underwater",
  ];

  const rows = series.map((pt) => [
    pt.date,
    pt.investedValueTwd.toFixed(2),
    pt.cashValueTwd.toFixed(2),
    pt.totalValueTwd.toFixed(2),
    pt.twValueTwd.toFixed(2),
    pt.usValueTwd.toFixed(2),
    pt.fxRate.toFixed(4),
    pt.externalCashFlowTwd.toFixed(2),
    pt.dividendIncomeTwd.toFixed(2),
    pt.dailyReturn.toFixed(6),
    pt.twrIndex.toFixed(4),
    pt.peakTwrIndex.toFixed(4),
    pt.drawdown.toFixed(6),
    pt.peakDate,
    pt.daysUnderwater,
  ]);

  return toCsv(headers, rows);
}

export function buildMddMatrixCsv(engine: QuantEngineOutput): string {
  const headers = [
    "symbol",
    "name",
    "market",
    "currency",
    "yahoo_ticker",
    "held",
    "shares",
    "latest_date",
    "latest_price",
    "peak_adj_price",
    "peak_date",
    "current_drawdown",
    "historical_mdd",
    "mdd_date",
    "mdd_ratio_pct",
    "days_underwater",
    "weight_pct",
    "market_value_twd",
    "cost_basis_twd",
    "unrealized_pnl_pct",
    "signal",
  ];

  const rows = engine.mddMatrix.map((r) => [
    r.symbol,
    r.name,
    r.market,
    r.currency,
    r.yahooTicker,
    r.held ? "TRUE" : "FALSE",
    r.shares.toFixed(4),
    r.latestDate,
    r.latestPrice.toFixed(4),
    r.peakAdjPrice.toFixed(4),
    r.peakDate,
    r.currentDrawdown.toFixed(6),
    r.historicalMdd.toFixed(6),
    r.mddDate,
    r.mddRatioPct,
    r.daysUnderwater,
    r.weightPct.toFixed(2),
    r.marketValueTwd.toFixed(2),
    r.costBasisTwd.toFixed(2),
    r.unrealizedPnlPct !== null ? r.unrealizedPnlPct.toFixed(6) : "",
    r.signal,
  ]);

  return toCsv(headers, rows);
}

export function buildAnnualPerformanceCsv(engine: QuantEngineOutput): string {
  const headers = [
    "scope",
    "year",
    "start_value_twd",
    "net_inflow_twd",
    "end_value_twd",
    "net_pnl_twd",
    "modified_dietz",
    "twr",
    "benchmark_symbol",
    "benchmark_name",
    "benchmark_return",
    "alpha",
  ];

  const rows: unknown[][] = [];
  for (const scope of ["ALL", "TW", "US"] as const) {
    for (const r of engine.annualByScope[scope] ?? []) {
      rows.push([
        scope,
        r.year,
        r.startValueTwd.toFixed(2),
        r.netInflowTwd.toFixed(2),
        r.endValueTwd.toFixed(2),
        r.netPnlTwd.toFixed(2),
        r.modifiedDietz.toFixed(6),
        r.twr.toFixed(6),
        r.benchmarkSymbol,
        r.benchmarkName,
        r.benchmarkReturn !== null ? r.benchmarkReturn.toFixed(6) : "",
        r.alpha !== null ? r.alpha.toFixed(6) : "",
      ]);
    }
  }

  return toCsv(headers, rows);
}

export function buildSheetTabCsv(
  sheets: PortfolioSheetsData,
  tab: "transactions" | "assets" | "cash_snapshots" | "benchmarks" | "loans"
): string {
  if (tab === "transactions") {
    return toCsv(
      ["date", "symbol", "type", "shares", "price", "fee", "fx_rate", "funding_tag", "note"],
      sheets.transactions.map((t) => [
        t.date,
        t.symbol,
        t.type === "SELL" && t.withdrawProceeds ? "SELLOUT" : t.type,
        t.shares,
        t.price,
        t.fee,
        t.fxRate ?? "",
        t.fundingTag ?? "",
        t.note ?? "",
      ])
    );
  }
  if (tab === "assets") {
    return toCsv(
      ["symbol", "name", "market", "currency", "yahoo_ticker", "monitor_mdd"],
      sheets.assets.map((a) => [
        a.symbol,
        a.name,
        a.market,
        a.currency,
        a.yahooTicker,
        a.monitorMdd ? "TRUE" : "FALSE",
      ])
    );
  }
  if (tab === "cash_snapshots") {
    return toCsv(
      ["date", "currency", "balance", "note"],
      sheets.cashSnapshots.map((c) => [c.date, c.currency, c.balance, c.note ?? ""])
    );
  }
  if (tab === "loans") {
    return toCsv(
      [
        "id",
        "name",
        "funding_tag",
        "start_date",
        "principal_twd",
        "disbursed_twd",
        "wire_fee_twd",
        "received_usd",
        "apr",
        "term_months",
        "monthly_payment_twd",
        "total_interest_twd",
        "status",
        "closed_date",
        "payoff_twd",
        "refinanced_payoff_twd",
        "note",
      ],
      (sheets.loans ?? []).map((l) => [
        l.id,
        l.name,
        l.fundingTag,
        l.startDate,
        l.principalTwd,
        l.disbursedTwd,
        l.wireFeeTwd,
        l.receivedUsd ?? "",
        l.apr,
        l.termMonths,
        l.monthlyPaymentTwd ?? "",
        l.totalInterestOverrideTwd ?? "",
        l.status ?? "active",
        l.closedDate ?? "",
        l.payoffTwd ?? "",
        l.refinancedPayoffTwd ?? "",
        l.note ?? "",
      ])
    );
  }
  return toCsv(
    ["symbol", "name", "yahoo_ticker", "currency", "scope"],
    sheets.benchmarks.map((b) => [
      b.symbol,
      b.name,
      b.yahooTicker,
      b.currency,
      b.scope,
    ])
  );
}
