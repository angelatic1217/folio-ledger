import type { MarketDataBundle } from "@/types/market";
import type {
  DailyPortfolioPoint,
  DrawdownSummary,
  MddThresholds,
  QuantEngineOutput,
  TimeRangePreset,
} from "@/types/quant";
import type { BenchmarkConfig, CashSnapshot, PortfolioSheetsData } from "@/types/sheet";
import { computeAnnualPerformanceByScope } from "./annual";
import {
  addDaysIso,
  buildForwardFilledBarMap,
  buildUnionTradingCalendar,
  findBarOnOrBefore,
} from "./calendar";
import {
  buildMddMatrix,
  computeDrawdownSeries,
  DEFAULT_MDD_THRESHOLDS,
} from "./drawdown";
import { computeHoldingsAsOf, toSplitAdjustedShares } from "./holdings";
import { computeDailySubperiodReturn, computeTransactionFlow } from "./returns";
import { buildSymbolPerformanceRows } from "./symbol-performance";

function getCashValueTwdOnDate(
  date: string,
  snapshots: CashSnapshot[],
  fxRate: number
): number {
  if (snapshots.length === 0) return 0;

  let latestTwd: CashSnapshot | null = null;
  let latestUsd: CashSnapshot | null = null;

  for (const s of snapshots) {
    if (s.date > date) continue;
    if (s.currency === "TWD" && (!latestTwd || s.date >= latestTwd.date)) {
      latestTwd = s;
    } else if (s.currency === "USD" && (!latestUsd || s.date >= latestUsd.date)) {
      latestUsd = s;
    }
  }

  return (latestTwd?.balance ?? 0) + (latestUsd?.balance ?? 0) * fxRate;
}

/**
 * Pure master entry point for the Quantitative Portfolio & Risk Engine.
 * Deterministically transforms Google Sheet tables + Historical Market Data
 * into daily TWR curves, Underwater Drawdown series, MDD Watchlist Matrix,
 * and Annual Alpha performance tables.
 */
export function runQuantEngine(
  sheets: PortfolioSheetsData,
  market: MarketDataBundle,
  thresholds: MddThresholds = DEFAULT_MDD_THRESHOLDS
): QuantEngineOutput {
  const { transactions, assets, cashSnapshots, benchmarks } = sheets;

  const sortedTxs = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  const assetMap = new Map(assets.map((a) => [a.symbol, a]));

  // Determine earliest and latest dates
  const firstTxDate = sortedTxs[0]?.date;
  const allBarDates: string[] = [];
  for (const ticker of Object.values(market.tickers)) {
    if (ticker.bars.length > 0) {
      allBarDates.push(ticker.bars[ticker.bars.length - 1].date);
    }
  }
  if (market.fxBars.length > 0) {
    allBarDates.push(market.fxBars[market.fxBars.length - 1].date);
  }
  const latestMarketDate =
    allBarDates.sort()[allBarDates.length - 1] ??
    sortedTxs[sortedTxs.length - 1]?.date ??
    new Date().toISOString().slice(0, 10);

  const calendar = firstTxDate
    ? buildUnionTradingCalendar(
        market,
        firstTxDate,
        latestMarketDate,
        sortedTxs.map((t) => t.date)
      )
    : [];

  // Precompute forward-filled price maps and FX map
  const fxMap = buildForwardFilledBarMap(market.fxBars, calendar);
  const priceMaps = new Map<string, Map<string, { date: string; close: number; adjClose: number }>>();
  const splitsBySymbol: Record<string, { date: string; ratio: number }[]> = {};
  const currencyBySymbol: Record<string, string> = {};

  for (const asset of assets) {
    const ticker = market.tickers[asset.symbol];
    currencyBySymbol[asset.symbol] = asset.currency;
    splitsBySymbol[asset.symbol] = ticker?.splits ?? [];
    if (ticker) {
      priceMaps.set(asset.symbol, buildForwardFilledBarMap(ticker.bars, calendar));
    }
  }

  const latestFxRate =
    findBarOnOrBefore(market.fxBars, latestMarketDate, true)?.close ?? 32.0;

  // Group transactions by date
  const txsByDate = new Map<string, typeof sortedTxs>();
  for (const tx of sortedTxs) {
    const arr = txsByDate.get(tx.date) ?? [];
    arr.push(tx);
    txsByDate.set(tx.date, arr);
  }

  // Step through every day on the unified calendar
  const runningShares = new Map<string, number>();
  const investedRawPoints: Omit<
    DailyPortfolioPoint,
    "peakTwrIndex" | "drawdown" | "peakDate" | "daysUnderwater"
  >[] = [];
  const totalRawPoints: Omit<
    DailyPortfolioPoint,
    "peakTwrIndex" | "drawdown" | "peakDate" | "daysUnderwater"
  >[] = [];

  let prevInvestedVal = 0;
  let prevTotalVal = 0;
  let prevCashVal = 0;
  let investedTwrIndex = 100;
  let totalTwrIndex = 100;
  let cumulativeDividendsTwd = 0;
  let cumulativeNetInvestedTwd = 0;

  for (let i = 0; i < calendar.length; i++) {
    const date = calendar[i];
    const fxRate =
      fxMap.get(date)?.close ??
      findBarOnOrBefore(market.fxBars, date, true)?.close ??
      latestFxRate;

    const dayTxs = txsByDate.get(date) ?? [];
    let dayInflow = 0;
    let dayOutflow = 0;
    let dayDividend = 0;

    for (const tx of dayTxs) {
      const asset = assetMap.get(tx.symbol);
      const currency = asset?.currency ?? "TWD";
      const splits = splitsBySymbol[tx.symbol] ?? [];
      const adjShares = toSplitAdjustedShares(tx, splits);
      const curShares = runningShares.get(tx.symbol) ?? 0;

      if (tx.type === "BUY" || tx.type === "DRIP") {
        runningShares.set(tx.symbol, curShares + adjShares);
      } else if (tx.type === "SELL") {
        const next = Math.max(0, curShares - adjShares);
        runningShares.set(tx.symbol, next < 1e-9 ? 0 : next);
      }

      const flow = computeTransactionFlow(tx, currency, fxRate);
      dayInflow += flow.inflowTwd;
      dayOutflow += flow.outflowTwd;
      dayDividend += flow.dividendTwd;
    }

    cumulativeDividendsTwd += dayDividend;
    cumulativeNetInvestedTwd += dayInflow - dayOutflow;

    // Daily portfolio valuation across all held symbols
    let twValueTwd = 0;
    let usValueTwd = 0;

    for (const [symbol, shares] of runningShares.entries()) {
      if (shares <= 1e-9) continue;
      const asset = assetMap.get(symbol);
      const bar = priceMaps.get(symbol)?.get(date);
      if (!bar) continue;

      const currency = asset?.currency ?? "TWD";
      const marketCode = asset?.market ?? "TW";
      const valueTwd = shares * bar.close * (currency === "TWD" ? 1 : fxRate);

      if (marketCode === "US") usValueTwd += valueTwd;
      else twValueTwd += valueTwd;
    }

    const investedValueTwd = twValueTwd + usValueTwd;
    const cashValueTwd = getCashValueTwdOnDate(date, cashSnapshots, fxRate);
    const totalValueTwd = investedValueTwd + cashValueTwd;

    // 1. Invested-only Daily TWR
    const investedDailyReturn = computeDailySubperiodReturn({
      prevValue: prevInvestedVal,
      endValue: investedValueTwd,
      inflow: dayInflow,
      outflow: dayOutflow,
    });
    investedTwrIndex *= 1 + investedDailyReturn;

    // 2. Total-assets (including cash snapshots) Daily TWR
    // When cash balance steps up/down on a snapshot date, treat net external cash flow
    // as (stockInflow - stockOutflow) + (cashValueTwd - prevCashVal) so cash deposits don't fake returns.
    const cashDelta = i === 0 ? cashValueTwd : cashValueTwd - prevCashVal;
    const totalNetFlow = dayInflow - dayOutflow + cashDelta;
    const totalInflow = Math.max(0, totalNetFlow);
    const totalOutflow = Math.max(0, -totalNetFlow);
    const totalDailyReturn = computeDailySubperiodReturn({
      prevValue: prevTotalVal,
      endValue: totalValueTwd,
      inflow: totalInflow,
      outflow: totalOutflow,
    });
    totalTwrIndex *= 1 + totalDailyReturn;

    const baseFields = {
      date,
      investedValueTwd,
      cashValueTwd,
      totalValueTwd,
      twValueTwd,
      usValueTwd,
      fxRate,
      externalCashFlowTwd: dayInflow - dayOutflow,
      dividendIncomeTwd: dayDividend,
    };

    investedRawPoints.push({
      ...baseFields,
      dailyReturn: investedDailyReturn,
      twrIndex: investedTwrIndex,
    });
    totalRawPoints.push({
      ...baseFields,
      dailyReturn: totalDailyReturn,
      twrIndex: totalTwrIndex,
    });

    prevInvestedVal = investedValueTwd;
    prevTotalVal = totalValueTwd;
    prevCashVal = cashValueTwd;
  }

  // Attach Drawdown series derived strictly from TWR Wealth Index
  const invDd = computeDrawdownSeries(
    investedRawPoints.map((p) => ({ date: p.date, value: p.twrIndex }))
  );
  const totDd = computeDrawdownSeries(
    totalRawPoints.map((p) => ({ date: p.date, value: p.twrIndex }))
  );

  const investedSeries: DailyPortfolioPoint[] = investedRawPoints.map((p, idx) => ({
    ...p,
    peakTwrIndex: invDd.series[idx].peak,
    drawdown: invDd.series[idx].drawdown,
    peakDate: invDd.series[idx].peakDate,
    daysUnderwater: invDd.series[idx].daysUnderwater,
  }));

  const totalSeries: DailyPortfolioPoint[] = totalRawPoints.map((p, idx) => ({
    ...p,
    peakTwrIndex: totDd.series[idx].peak,
    drawdown: totDd.series[idx].drawdown,
    peakDate: totDd.series[idx].peakDate,
    daysUnderwater: totDd.series[idx].daysUnderwater,
  }));

  const lastPoint = investedSeries[investedSeries.length - 1];
  const totalInvestedValueTwd = lastPoint?.investedValueTwd ?? 0;
  const totalCashValueTwd = lastPoint?.cashValueTwd ?? 0;
  const totalTwValueTwd = lastPoint?.twValueTwd ?? 0;
  const totalUsValueTwd = lastPoint?.usValueTwd ?? 0;

  const fxLookup = (date: string, currency: string, txFx?: number | null) => {
    if (currency === "TWD") return 1;
    if (txFx && txFx > 0) return txFx;
    return findBarOnOrBefore(market.fxBars, date, true)?.close ?? latestFxRate;
  };

  const finalHoldings = computeHoldingsAsOf(
    sortedTxs,
    splitsBySymbol,
    fxLookup,
    currencyBySymbol,
    latestMarketDate
  );

  let totalCostBasisTwd = 0;
  for (const pos of finalHoldings.values()) {
    totalCostBasisTwd += pos.costBasisTwd;
  }

  const mddMatrix = buildMddMatrix({
    assets,
    market,
    holdings: finalHoldings,
    latestFxRate,
    totalInvestedTwd: totalInvestedValueTwd,
    thresholds,
  });

  const symbolPerformance = buildSymbolPerformanceRows({
    assets,
    transactions: sortedTxs,
    market,
    holdings: finalHoldings,
    latestFxRate,
    totalInvestedTwd: totalInvestedValueTwd,
    asOfDate: latestMarketDate,
  });

  const annualByScope = computeAnnualPerformanceByScope({
    transactions: sortedTxs,
    assets,
    benchmarks,
    market,
    investedSeries,
  });

  return {
    asOfDate: latestMarketDate,
    latestFxRate,
    investedSeries,
    totalSeries,
    mddMatrix,
    symbolPerformance,
    annualByScope,
    totalCostBasisTwd,
    totalInvestedValueTwd,
    totalCashValueTwd,
    totalTwValueTwd,
    totalUsValueTwd,
    cumulativeDividendsTwd,
    cumulativeNetInvestedTwd,
  };
}

/**
 * Slices a DailyPortfolioPoint series by preset range, re-normalizing the TWR index
 * to 100 at the start of the window and recomputing window-specific drawdown stats.
 */
export function sliceSeriesByRange(
  series: DailyPortfolioPoint[],
  range: TimeRangePreset
): {
  points: DailyPortfolioPoint[];
  drawdownSummary: DrawdownSummary;
  rangeTwr: number;
} {
  if (series.length === 0) {
    return {
      points: [],
      drawdownSummary: {
        maxDrawdown: 0,
        maxDrawdownDate: "",
        maxDrawdownPeakDate: "",
        recoveryDays: null,
        currentDrawdown: 0,
        currentPeakDate: "",
        currentDaysUnderwater: 0,
      },
      rangeTwr: 0,
    };
  }

  const endDate = series[series.length - 1].date;
  let cutoff = series[0].date;

  if (range === "1M") cutoff = addDaysIso(endDate, -31);
  else if (range === "3M") cutoff = addDaysIso(endDate, -92);
  else if (range === "6M") cutoff = addDaysIso(endDate, -183);
  else if (range === "YTD") cutoff = `${endDate.slice(0, 4)}-01-01`;
  else if (range === "1Y") cutoff = addDaysIso(endDate, -365);
  else if (range === "3Y") cutoff = addDaysIso(endDate, -1095);

  const sliced =
    range === "ALL" ? series : series.filter((pt) => pt.date >= cutoff);
  const effective = sliced.length >= 2 ? sliced : series;

  const baseTwr = effective[0].twrIndex || 100;
  const normalizedValues = effective.map((pt) => ({
    date: pt.date,
    value: (pt.twrIndex / baseTwr) * 100,
  }));

  const dd = computeDrawdownSeries(normalizedValues);

  const points: DailyPortfolioPoint[] = effective.map((pt, idx) => ({
    ...pt,
    twrIndex: normalizedValues[idx].value,
    peakTwrIndex: dd.series[idx].peak,
    drawdown: dd.series[idx].drawdown,
    peakDate: dd.series[idx].peakDate,
    daysUnderwater: dd.series[idx].daysUnderwater,
  }));

  const rangeTwr = points[points.length - 1].twrIndex / 100 - 1;
  return {
    points,
    drawdownSummary: dd.summary,
    rangeTwr,
  };
}

/**
 * Builds normalized (base = 100) TWD-equivalent benchmark comparison series
 * aligned to the dates of `portfolioPoints`.
 */
export function buildNormalizedBenchmarkCurves(params: {
  portfolioPoints: DailyPortfolioPoint[];
  benchmarks: BenchmarkConfig[];
  market: MarketDataBundle;
}): Record<string, Map<string, number>> {
  const { portfolioPoints, benchmarks, market } = params;
  const result: Record<string, Map<string, number>> = {};
  if (portfolioPoints.length === 0) return result;

  const dates = portfolioPoints.map((p) => p.date);
  const fxMap = buildForwardFilledBarMap(market.fxBars, dates);

  for (const bench of benchmarks) {
    const ticker = market.tickers[bench.symbol];
    if (!ticker || ticker.bars.length === 0) continue;

    const barMap = buildForwardFilledBarMap(ticker.bars, dates);
    let baseVal: number | null = null;
    const curve = new Map<string, number>();

    for (const date of dates) {
      const bar = barMap.get(date);
      if (!bar) continue;
      const fx = bench.currency === "TWD" ? 1 : fxMap.get(date)?.close ?? 32;
      const valTwd = bar.adjClose * fx;
      if (baseVal === null) baseVal = valTwd;
      if (baseVal > 0) {
        curve.set(date, (valTwd / baseVal) * 100);
      }
    }

    result[bench.symbol] = curve;
  }

  return result;
}

export interface PortfolioCapitalPoint {
  date: string;
  netPrincipalTwd: number;
  displayPrincipalTwd: number;
  marketValueTwd: number;
  cumulativeDividendsTwd: number;
  totalWealthInclDivTwd: number;
}

export interface PortfolioCapitalMetrics {
  points: PortfolioCapitalPoint[];
  /** Current net out-of-pocket capital (cumulative BUY - SELL, plus cash snapshots when scope === "total"). Unaffected by swaps. */
  netPrincipalTwd: number;
  /** Peak historical net capital ever committed (guards return/MOIC denominator when principal has been withdrawn). */
  peakNetPrincipalTwd: number;
  /** Stable capital base denominator for total return % and MOIC without swap dilution. */
  effectiveCapitalBaseTwd: number;
}

/**
 * Computes pure out-of-pocket net invested capital over time (cumulative BUY - SELL)
 * so swaps/rebalancing do not inflate the investor's principal cost basis or dilute MOIC.
 */
export function computePortfolioCapitalMetrics(
  series: DailyPortfolioPoint[],
  scope: "invested" | "total"
): PortfolioCapitalMetrics {
  if (series.length === 0) {
    return {
      points: [],
      netPrincipalTwd: 0,
      peakNetPrincipalTwd: 0,
      effectiveCapitalBaseTwd: 0,
    };
  }

  let cumNetPrincipalTwd = 0;
  let peakNetPrincipalTwd = 0;
  let cumDivTwd = 0;
  let prevCashTwd = 0;

  const points: PortfolioCapitalPoint[] = series.map((pt, idx) => {
    cumDivTwd += pt.dividendIncomeTwd;
    // externalCashFlowTwd = BUY - SELL - DIVIDEND => BUY - SELL = externalCashFlowTwd + dividendIncomeTwd
    const netBuyMinusSell = pt.externalCashFlowTwd + pt.dividendIncomeTwd;
    const cashDelta =
      scope === "total"
        ? idx === 0
          ? pt.cashValueTwd
          : pt.cashValueTwd - prevCashTwd
        : 0;
    cumNetPrincipalTwd += netBuyMinusSell + cashDelta;
    prevCashTwd = pt.cashValueTwd;

    if (cumNetPrincipalTwd > peakNetPrincipalTwd) {
      peakNetPrincipalTwd = cumNetPrincipalTwd;
    }

    const marketValueTwd =
      scope === "total" ? pt.totalValueTwd : pt.investedValueTwd;

    return {
      date: pt.date,
      netPrincipalTwd: cumNetPrincipalTwd,
      displayPrincipalTwd: Math.max(0, cumNetPrincipalTwd),
      marketValueTwd,
      cumulativeDividendsTwd: cumDivTwd,
      totalWealthInclDivTwd: marketValueTwd + cumDivTwd,
    };
  });

  const effectiveCapitalBaseTwd =
    cumNetPrincipalTwd > 1e-6
      ? Math.max(cumNetPrincipalTwd, peakNetPrincipalTwd)
      : peakNetPrincipalTwd;

  return {
    points,
    netPrincipalTwd: cumNetPrincipalTwd,
    peakNetPrincipalTwd,
    effectiveCapitalBaseTwd,
  };
}
