import type { MarketDataBundle, SplitEvent } from "@/types/market";
import type { Asset, CurrencyCode, Transaction } from "@/types/sheet";
import { toSplitAdjustedShares } from "./holdings";

export const DEFAULT_OWN_FUNDING_TAG = "自有資金";

const EPS = 1e-10;

export function resolveFundingTag(raw?: string | null): string {
  const trimmed = (raw ?? "").trim();
  return trimmed || DEFAULT_OWN_FUNDING_TAG;
}

export function isExplicitNonOwnTag(raw?: string | null): boolean {
  const trimmed = (raw ?? "").trim();
  return trimmed !== "" && trimmed !== DEFAULT_OWN_FUNDING_TAG;
}

export function buildSplitsBySymbol(
  market: MarketDataBundle,
  assets: Asset[] = []
): Record<string, SplitEvent[]> {
  const splitsBySymbol: Record<string, SplitEvent[]> = {};
  for (const [symbol, ticker] of Object.entries(market.tickers)) {
    splitsBySymbol[symbol] = ticker.splits ?? [];
  }
  for (const asset of assets) {
    if (!(asset.symbol in splitsBySymbol)) {
      splitsBySymbol[asset.symbol] = market.tickers[asset.symbol]?.splits ?? [];
    }
  }
  return splitsBySymbol;
}

function inferCurrency(
  symbol: string,
  currencyBySymbol: Map<string, CurrencyCode>
): CurrencyCode {
  const mapped = currencyBySymbol.get(symbol);
  if (mapped) return mapped;
  return /^\d/.test(symbol) ? "TWD" : "USD";
}

function addToNestedMap<K>(
  outer: Map<K, Map<string, number>>,
  outerKey: K,
  innerKey: string,
  delta: number
): void {
  if (Math.abs(delta) <= EPS) return;
  let inner = outer.get(outerKey);
  if (!inner) {
    inner = new Map<string, number>();
    outer.set(outerKey, inner);
  }
  const next = (inner.get(innerKey) ?? 0) + delta;
  if (next <= EPS) {
    inner.delete(innerKey);
  } else {
    inner.set(innerKey, next);
  }
}

function getPositiveEntries(
  map: Map<string, number> | undefined
): Array<[string, number]> {
  if (!map) return [];
  const entries: Array<[string, number]> = [];
  for (const [k, v] of map.entries()) {
    if (v > EPS) entries.push([k, v]);
  }
  return entries;
}

function sumEntries(entries: Array<[string, number]>): number {
  let total = 0;
  for (const [, v] of entries) total += v;
  return total;
}

function cloneTxWithAllocation(
  tx: Transaction,
  fundingTag: string,
  weight: number,
  isSplit: boolean
): Transaction {
  return {
    ...tx,
    id: isSplit ? `${tx.id}::${fundingTag}` : tx.id,
    shares: tx.shares * weight,
    fee: tx.fee * weight,
    fundingTag,
  };
}

export interface AllocateFundingParams {
  transactions: Transaction[];
  assets?: Asset[];
  splitsBySymbol?: Record<string, SplitEvent[]>;
}

/**
 * Expands raw brokerage transactions into funding-attributed transactions across
 * `自有資金` and any loan/credit `funding_tag` buckets while preserving exact
 * portfolio-wide conservation (sum of all buckets === original portfolio).
 *
 * Rules:
 * 1. Same-day deterministic ordering (independent of CSV row order):
 *    (1) DRIP / DIVIDEND (uses start-of-day holdings before today's BUY/SELL)
 *    (2) Explicit non-own BUY (e.g. new loan disbursement entering the market)
 *    (3) SELL / SELLOUT (reduces shares; non-SELLOUT proceeds enter swap pool)
 *    (4) Untagged BUY (pairs against same-currency swap pool, remainder -> 自有資金)
 * 2. Untagged (blank or `自有資金`) DRIP & DIVIDEND split proportionally by current
 *    split-adjusted share holdings (falling back to last non-zero mix if paid
 *    immediately after full liquidation). Explicit loan-tagged dividends stay 100%
 *    on that tag.
 * 3. Untagged SELL / SELLOUT reduces shares proportionally across all buckets
 *    holding that symbol. Non-SELLOUT proceeds enter the same-day swap pool;
 *    SELLOUT (`withdrawProceeds: true`) does NOT enter the swap pool.
 * 4. Untagged BUY consumes from `carryoverLoanPool + sameDaySellPool` (same currency):
 *    - Same-day own + loan sell proceeds are consumed proportionally so splitting
 *      one swap into multiple buys on the same day keeps consistent ratios.
 *    - At end of day, unspent non-own (loan) sell proceeds carry over to subsequent
 *      days, while unspent own-fund sell proceeds are cleared so historical own sales
 *      never dilute future loan swaps.
 */
export function allocateTransactionsByFundingTag(
  params: AllocateFundingParams
): Transaction[] {
  const { transactions, assets = [], splitsBySymbol = {} } = params;
  if (transactions.length === 0) return [];

  const currencyBySymbol = new Map<string, CurrencyCode>();
  for (const asset of assets) {
    currencyBySymbol.set(asset.symbol, asset.currency);
  }

  // Group transactions by date while preserving relative input order within each phase
  const txsByDate = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    const arr = txsByDate.get(tx.date) ?? [];
    arr.push(tx);
    txsByDate.set(tx.date, arr);
  }
  const sortedDates = Array.from(txsByDate.keys()).sort((a, b) =>
    a.localeCompare(b)
  );

  // Split-adjusted share balances: symbol -> (fundingTag -> shares)
  const sharesBySymbol = new Map<string, Map<string, number>>();
  // Last non-zero share mix per symbol (used when a dividend arrives after full liquidation)
  const lastNonZeroMixBySymbol = new Map<string, Map<string, number>>();
  // Cross-day uninvested loan sell proceeds: currency -> (loanTag -> localAmount)
  const carryoverLoanPool = new Map<CurrencyCode, Map<string, number>>();

  const allocated: Transaction[] = [];

  for (const date of sortedDates) {
    const dayTxs = txsByDate.get(date) ?? [];

    const incomeTxs: Transaction[] = [];
    const explicitLoanBuys: Transaction[] = [];
    const sellTxs: Transaction[] = [];
    const untaggedBuys: Transaction[] = [];

    for (const tx of dayTxs) {
      if (tx.type === "DRIP" || tx.type === "DIVIDEND") {
        incomeTxs.push(tx);
      } else if (tx.type === "BUY") {
        if (isExplicitNonOwnTag(tx.fundingTag)) {
          explicitLoanBuys.push(tx);
        } else {
          untaggedBuys.push(tx);
        }
      } else if (tx.type === "SELL") {
        sellTxs.push(tx);
      }
    }

    // -----------------------------------------------------------------------
    // Phase 1: DRIP & DIVIDEND (uses start-of-day share proportions)
    // -----------------------------------------------------------------------
    for (const tx of incomeTxs) {
      const splits = splitsBySymbol[tx.symbol] ?? [];
      const adjShares = toSplitAdjustedShares(tx, splits);

      if (isExplicitNonOwnTag(tx.fundingTag)) {
        const tag = resolveFundingTag(tx.fundingTag);
        allocated.push(cloneTxWithAllocation(tx, tag, 1, false));
        if (tx.type === "DRIP") {
          addToNestedMap(sharesBySymbol, tx.symbol, tag, adjShares);
        }
        continue;
      }

      let entries = getPositiveEntries(sharesBySymbol.get(tx.symbol));
      if (entries.length === 0) {
        entries = getPositiveEntries(lastNonZeroMixBySymbol.get(tx.symbol));
      }

      const totalShares = sumEntries(entries);
      if (totalShares <= EPS) {
        allocated.push(
          cloneTxWithAllocation(tx, DEFAULT_OWN_FUNDING_TAG, 1, false)
        );
        if (tx.type === "DRIP") {
          addToNestedMap(
            sharesBySymbol,
            tx.symbol,
            DEFAULT_OWN_FUNDING_TAG,
            adjShares
          );
        }
        continue;
      }

      const isSplit = entries.length > 1;
      for (const [tag, heldShares] of entries) {
        const weight = heldShares / totalShares;
        allocated.push(cloneTxWithAllocation(tx, tag, weight, isSplit));
        if (tx.type === "DRIP") {
          addToNestedMap(sharesBySymbol, tx.symbol, tag, adjShares * weight);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Phase 2: Explicit non-own BUY (new loan capital or manually-tagged swap buy)
    // -----------------------------------------------------------------------
    // Track explicit buy spend per (currency, tag) on this day so if the same tag
    // also has an explicit SELL on the same day (manual tagged swap), its sell
    // proceeds are offset against that buy instead of dangling in the swap pool.
    const sameDayExplicitBuyBudget = new Map<CurrencyCode, Map<string, number>>();

    for (const tx of explicitLoanBuys) {
      const splits = splitsBySymbol[tx.symbol] ?? [];
      const adjShares = toSplitAdjustedShares(tx, splits);
      const currency = inferCurrency(tx.symbol, currencyBySymbol);
      const tag = resolveFundingTag(tx.fundingTag);
      const buyCost = tx.shares * tx.price + tx.fee;

      allocated.push(cloneTxWithAllocation(tx, tag, 1, false));
      addToNestedMap(sharesBySymbol, tx.symbol, tag, adjShares);

      if (buyCost > EPS) {
        // First absorb any prior-day carryover sell pool belonging to this exact tag
        const priorCarry = carryoverLoanPool.get(currency)?.get(tag) ?? 0;
        const absorbedCarry = Math.min(priorCarry, buyCost);
        if (absorbedCarry > EPS) {
          addToNestedMap(carryoverLoanPool, currency, tag, -absorbedCarry);
        }
        const remainingBudget = buyCost - absorbedCarry;
        if (remainingBudget > EPS) {
          addToNestedMap(sameDayExplicitBuyBudget, currency, tag, remainingBudget);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Phase 3: SELL & SELLOUT
    // -----------------------------------------------------------------------
    const sameDaySellPool = new Map<CurrencyCode, Map<string, number>>();

    const creditSameDaySellPool = (
      currency: CurrencyCode,
      tag: string,
      proceeds: number
    ) => {
      if (proceeds <= EPS) return;
      // Offset against any same-day explicit BUY already recorded for the same loan tag
      const explicitBudget = sameDayExplicitBuyBudget.get(currency)?.get(tag) ?? 0;
      const offset = Math.min(explicitBudget, proceeds);
      if (offset > EPS) {
        addToNestedMap(sameDayExplicitBuyBudget, currency, tag, -offset);
      }
      const remaining = proceeds - offset;
      if (remaining > EPS) {
        addToNestedMap(sameDaySellPool, currency, tag, remaining);
      }
    };

    for (const tx of sellTxs) {
      const splits = splitsBySymbol[tx.symbol] ?? [];
      const adjShares = toSplitAdjustedShares(tx, splits);
      const currency = inferCurrency(tx.symbol, currencyBySymbol);
      const netProceeds = Math.max(0, tx.shares * tx.price - tx.fee);

      if (isExplicitNonOwnTag(tx.fundingTag)) {
        const tag = resolveFundingTag(tx.fundingTag);
        const currentBucket = sharesBySymbol.get(tx.symbol);
        if (currentBucket && sumEntries(getPositiveEntries(currentBucket)) > EPS) {
          lastNonZeroMixBySymbol.set(tx.symbol, new Map(currentBucket));
        }

        allocated.push(cloneTxWithAllocation(tx, tag, 1, false));
        const held = currentBucket?.get(tag) ?? 0;
        addToNestedMap(
          sharesBySymbol,
          tx.symbol,
          tag,
          -Math.min(held, adjShares)
        );

        if (!tx.withdrawProceeds && netProceeds > EPS) {
          creditSameDaySellPool(currency, tag, netProceeds);
        }
        continue;
      }

      const entries = getPositiveEntries(sharesBySymbol.get(tx.symbol));
      const totalShares = sumEntries(entries);

      if (totalShares <= EPS) {
        allocated.push(
          cloneTxWithAllocation(tx, DEFAULT_OWN_FUNDING_TAG, 1, false)
        );
        if (!tx.withdrawProceeds && netProceeds > EPS) {
          addToNestedMap(
            sameDaySellPool,
            currency,
            DEFAULT_OWN_FUNDING_TAG,
            netProceeds
          );
        }
        continue;
      }

      // Snapshot share mix before deduction in case this sell liquidates the position
      lastNonZeroMixBySymbol.set(tx.symbol, new Map(entries));

      const isSplit = entries.length > 1;
      for (const [tag, heldShares] of entries) {
        const weight = heldShares / totalShares;
        allocated.push(cloneTxWithAllocation(tx, tag, weight, isSplit));
        addToNestedMap(
          sharesBySymbol,
          tx.symbol,
          tag,
          -Math.min(heldShares, adjShares * weight)
        );
        if (!tx.withdrawProceeds && netProceeds > EPS) {
          creditSameDaySellPool(currency, tag, netProceeds * weight);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Phase 4: Untagged BUY (auto swap pairing against active same-currency pool)
    // -----------------------------------------------------------------------
    const dayPool = new Map<CurrencyCode, Map<string, number>>();
    for (const [ccy, tagMap] of carryoverLoanPool.entries()) {
      for (const [tag, amt] of tagMap.entries()) {
        addToNestedMap(dayPool, ccy, tag, amt);
      }
    }
    for (const [ccy, tagMap] of sameDaySellPool.entries()) {
      for (const [tag, amt] of tagMap.entries()) {
        addToNestedMap(dayPool, ccy, tag, amt);
      }
    }

    for (const tx of untaggedBuys) {
      const splits = splitsBySymbol[tx.symbol] ?? [];
      const adjShares = toSplitAdjustedShares(tx, splits);
      const currency = inferCurrency(tx.symbol, currencyBySymbol);
      const buyCost = tx.shares * tx.price + tx.fee;

      const poolEntries = getPositiveEntries(dayPool.get(currency));
      const totalPool = sumEntries(poolEntries);

      // Fast path: no active swap proceeds (or zero-cost buy) -> 100% own funds
      const hasAnyLoanInPool = poolEntries.some(
        ([tag]) => tag !== DEFAULT_OWN_FUNDING_TAG
      );
      if (buyCost <= EPS || totalPool <= EPS || !hasAnyLoanInPool) {
        // Still drain same-day own pool if present, and emit 100% own BUY
        if (totalPool > EPS && buyCost > EPS) {
          const drainRatio = Math.min(1, buyCost / totalPool);
          for (const [tag, amt] of poolEntries) {
            addToNestedMap(dayPool, currency, tag, -(amt * drainRatio));
          }
        }
        allocated.push(
          cloneTxWithAllocation(tx, DEFAULT_OWN_FUNDING_TAG, 1, false)
        );
        addToNestedMap(
          sharesBySymbol,
          tx.symbol,
          DEFAULT_OWN_FUNDING_TAG,
          adjShares
        );
        continue;
      }

      // Pair buyCost against dayPool proportionally, allocating any excess to 自有資金
      const allocations = new Map<string, number>();

      if (buyCost <= totalPool + EPS) {
        const consumeRatio = Math.min(1, buyCost / totalPool);
        for (const [tag, amt] of poolEntries) {
          const used = amt * consumeRatio;
          allocations.set(tag, (allocations.get(tag) ?? 0) + used);
          addToNestedMap(dayPool, currency, tag, -used);
        }
      } else {
        // Consume 100% of active swap pool, remainder funded by new 自有資金
        for (const [tag, amt] of poolEntries) {
          allocations.set(tag, (allocations.get(tag) ?? 0) + amt);
          addToNestedMap(dayPool, currency, tag, -amt);
        }
        const excessOwn = buyCost - totalPool;
        allocations.set(
          DEFAULT_OWN_FUNDING_TAG,
          (allocations.get(DEFAULT_OWN_FUNDING_TAG) ?? 0) + excessOwn
        );
      }

      const allocEntries = getPositiveEntries(allocations);
      const allocTotal = sumEntries(allocEntries);
      const isSplit = allocEntries.length > 1;

      for (const [tag, amt] of allocEntries) {
        const weight = amt / allocTotal;
        allocated.push(cloneTxWithAllocation(tx, tag, weight, isSplit));
        addToNestedMap(sharesBySymbol, tx.symbol, tag, adjShares * weight);
      }
    }

    // End-of-day rollover: preserve ONLY unspent non-own (loan) proceeds for future days
    carryoverLoanPool.clear();
    for (const [ccy, tagMap] of dayPool.entries()) {
      for (const [tag, amt] of tagMap.entries()) {
        if (tag !== DEFAULT_OWN_FUNDING_TAG && amt > EPS) {
          addToNestedMap(carryoverLoanPool, ccy, tag, amt);
        }
      }
    }
  }

  return allocated;
}
