import type { CurrencyCode, Transaction } from "@/types/sheet";
import { diffCalendarDays } from "./calendar";

export interface DatedCashFlow {
  date: string;
  amount: number; // Positive = inflow (BUY), Negative = outflow (SELL / DIVIDEND)
}

export interface TransactionFlowBreakdown {
  inflowTwd: number; // BUY (>= 0)
  outflowTwd: number; // SELL + DIVIDEND (>= 0 magnitude)
  dividendTwd: number; // DIVIDEND (>= 0)
  netCashFlowTwd: number; // inflowTwd - outflowTwd
}

/**
 * Converts a single transaction into external cash flow terms (TWD).
 * - BUY: external inflow (+)
 * - SELL: external outflow (-)
 * - DIVIDEND: realized dividend income treated as external outflow (-)
 * - DRIP: 0 external cash flow (shares increase internally)
 */
export function computeTransactionFlow(
  tx: Transaction,
  currency: CurrencyCode,
  fxRate: number
): TransactionFlowBreakdown {
  const effectiveFx = currency === "TWD" ? 1 : tx.fxRate && tx.fxRate > 0 ? tx.fxRate : fxRate;

  if (tx.type === "BUY") {
    const amount = (tx.shares * tx.price + tx.fee) * effectiveFx;
    return {
      inflowTwd: amount,
      outflowTwd: 0,
      dividendTwd: 0,
      netCashFlowTwd: amount,
    };
  }

  if (tx.type === "SELL") {
    const amount = Math.max(0, tx.shares * tx.price - tx.fee) * effectiveFx;
    return {
      inflowTwd: 0,
      outflowTwd: amount,
      dividendTwd: 0,
      netCashFlowTwd: -amount,
    };
  }

  if (tx.type === "DIVIDEND") {
    const amount = Math.max(0, tx.shares * tx.price - tx.fee) * effectiveFx;
    return {
      inflowTwd: 0,
      outflowTwd: amount,
      dividendTwd: amount,
      netCashFlowTwd: -amount,
    };
  }

  // DRIP
  return {
    inflowTwd: 0,
    outflowTwd: 0,
    dividendTwd: 0,
    netCashFlowTwd: 0,
  };
}

/**
 * Exact day-weighted Modified Dietz return:
 *   R = (V_end - V_start - sum(CF_i)) / (V_start + sum(w_i * CF_i))
 *   where w_i = (T - t_i) / T, T = calendarDays(startDate, endDate).
 */
export function computeModifiedDietz(params: {
  startDate: string;
  endDate: string;
  startValue: number;
  endValue: number;
  cashFlows: DatedCashFlow[];
}): number {
  const { startDate, endDate, startValue, endValue, cashFlows } = params;
  const totalDays = Math.max(1, diffCalendarDays(startDate, endDate));

  let totalNetCf = 0;
  let weightedCf = 0;

  for (const cf of cashFlows) {
    const elapsed = Math.min(totalDays, Math.max(0, diffCalendarDays(startDate, cf.date)));
    const weight = (totalDays - elapsed) / totalDays;
    totalNetCf += cf.amount;
    weightedCf += weight * cf.amount;
  }

  const gain = endValue - startValue - totalNetCf;
  const denominator = startValue + weightedCf;

  if (Math.abs(denominator) < 1e-6 || denominator <= 0) {
    // Fallback when startValue is 0 and all flows happened on the final day (weight=0)
    if (startValue === 0 && totalNetCf > 0) {
      return gain / totalNetCf;
    }
    return 0;
  }

  return gain / denominator;
}

/**
 * Institutional hybrid single-day TWR sub-period return:
 *   r_t = (V_t + CF_out_t) / (V_{t-1} + CF_in_t) - 1
 *
 * - Treats inflows (BUY) as start-of-day (captures intraday price move & handles V_{t-1} = 0 cleanly).
 * - Treats outflows (SELL / DIVIDEND) as end-of-day (handles full liquidation without negative denominator).
 */
export function computeDailySubperiodReturn(params: {
  prevValue: number;
  endValue: number;
  inflow: number;
  outflow: number;
}): number {
  const { prevValue, endValue, inflow, outflow } = params;
  const denominator = prevValue + inflow;
  if (denominator <= 1e-6) return 0;
  return (endValue + outflow) / denominator - 1;
}

/**
 * Computes annualized return (CAGR) over calendar days.
 * Returns null if period is shorter than 30 days to avoid noisy extrapolation.
 */
export function computeAnnualizedReturn(
  totalReturn: number,
  calendarDays: number
): number | null {
  if (calendarDays < 30 || totalReturn <= -1) return null;
  return Math.pow(1 + totalReturn, 365 / calendarDays) - 1;
}

/**
 * Computes exact money-weighted annualized internal rate of return (XIRR).
 *
 * Sign convention (investor perspective):
 * - Negative amount = cash contributed (BUY)
 * - Positive amount = cash received (SELL, DIVIDEND) or ending market value
 * (Mathematically invariant to multiplying all amounts by -1 as long as inflows/outflows
 * have opposite signs.)
 *
 * Returns null if total span is shorter than `minDays` (default 30) or if no valid root exists.
 */
export function computeXirr(
  cashFlows: DatedCashFlow[],
  options?: { minDays?: number }
): number | null {
  const minDays = options?.minDays ?? 30;
  const nonZero = cashFlows.filter((cf) => Math.abs(cf.amount) > 1e-6);
  if (nonZero.length < 2) return null;

  let hasPositive = false;
  let hasNegative = false;
  for (const cf of nonZero) {
    if (cf.amount > 0) hasPositive = true;
    if (cf.amount < 0) hasNegative = true;
  }
  if (!hasPositive || !hasNegative) return null;

  const sorted = [...nonZero].sort((a, b) => a.date.localeCompare(b.date));
  const startDate = sorted[0].date;
  const endDate = sorted[sorted.length - 1].date;
  const spanDays = diffCalendarDays(startDate, endDate);
  if (spanDays < minDays) return null;

  // Aggregate cash flows occurring on the exact same day
  const byDate = new Map<string, number>();
  for (const cf of sorted) {
    byDate.set(cf.date, (byDate.get(cf.date) ?? 0) + cf.amount);
  }
  const flows = Array.from(byDate.entries())
    .map(([date, amount]) => ({
      t: diffCalendarDays(startDate, date) / 365,
      amount,
    }))
    .filter((f) => Math.abs(f.amount) > 1e-6);

  if (flows.length < 2) return null;

  const npv = (rate: number): number => {
    const base = 1 + rate;
    if (base <= 0) return Number.NaN;
    let total = 0;
    for (const f of flows) {
      total += f.amount / Math.pow(base, f.t);
    }
    return total;
  };

  const dNpv = (rate: number): number => {
    const base = 1 + rate;
    if (base <= 0) return Number.NaN;
    let total = 0;
    for (const f of flows) {
      if (f.t === 0) continue;
      total += (-f.t * f.amount) / Math.pow(base, f.t + 1);
    }
    return total;
  };

  const MAX_RATE = 100;
  const MIN_RATE = -0.9999;

  // 1. Try damped Newton-Raphson from multiple sensible seeds
  for (const seed of [0.1, 0.0, 0.3, -0.2, 0.8]) {
    let r = seed;
    for (let iter = 0; iter < 60; iter++) {
      const fVal = npv(r);
      if (!Number.isFinite(fVal)) break;
      if (Math.abs(fVal) < 1e-7) {
        if (r > MIN_RATE && r < MAX_RATE) return r;
        break;
      }
      const dfVal = dNpv(r);
      if (!Number.isFinite(dfVal) || Math.abs(dfVal) < 1e-12) break;
      const step = fVal / dfVal;
      const next = r - step;
      if (!Number.isFinite(next) || next <= -1 || next > MAX_RATE * 2) break;
      if (Math.abs(next - r) < 1e-9 && Math.abs(npv(next)) < 1e-5) {
        if (next > MIN_RATE && next < MAX_RATE) return next;
        break;
      }
      r = next;
    }
  }

  // 2. Bracket scan + bisection fallback for guaranteed convergence
  const grid = [
    -0.99, -0.95, -0.9, -0.8, -0.6, -0.4, -0.2, -0.1, 0, 0.05, 0.1, 0.2, 0.35,
    0.5, 0.75, 1.0, 1.5, 2.5, 5.0, 10.0, 25.0, 50.0,
  ];
  for (let i = 0; i < grid.length - 1; i++) {
    let lo = grid[i];
    let hi = grid[i + 1];
    let fLo = npv(lo);
    let fHi = npv(hi);
    if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) continue;
    if (Math.abs(fLo) < 1e-7) return lo;
    if (fLo * fHi > 0) continue;

    for (let iter = 0; iter < 80; iter++) {
      const mid = (lo + hi) / 2;
      const fMid = npv(mid);
      if (!Number.isFinite(fMid)) break;
      if (Math.abs(fMid) < 1e-7 || hi - lo < 1e-9) {
        return mid > MIN_RATE && mid < MAX_RATE ? mid : null;
      }
      if (fLo * fMid <= 0) {
        hi = mid;
        fHi = fMid;
      } else {
        lo = mid;
        fLo = fMid;
      }
    }
  }

  return null;
}
