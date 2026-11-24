import type { DailyBar, MarketDataBundle } from "@/types/market";
import type {
  MddLookbackPreset,
  SymbolHoldingStatus,
  SymbolLookbackMetrics,
  SymbolPerformanceRow,
  SymbolWealthPoint,
} from "@/types/quant";
import type { Asset, CurrencyCode, Transaction } from "@/types/sheet";
import { addDaysIso, diffCalendarDays, findBarOnOrBefore } from "./calendar";
import { computeDrawdownSeries } from "./drawdown";
import { type HoldingPosition, toSplitAdjustedShares } from "./holdings";
import {
  computeAnnualizedReturn,
  computeXirr,
  type DatedCashFlow,
} from "./returns";

const DEFAULT_RISK_FREE_RATE = 0.02;

/**
 * Computes long-term market quality metrics (CAGR, annualized volatility, MDD,
 * Calmar ratio, Sharpe ratio) from dividend/split-adjusted close bars over a lookback window.
 */
export function computeSymbolLookbackMetrics(
  bars: DailyBar[],
  lookback: MddLookbackPreset,
  riskFreeRate = DEFAULT_RISK_FREE_RATE
): SymbolLookbackMetrics {
  if (bars.length < 2) {
    return {
      cagr: null,
      volatility: null,
      maxDrawdown: 0,
      calmar: null,
      sharpe: null,
      totalReturn: null,
      years: 0,
    };
  }

  let effective = bars;
  if (lookback !== "MAX") {
    const lookbackDays = lookback === "5Y" ? 365 * 5 : 365 * 10;
    const latestDate = bars[bars.length - 1].date;
    const cutoff = addDaysIso(latestDate, -lookbackDays);
    const sliced = bars.filter((b) => b.date >= cutoff);
    effective = sliced.length >= 2 ? sliced : bars;
  }

  const first = effective[0];
  const last = effective[effective.length - 1];
  const days = Math.max(1, diffCalendarDays(first.date, last.date));
  const years = days / 365;

  const totalReturn =
    first.adjClose > 0 ? (last.adjClose - first.adjClose) / first.adjClose : null;
  const cagr =
    totalReturn !== null ? computeAnnualizedReturn(totalReturn, days) : null;

  const { summary } = computeDrawdownSeries(
    effective.map((b) => ({ date: b.date, value: b.adjClose }))
  );

  // Annualized volatility from daily adjusted-close log/simple returns
  const dailyReturns: number[] = [];
  for (let i = 1; i < effective.length; i++) {
    const prev = effective[i - 1].adjClose;
    const curr = effective[i].adjClose;
    if (prev > 0 && curr > 0) {
      dailyReturns.push((curr - prev) / prev);
    }
  }

  let volatility: number | null = null;
  if (dailyReturns.length >= 20) {
    const mean =
      dailyReturns.reduce((acc, r) => acc + r, 0) / dailyReturns.length;
    let sumSq = 0;
    for (const r of dailyReturns) {
      const diff = r - mean;
      sumSq += diff * diff;
    }
    const variance = sumSq / (dailyReturns.length - 1);
    volatility = Math.sqrt(variance) * Math.sqrt(252);
  }

  const calmar =
    cagr !== null && summary.maxDrawdown < -1e-4
      ? cagr / Math.abs(summary.maxDrawdown)
      : null;

  const sharpe =
    cagr !== null && volatility !== null && volatility > 1e-6
      ? (cagr - riskFreeRate) / volatility
      : null;

  return {
    cagr,
    volatility,
    maxDrawdown: summary.maxDrawdown,
    calmar,
    sharpe,
    totalReturn,
    years,
  };
}

/**
 * Builds the historical wealth growth series (cumulative cost basis vs market value
 * & cumulative dividends) for a single symbol from its first buy date to `asOfDate`.
 */
function buildSymbolWealthSeries(params: {
  symbolTxs: Transaction[];
  bars: DailyBar[];
  splits: { date: string; ratio: number }[];
  currency: CurrencyCode;
  fxBars: DailyBar[];
  latestFxRate: number;
  firstBuyDate: string;
  asOfDate: string;
}): SymbolWealthPoint[] {
  const {
    symbolTxs,
    bars,
    splits,
    currency,
    fxBars,
    latestFxRate,
    firstBuyDate,
    asOfDate,
  } = params;

  const sortedTxs = [...symbolTxs]
    .filter((tx) => tx.date <= asOfDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  const txsByDate = new Map<string, Transaction[]>();
  for (const tx of sortedTxs) {
    const list = txsByDate.get(tx.date) ?? [];
    list.push(tx);
    txsByDate.set(tx.date, list);
  }

  const dateSet = new Set<string>();
  for (const bar of bars) {
    if (bar.date >= firstBuyDate && bar.date <= asOfDate) {
      dateSet.add(bar.date);
    }
  }
  for (const tx of sortedTxs) {
    if (tx.date >= firstBuyDate && tx.date <= asOfDate) {
      dateSet.add(tx.date);
    }
  }
  const dates = Array.from(dateSet).sort();
  if (dates.length === 0) return [];

  let runningShares = 0;
  let costBasisTwd = 0;
  let cumulativeDividendsTwd = 0;

  let barIdx = 0;
  let lastBar: DailyBar | null = findBarOnOrBefore(bars, dates[0], true);
  let fxIdx = 0;
  let lastFxBar: DailyBar | null = findBarOnOrBefore(fxBars, dates[0], true);

  const series: SymbolWealthPoint[] = [];

  for (const date of dates) {
    while (barIdx < bars.length && bars[barIdx].date <= date) {
      lastBar = bars[barIdx];
      barIdx++;
    }
    while (fxIdx < fxBars.length && fxBars[fxIdx].date <= date) {
      lastFxBar = fxBars[fxIdx];
      fxIdx++;
    }

    const spotFx = lastFxBar?.close ?? latestFxRate;
    const dayTxs = txsByDate.get(date) ?? [];

    for (const tx of dayTxs) {
      const adjShares = toSplitAdjustedShares(tx, splits);
      const txFx =
        currency === "TWD"
          ? 1
          : tx.fxRate && tx.fxRate > 0
            ? tx.fxRate
            : spotFx;

      if (tx.type === "BUY") {
        runningShares += adjShares;
        costBasisTwd += (tx.shares * tx.price + tx.fee) * txFx;
      } else if (tx.type === "DRIP") {
        runningShares += adjShares;
      } else if (tx.type === "SELL") {
        if (runningShares > 0) {
          const sellRatio = Math.min(1, adjShares / runningShares);
          costBasisTwd = Math.max(0, costBasisTwd * (1 - sellRatio));
        }
        runningShares = Math.max(0, runningShares - adjShares);
        if (runningShares < 1e-9) {
          runningShares = 0;
          costBasisTwd = 0;
        }
      } else if (tx.type === "DIVIDEND") {
        cumulativeDividendsTwd += Math.max(0, tx.shares * tx.price - tx.fee) * txFx;
      }
    }

    if (!lastBar) continue;
    const valuationFx = currency === "TWD" ? 1 : spotFx;
    const marketValueTwd = runningShares * lastBar.close * valuationFx;

    series.push({
      date,
      costBasisTwd,
      marketValueTwd,
      cumulativeDividendsTwd,
      totalValueInclDivTwd: marketValueTwd + cumulativeDividendsTwd,
      adjClose: lastBar.adjClose,
    });
  }

  return series;
}

/**
 * Builds the individual asset return & long-term compounding table.
 * Pure, deterministic function compatible with both TWD and USD reporting currencies.
 */
export function buildSymbolPerformanceRows(params: {
  assets: Asset[];
  transactions: Transaction[];
  market: MarketDataBundle;
  holdings: Map<string, HoldingPosition>;
  latestFxRate: number;
  totalInvestedTwd: number;
  asOfDate: string;
}): SymbolPerformanceRow[] {
  const {
    assets,
    transactions,
    market,
    holdings,
    latestFxRate,
    totalInvestedTwd,
    asOfDate,
  } = params;

  const txsBySymbol = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (tx.date > asOfDate) continue;
    const list = txsBySymbol.get(tx.symbol) ?? [];
    list.push(tx);
    txsBySymbol.set(tx.symbol, list);
  }

  const rows: SymbolPerformanceRow[] = [];

  for (const asset of assets) {
    const pos = holdings.get(asset.symbol);
    const heldShares = pos?.splitAdjustedShares ?? 0;
    const isHeld = heldShares > 1e-6;
    const hasHistory = (pos?.txCount ?? 0) > 0;

    if (!asset.monitorMdd && !isHeld && !hasHistory) continue;

    const tickerData = market.tickers[asset.symbol];
    if (!tickerData || tickerData.bars.length === 0) continue;

    const lastBar =
      findBarOnOrBefore(tickerData.bars, asOfDate, true) ??
      tickerData.bars[tickerData.bars.length - 1];
    const latestPrice = lastBar.close;
    const latestDate = lastBar.date;
    const fx = asset.currency === "TWD" ? 1 : latestFxRate;

    const status: SymbolHoldingStatus = isHeld
      ? "held"
      : hasHistory
        ? "closed"
        : "watch";

    const costBasisLocal = isHeld ? pos?.costBasisLocal ?? 0 : 0;
    const costBasisTwd = isHeld ? pos?.costBasisTwd ?? 0 : 0;
    const totalInvestedLocal = pos?.totalInvestedLocal ?? 0;
    const totalInvestedTwdSym = pos?.totalInvestedTwd ?? 0;

    const marketValueLocal = isHeld ? heldShares * latestPrice : 0;
    const marketValueTwd = marketValueLocal * fx;

    const avgCostLocal =
      isHeld && heldShares > 1e-6 ? costBasisLocal / heldShares : null;
    const cumulativeDividendsLocal = pos?.cumulativeDividendsLocal ?? 0;
    const cumulativeDividendsTwd = pos?.cumulativeDividendsTwd ?? 0;
    const breakevenPriceLocal =
      isHeld && heldShares > 1e-6
        ? Math.max(0, (costBasisLocal - cumulativeDividendsLocal) / heldShares)
        : null;
    const priceVsAvgCostPct =
      avgCostLocal !== null && avgCostLocal > 1e-6
        ? (latestPrice - avgCostLocal) / avgCostLocal
        : null;

    const unrealizedPnlLocal = isHeld ? marketValueLocal - costBasisLocal : 0;
    const unrealizedPnlTwd = isHeld ? marketValueTwd - costBasisTwd : 0;
    const unrealizedPnlPctLocal =
      isHeld && costBasisLocal > 1e-6
        ? unrealizedPnlLocal / costBasisLocal
        : null;
    const unrealizedPnlPctTwd =
      isHeld && costBasisTwd > 1e-6 ? unrealizedPnlTwd / costBasisTwd : null;

    const realizedPnlLocal = pos?.realizedPnlLocal ?? 0;
    const realizedPnlTwd = pos?.realizedPnlTwd ?? 0;

    const totalPnlLocal =
      unrealizedPnlLocal + realizedPnlLocal + cumulativeDividendsLocal;
    const totalPnlTwd =
      unrealizedPnlTwd + realizedPnlTwd + cumulativeDividendsTwd;

    const totalReturnPctLocal =
      totalInvestedLocal > 1e-6 ? totalPnlLocal / totalInvestedLocal : null;
    const totalReturnPctTwd =
      totalInvestedTwdSym > 1e-6 ? totalPnlTwd / totalInvestedTwdSym : null;
    const wealthMultipleTwd =
      totalInvestedTwdSym > 1e-6
        ? (totalInvestedTwdSym + totalPnlTwd) / totalInvestedTwdSym
        : null;
    const dividendRecoveryPct =
      totalInvestedTwdSym > 1e-6
        ? cumulativeDividendsTwd / totalInvestedTwdSym
        : null;

    const weightPct =
      isHeld && totalInvestedTwd > 0
        ? (marketValueTwd / totalInvestedTwd) * 100
        : 0;

    // US FX Attribution (reconciles identically with loan.ts: unrealizedPnlTwd = equityPnlTwd + fxPnlTwd)
    let avgEntryFxRate: number | null = null;
    let fxPnlTwd: number | null = null;
    let equityPnlTwd = unrealizedPnlTwd;

    if (asset.currency === "USD") {
      if (isHeld && costBasisLocal > 1e-6) {
        avgEntryFxRate = costBasisTwd / costBasisLocal;
        fxPnlTwd = costBasisLocal * latestFxRate - costBasisTwd;
        equityPnlTwd = unrealizedPnlTwd - fxPnlTwd;
      } else if (totalInvestedLocal > 1e-6) {
        avgEntryFxRate = totalInvestedTwdSym / totalInvestedLocal;
        fxPnlTwd = null;
        equityPnlTwd = 0;
      }
    }

    // Personal XIRR cash flows in TWD, USD, and local currency
    const symbolTxs = txsBySymbol.get(asset.symbol) ?? [];
    const xirrFlowsTwd: DatedCashFlow[] = [];
    const xirrFlowsUsd: DatedCashFlow[] = [];
    const xirrFlowsLocal: DatedCashFlow[] = [];

    for (const tx of symbolTxs) {
      const spotFx =
        findBarOnOrBefore(market.fxBars, tx.date, true)?.close ?? latestFxRate;
      const effectiveFx =
        asset.currency === "TWD"
          ? 1
          : tx.fxRate && tx.fxRate > 0
            ? tx.fxRate
            : spotFx;
      const usdDivisor = tx.fxRate && tx.fxRate > 0 ? tx.fxRate : spotFx;

      if (tx.type === "BUY") {
        const localAmt = tx.shares * tx.price + tx.fee;
        const twdAmt = localAmt * effectiveFx;
        const usdAmt =
          asset.currency === "USD" ? localAmt : twdAmt / (usdDivisor || 32);
        xirrFlowsLocal.push({ date: tx.date, amount: -localAmt });
        xirrFlowsTwd.push({ date: tx.date, amount: -twdAmt });
        xirrFlowsUsd.push({ date: tx.date, amount: -usdAmt });
      } else if (tx.type === "SELL" || tx.type === "DIVIDEND") {
        const localAmt = Math.max(0, tx.shares * tx.price - tx.fee);
        const twdAmt = localAmt * effectiveFx;
        const usdAmt =
          asset.currency === "USD" ? localAmt : twdAmt / (usdDivisor || 32);
        xirrFlowsLocal.push({ date: tx.date, amount: localAmt });
        xirrFlowsTwd.push({ date: tx.date, amount: twdAmt });
        xirrFlowsUsd.push({ date: tx.date, amount: usdAmt });
      }
      // DRIP has 0 external cash flow (shares compound into terminal market value)
    }

    if (isHeld && marketValueTwd > 1e-6) {
      xirrFlowsLocal.push({ date: latestDate, amount: marketValueLocal });
      xirrFlowsTwd.push({ date: latestDate, amount: marketValueTwd });
      xirrFlowsUsd.push({
        date: latestDate,
        amount:
          asset.currency === "USD"
            ? marketValueLocal
            : marketValueTwd / (latestFxRate || 32),
      });
    }

    const xirrTwd = computeXirr(xirrFlowsTwd);
    const xirrUsd = computeXirr(xirrFlowsUsd);
    const xirrLocal =
      asset.currency === "TWD"
        ? xirrTwd
        : computeXirr(xirrFlowsLocal);

    const firstBuyDate = pos?.firstBuyDate ?? null;
    const endTenureDate = isHeld
      ? latestDate
      : pos?.closedDate ?? pos?.lastTxDate ?? latestDate;
    const holdingDays = firstBuyDate
      ? Math.max(0, diffCalendarDays(firstBuyDate, endTenureDate))
      : 0;

    const barsUpToAsOf = tickerData.bars.filter((b) => b.date <= asOfDate);
    const effectiveBars =
      barsUpToAsOf.length >= 2 ? barsUpToAsOf : tickerData.bars;

    const marketMetrics: Record<MddLookbackPreset, SymbolLookbackMetrics> = {
      "5Y": computeSymbolLookbackMetrics(effectiveBars, "5Y"),
      "10Y": computeSymbolLookbackMetrics(effectiveBars, "10Y"),
      MAX: computeSymbolLookbackMetrics(effectiveBars, "MAX"),
    };

    const wealthSeries = firstBuyDate
      ? buildSymbolWealthSeries({
          symbolTxs,
          bars: effectiveBars,
          splits: tickerData.splits ?? [],
          currency: asset.currency,
          fxBars: market.fxBars,
          latestFxRate,
          firstBuyDate,
          asOfDate,
        })
      : [];

    rows.push({
      symbol: asset.symbol,
      name:
        asset.name && asset.name !== asset.symbol
          ? asset.name
          : tickerData.name ?? asset.symbol,
      market: asset.market,
      currency: asset.currency,
      yahooTicker: tickerData.yahooTicker || asset.yahooTicker,
      status,
      held: isHeld,
      shares: heldShares,
      dripShares: pos?.dripShares ?? 0,
      weightPct,
      latestPrice,
      latestDate,
      firstMarketDate: effectiveBars[0].date,
      avgCostLocal,
      breakevenPriceLocal,
      priceVsAvgCostPct,
      costBasisLocal,
      costBasisTwd,
      totalInvestedLocal,
      totalInvestedTwd: totalInvestedTwdSym,
      marketValueLocal,
      marketValueTwd,
      unrealizedPnlLocal,
      unrealizedPnlTwd,
      unrealizedPnlPctLocal,
      unrealizedPnlPctTwd,
      realizedPnlLocal,
      realizedPnlTwd,
      cumulativeDividendsLocal,
      cumulativeDividendsTwd,
      dividendRecoveryPct,
      totalFeesTwd: pos?.totalFeesTwd ?? 0,
      totalPnlLocal,
      totalPnlTwd,
      totalReturnPctLocal,
      totalReturnPctTwd,
      wealthMultipleTwd,
      avgEntryFxRate,
      equityPnlTwd,
      fxPnlTwd,
      firstBuyDate,
      lastTxDate: pos?.lastTxDate ?? null,
      holdingDays,
      txCount: pos?.txCount ?? 0,
      xirrTwd,
      xirrUsd,
      xirrLocal,
      marketMetrics,
      wealthSeries,
      marketSeries: effectiveBars.map((b) => ({
        date: b.date,
        adjClose: b.adjClose,
      })),
    });
  }

  return rows.sort((a, b) => {
    if (a.held !== b.held) return a.held ? -1 : 1;
    if (b.marketValueTwd !== a.marketValueTwd) {
      return b.marketValueTwd - a.marketValueTwd;
    }
    return b.totalPnlTwd - a.totalPnlTwd;
  });
}

/**
 * Computes combined money-weighted XIRR across an arbitrary filtered subset of symbols
 * (e.g. "ALL", "TW", "US", "HELD") so the summary KPI card reflects the exact active filter.
 */
export function computeSubsetAggregateXirr(params: {
  symbols: Set<string>;
  rows: SymbolPerformanceRow[];
  transactions: Transaction[];
  assets: Asset[];
  market: MarketDataBundle;
  asOfDate: string;
  latestFxRate: number;
  currency: CurrencyCode;
}): number | null {
  const {
    symbols,
    rows,
    transactions,
    assets,
    market,
    asOfDate,
    latestFxRate,
    currency,
  } = params;

  if (symbols.size === 0) return null;

  const assetMap = new Map(assets.map((a) => [a.symbol, a]));
  const flows: DatedCashFlow[] = [];

  for (const tx of transactions) {
    if (tx.date > asOfDate || !symbols.has(tx.symbol)) continue;
    const assetCurrency = assetMap.get(tx.symbol)?.currency ?? "TWD";
    const spotFx =
      findBarOnOrBefore(market.fxBars, tx.date, true)?.close ?? latestFxRate;
    const effectiveFx =
      assetCurrency === "TWD"
        ? 1
        : tx.fxRate && tx.fxRate > 0
          ? tx.fxRate
          : spotFx;
    const usdDivisor = tx.fxRate && tx.fxRate > 0 ? tx.fxRate : spotFx;

    if (tx.type === "BUY") {
      const localAmt = tx.shares * tx.price + tx.fee;
      const twdAmt = localAmt * effectiveFx;
      const amt =
        currency === "TWD"
          ? twdAmt
          : assetCurrency === "USD"
            ? localAmt
            : twdAmt / (usdDivisor || 32);
      flows.push({ date: tx.date, amount: -amt });
    } else if (tx.type === "SELL" || tx.type === "DIVIDEND") {
      const localAmt = Math.max(0, tx.shares * tx.price - tx.fee);
      const twdAmt = localAmt * effectiveFx;
      const amt =
        currency === "TWD"
          ? twdAmt
          : assetCurrency === "USD"
            ? localAmt
            : twdAmt / (usdDivisor || 32);
      flows.push({ date: tx.date, amount: amt });
    }
  }

  let terminalValue = 0;
  for (const row of rows) {
    if (!symbols.has(row.symbol) || !row.held) continue;
    terminalValue +=
      currency === "TWD"
        ? row.marketValueTwd
        : row.currency === "USD"
          ? row.marketValueLocal
          : row.marketValueTwd / (latestFxRate || 32);
  }

  if (terminalValue > 1e-6) {
    flows.push({ date: asOfDate, amount: terminalValue });
  }

  return computeXirr(flows);
}
