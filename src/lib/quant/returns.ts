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
