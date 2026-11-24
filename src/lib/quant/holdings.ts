import type { SplitEvent } from "@/types/market";
import type { Transaction } from "@/types/sheet";

/**
 * Computes the cumulative split multiplier for all splits occurring strictly AFTER `date`.
 * Because Yahoo Finance `close` prices are already split-adjusted backward in time,
 * raw broker shares recorded before a split must be multiplied by this factor so that
 * `splitAdjustedShares * yahooSplitAdjustedClose === exact historical market value`.
 */
export function getCumulativeSplitFactorAfter(
  date: string,
  splits: SplitEvent[] = []
): number {
  let factor = 1;
  for (const s of splits) {
    if (s.date > date && s.ratio > 0) {
      factor *= s.ratio;
    }
  }
  return factor;
}

/**
 * Converts a raw transaction's share quantity into split-adjusted shares.
 */
export function toSplitAdjustedShares(
  tx: Transaction,
  splits: SplitEvent[] = []
): number {
  const factor = getCumulativeSplitFactorAfter(tx.date, splits);
  return tx.shares * factor;
}

export interface HoldingPosition {
  symbol: string;
  splitAdjustedShares: number;
  dripShares: number;
  costBasisTwd: number;
  costBasisLocal: number;
  totalInvestedTwd: number;
  totalInvestedLocal: number;
  realizedPnlTwd: number;
  realizedPnlLocal: number;
  cumulativeDividendsTwd: number;
  cumulativeDividendsLocal: number;
  totalFeesTwd: number;
  totalFeesLocal: number;
  firstBuyDate: string | null;
  lastTxDate: string | null;
  closedDate: string | null;
  txCount: number;
}

/**
 * Reconstructs split-adjusted share count, remaining cost basis (TWD & local),
 * realized P&L, cumulative cash dividends, and holding dates for every symbol
 * as of a target date (inclusive).
 */
export function computeHoldingsAsOf(
  transactions: Transaction[],
  splitsBySymbol: Record<string, SplitEvent[]>,
  fxLookup: (date: string, currency: string, txFx?: number | null) => number,
  currencyBySymbol: Record<string, string>,
  asOfDate: string
): Map<string, HoldingPosition> {
  const sorted = [...transactions]
    .filter((tx) => tx.date <= asOfDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  const map = new Map<string, HoldingPosition>();

  for (const tx of sorted) {
    const pos = map.get(tx.symbol) ?? {
      symbol: tx.symbol,
      splitAdjustedShares: 0,
      dripShares: 0,
      costBasisTwd: 0,
      costBasisLocal: 0,
      totalInvestedTwd: 0,
      totalInvestedLocal: 0,
      realizedPnlTwd: 0,
      realizedPnlLocal: 0,
      cumulativeDividendsTwd: 0,
      cumulativeDividendsLocal: 0,
      totalFeesTwd: 0,
      totalFeesLocal: 0,
      firstBuyDate: null,
      lastTxDate: null,
      closedDate: null,
      txCount: 0,
    };

    const splits = splitsBySymbol[tx.symbol] ?? [];
    const adjShares = toSplitAdjustedShares(tx, splits);
    const currency = currencyBySymbol[tx.symbol] ?? "TWD";
    const fx = fxLookup(tx.date, currency, tx.fxRate);

    pos.totalFeesLocal += tx.fee;
    pos.totalFeesTwd += tx.fee * fx;
    pos.lastTxDate = tx.date;
    pos.txCount += 1;

    if (tx.type === "BUY") {
      const localCost = tx.shares * tx.price + tx.fee;
      const twdCost = localCost * fx;
      pos.splitAdjustedShares += adjShares;
      pos.costBasisLocal += localCost;
      pos.costBasisTwd += twdCost;
      pos.totalInvestedLocal += localCost;
      pos.totalInvestedTwd += twdCost;
      if (!pos.firstBuyDate) pos.firstBuyDate = tx.date;
      pos.closedDate = null;
    } else if (tx.type === "DRIP") {
      // Dividend reinvestment increases share count with 0 external cash cost
      pos.splitAdjustedShares += adjShares;
      pos.dripShares += adjShares;
      if (!pos.firstBuyDate) pos.firstBuyDate = tx.date;
      pos.closedDate = null;
    } else if (tx.type === "SELL") {
      const proceedsLocal = Math.max(0, tx.shares * tx.price - tx.fee);
      const proceedsTwd = proceedsLocal * fx;
      if (pos.splitAdjustedShares > 0) {
        const sellRatio = Math.min(1, adjShares / pos.splitAdjustedShares);
        const soldCostLocal = pos.costBasisLocal * sellRatio;
        const soldCostTwd = pos.costBasisTwd * sellRatio;
        pos.realizedPnlLocal += proceedsLocal - soldCostLocal;
        pos.realizedPnlTwd += proceedsTwd - soldCostTwd;
        pos.costBasisLocal = Math.max(0, pos.costBasisLocal - soldCostLocal);
        pos.costBasisTwd = Math.max(0, pos.costBasisTwd - soldCostTwd);
      }
      pos.splitAdjustedShares = Math.max(0, pos.splitAdjustedShares - adjShares);
      if (pos.splitAdjustedShares < 1e-9) {
        pos.splitAdjustedShares = 0;
        pos.costBasisLocal = 0;
        pos.costBasisTwd = 0;
        pos.closedDate = tx.date;
      }
    } else if (tx.type === "DIVIDEND") {
      const divLocal = Math.max(0, tx.shares * tx.price - tx.fee);
      const divTwd = divLocal * fx;
      pos.cumulativeDividendsLocal += divLocal;
      pos.cumulativeDividendsTwd += divTwd;
    }

    map.set(tx.symbol, pos);
  }

  return map;
}
