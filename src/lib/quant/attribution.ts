import type { MarketDataBundle } from "@/types/market";
import type {
  DailyPortfolioPoint,
  PeriodHoldingAttribution,
  PeriodPerformanceSummary,
  PortfolioScope,
} from "@/types/quant";
import type { Asset, Transaction } from "@/types/sheet";
import { diffCalendarDays, findBarOnOrBefore } from "./calendar";
import { computeHoldingsAsOf } from "./holdings";
import {
  computeAnnualizedReturn,
  computeModifiedDietz,
  computeTransactionFlow,
  type DatedCashFlow,
} from "./returns";

/**
 * Computes exact period performance (Modified Dietz, TWR, P&L) and per-holding
 * FX attribution (`twdReturn = (1 + localReturn) * (1 + fxReturn) - 1`).
 */
export function computePeriodPerformance(params: {
  startDate: string;
  endDate: string;
  transactions: Transaction[];
  assets: Asset[];
  market: MarketDataBundle;
  dailySeries: DailyPortfolioPoint[];
  scope: PortfolioScope;
}): PeriodPerformanceSummary {
  const {
    startDate,
    endDate,
    transactions,
    assets,
    market,
    dailySeries,
    scope,
  } = params;

  const normalizedStart = startDate <= endDate ? startDate : endDate;
  const normalizedEnd = startDate <= endDate ? endDate : startDate;
  const calendarDays = Math.max(1, diffCalendarDays(normalizedStart, normalizedEnd));

  const startFxBar = findBarOnOrBefore(market.fxBars, normalizedStart, true);
  const endFxBar = findBarOnOrBefore(market.fxBars, normalizedEnd, true);
  const startFx = startFxBar?.close ?? 32;
  const endFx = endFxBar?.close ?? startFx;
  const fxReturn = startFx > 0 ? (endFx - startFx) / startFx : 0;

  // Locate daily series points for start (on or before startDate) and end (on or before endDate)
  const findPointOnOrBefore = (target: string): DailyPortfolioPoint | null => {
    let best: DailyPortfolioPoint | null = null;
    for (const pt of dailySeries) {
      if (pt.date <= target) best = pt;
      else break;
    }
    return best;
  };

  const startPt = findPointOnOrBefore(normalizedStart);
  const endPt = findPointOnOrBefore(normalizedEnd);

  const getValue = (pt: DailyPortfolioPoint | null) =>
    !pt ? 0 : scope === "total" ? pt.totalValueTwd : pt.investedValueTwd;

  const startValueTwd = getValue(startPt);
  const endValueTwd = getValue(endPt);

  // TWR across the period from the unitized wealth index
  let twr = 0;
  if (endPt) {
    const startIdx = startPt ? startPt.twrIndex : 100;
    twr = startIdx > 0 ? endPt.twrIndex / startIdx - 1 : 0;
  }

  const assetMap = new Map(assets.map((a) => [a.symbol, a]));
  const currencyBySymbol: Record<string, string> = {};
  const splitsBySymbol: Record<string, { date: string; ratio: number }[]> = {};
  for (const a of assets) {
    currencyBySymbol[a.symbol] = a.currency;
    splitsBySymbol[a.symbol] = market.tickers[a.symbol]?.splits ?? [];
  }

  const fxLookup = (date: string, currency: string, txFx?: number | null) => {
    if (currency === "TWD") return 1;
    if (txFx && txFx > 0) return txFx;
    return findBarOnOrBefore(market.fxBars, date, true)?.close ?? endFx;
  };

  const startHoldings = computeHoldingsAsOf(
    transactions,
    splitsBySymbol,
    fxLookup,
    currencyBySymbol,
    normalizedStart
  );
  const endHoldings = computeHoldingsAsOf(
    transactions,
    splitsBySymbol,
    fxLookup,
    currencyBySymbol,
    normalizedEnd
  );

  // Cash flows strictly after startDate and on/before endDate (if startPt is null, include startDate itself)
  const periodTxs = transactions.filter((tx) =>
    startPt
      ? tx.date > normalizedStart && tx.date <= normalizedEnd
      : tx.date >= normalizedStart && tx.date <= normalizedEnd
  );

  let buyInflowTwd = 0;
  let sellAndDividendOutflowTwd = 0;
  const cashFlows: DatedCashFlow[] = [];
  const holdingFlows = new Map<string, { buy: number; sellDiv: number }>();

  for (const tx of periodTxs) {
    const asset = assetMap.get(tx.symbol);
    const currency = asset?.currency ?? "TWD";
    const fx = fxLookup(tx.date, currency, tx.fxRate);
    const flow = computeTransactionFlow(tx, currency, fx);

    buyInflowTwd += flow.inflowTwd;
    sellAndDividendOutflowTwd += flow.outflowTwd;
    if (Math.abs(flow.netCashFlowTwd) > 1e-6) {
      cashFlows.push({ date: tx.date, amount: flow.netCashFlowTwd });
    }

    const hf = holdingFlows.get(tx.symbol) ?? { buy: 0, sellDiv: 0 };
    hf.buy += flow.inflowTwd;
    hf.sellDiv += flow.outflowTwd;
    holdingFlows.set(tx.symbol, hf);
  }

  // If scope === 'total', adjust external net cash flow for cash balance changes
  if (scope === "total" && startPt && endPt) {
    const cashDelta = endPt.cashValueTwd - startPt.cashValueTwd;
    if (Math.abs(cashDelta) > 1e-6) {
      if (cashDelta > 0) buyInflowTwd += cashDelta;
      else sellAndDividendOutflowTwd += -cashDelta;
      // Treat cash snapshot changes mid-period as midpoint external flow
      const midDate =
        dailySeries.find(
          (p) =>
            p.date >= normalizedStart &&
            diffCalendarDays(normalizedStart, p.date) >= Math.floor(calendarDays / 2)
        )?.date ?? normalizedEnd;
      cashFlows.push({ date: midDate, amount: cashDelta });
    }
  }

  const netCashFlowTwd = buyInflowTwd - sellAndDividendOutflowTwd;
  const netPnlTwd = endValueTwd - startValueTwd - netCashFlowTwd;

  const modifiedDietz = computeModifiedDietz({
    startDate: normalizedStart,
    endDate: normalizedEnd,
    startValue: startValueTwd,
    endValue: endValueTwd,
    cashFlows,
  });

  const annualizedReturn = computeAnnualizedReturn(twr, calendarDays);

  // Per-holding attribution breakdown
  const symbolSet = new Set<string>();
  for (const [sym, pos] of startHoldings) if (pos.splitAdjustedShares > 1e-6) symbolSet.add(sym);
  for (const [sym, pos] of endHoldings) if (pos.splitAdjustedShares > 1e-6) symbolSet.add(sym);
  for (const sym of holdingFlows.keys()) symbolSet.add(sym);

  const holdings: PeriodHoldingAttribution[] = [];
  for (const symbol of symbolSet) {
    const asset = assetMap.get(symbol);
    const marketCode = asset?.market ?? "TW";
    const currency = asset?.currency ?? "TWD";
    const startShares = startHoldings.get(symbol)?.splitAdjustedShares ?? 0;
    const endShares = endHoldings.get(symbol)?.splitAdjustedShares ?? 0;
    const deltaShares = endShares - startShares;

    const bars = market.tickers[symbol]?.bars ?? [];
    const startBar = findBarOnOrBefore(bars, normalizedStart, false);
    const endBar = findBarOnOrBefore(bars, normalizedEnd, false);
    const startPrice = startBar?.close ?? null;
    const endPrice = endBar?.close ?? null;

    const localReturn =
      startPrice && endPrice && startPrice > 0
        ? (endPrice - startPrice) / startPrice
        : null;

    const twdReturn =
      localReturn === null
        ? null
        : currency === "TWD"
          ? localReturn
          : (1 + localReturn) * (1 + fxReturn) - 1;

    const fxImpact =
      localReturn !== null && twdReturn !== null
        ? currency === "TWD"
          ? 0
          : twdReturn - localReturn
        : null;

    const hf = holdingFlows.get(symbol) ?? { buy: 0, sellDiv: 0 };
    const endMarketValueTwd =
      endPrice !== null
        ? endShares * endPrice * (currency === "TWD" ? 1 : endFx)
        : 0;

    holdings.push({
      symbol,
      name:
        asset?.name && asset.name !== symbol
          ? asset.name
          : market.tickers[symbol]?.name ?? symbol,
      market: marketCode,
      currency,
      startShares,
      deltaShares,
      endShares,
      startPrice,
      endPrice,
      buyInflowTwd: hf.buy,
      sellAndDividendTwd: hf.sellDiv,
      netCashFlowTwd: hf.buy - hf.sellDiv,
      localReturn,
      twdReturn,
      fxImpact,
      endMarketValueTwd,
    });
  }

  holdings.sort((a, b) => b.endMarketValueTwd - a.endMarketValueTwd);

  return {
    startDate: normalizedStart,
    endDate: normalizedEnd,
    calendarDays,
    startFx,
    endFx,
    fxReturn,
    startValueTwd,
    endValueTwd,
    buyInflowTwd,
    sellAndDividendOutflowTwd,
    netCashFlowTwd,
    netPnlTwd,
    modifiedDietz,
    twr,
    annualizedReturn,
    holdings,
  };
}
