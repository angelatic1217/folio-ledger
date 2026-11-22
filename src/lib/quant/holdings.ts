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
  costBasisTwd: number;
}

/**
 * Reconstructs split-adjusted share count and average cost basis (TWD) for every symbol
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
      costBasisTwd: 0,
    };

    const splits = splitsBySymbol[tx.symbol] ?? [];
    const adjShares = toSplitAdjustedShares(tx, splits);
    const currency = currencyBySymbol[tx.symbol] ?? "TWD";
    const fx = fxLookup(tx.date, currency, tx.fxRate);

    if (tx.type === "BUY") {
      pos.splitAdjustedShares += adjShares;
      pos.costBasisTwd += (tx.shares * tx.price + tx.fee) * fx;
    } else if (tx.type === "DRIP") {
      // Dividend reinvestment increases share count with 0 external cash cost
      pos.splitAdjustedShares += adjShares;
    } else if (tx.type === "SELL") {
      if (pos.splitAdjustedShares > 0) {
        const sellRatio = Math.min(1, adjShares / pos.splitAdjustedShares);
        pos.costBasisTwd = Math.max(0, pos.costBasisTwd * (1 - sellRatio));
      }
      pos.splitAdjustedShares = Math.max(0, pos.splitAdjustedShares - adjShares);
      if (pos.splitAdjustedShares < 1e-9) {
        pos.splitAdjustedShares = 0;
        pos.costBasisTwd = 0;
      }
    }

    map.set(tx.symbol, pos);
  }

  return map;
}
