import type { MarketDataBundle } from "@/types/market";
import type {
  AmortizationRow,
  LoanFacilitySummary,
  LoanHoldingSummary,
  PortfolioLeverageSummary,
  QuantEngineOutput,
} from "@/types/quant";
import type { Asset, LoanFacility, LoanStatus, PortfolioSheetsData, Transaction } from "@/types/sheet";
import { diffCalendarDays, findBarOnOrBefore } from "./calendar";
import { computeHoldingsAsOf } from "./holdings";
import { computeAnnualizedReturn } from "./returns";

/**
 * Adds N calendar months to an ISO YYYY-MM-DD date string, clamping day-of-month
 * (e.g. Jan 31 + 1 month -> Feb 28/29).
 */
export function addMonthsIso(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  const targetMonthIndex = m - 1 + months;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(d, lastDay);
  const mm = String(normalizedMonth + 1).padStart(2, "0");
  const dd = String(clampedDay).padStart(2, "0");
  return `${targetYear}-${mm}-${dd}`;
}

/**
 * Standard fixed-rate equal-payment amortization formula (Excel PMT).
 */
export function computeMonthlyPayment(
  principal: number,
  apr: number,
  termMonths: number
): number {
  if (principal <= 0 || termMonths <= 0) return 0;
  const r = apr / 12;
  if (r <= 1e-12) return principal / termMonths;
  const factor = Math.pow(1 + r, termMonths);
  return (principal * r * factor) / (factor - 1);
}

/**
 * Solves the effective annual percentage rate (true APR including origination & wire fees),
 * equivalent to Excel `RATE(termMonths, -monthlyPayment, netDisbursed) * 12`.
 */
export function computeEffectiveApr(params: {
  netDisbursed: number;
  monthlyPayment: number;
  termMonths: number;
}): number {
  const { netDisbursed, monthlyPayment, termMonths } = params;
  if (netDisbursed <= 0 || monthlyPayment <= 0 || termMonths <= 0) return 0;
  if (monthlyPayment * termMonths <= netDisbursed) return 0;

  // Binary search monthly rate r in [0, 0.05] (0% .. 60% APR)
  let lo = 0;
  let hi = 0.05;
  for (let iter = 0; iter < 60; iter++) {
    const mid = (lo + hi) / 2;
    const pv =
      mid <= 1e-12
        ? monthlyPayment * termMonths
        : (monthlyPayment * (1 - Math.pow(1 + mid, -termMonths))) / mid;
    if (pv > netDisbursed) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return ((lo + hi) / 2) * 12;
}

export function resolveLoanStatus(loan: LoanFacility): LoanStatus {
  if (loan.status) return loan.status;
  return loan.closedDate ? "refinanced" : "active";
}

/**
 * Generates a period-by-period amortization schedule (PPMT, IPMT, remaining balance)
 * and marks each installment as paid if its paymentDate <= effective date.
 * For refinanced / closed loans, truncates the schedule at closedDate so phantom
 * post-payoff installments are excluded.
 */
export function buildAmortizationSchedule(
  loan: LoanFacility,
  asOfDate: string
): AmortizationRow[] {
  const n = Math.max(1, Math.round(loan.termMonths));
  const r = Math.max(0, loan.apr) / 12;
  const formulaPmt = computeMonthlyPayment(loan.principalTwd, loan.apr, n);
  const status = resolveLoanStatus(loan);
  const isClosed = status === "refinanced" || status === "closed";
  const effectiveDate =
    isClosed && loan.closedDate && loan.closedDate < asOfDate
      ? loan.closedDate
      : asOfDate;

  const rawRows: Array<{
    period: number;
    paymentDate: string;
    principalTwd: number;
    interestTwd: number;
    remainingPrincipalTwd: number;
  }> = [];

  let balance = loan.principalTwd;
  let rawTotalInterest = 0;

  for (let p = 1; p <= n; p++) {
    const interest = balance * r;
    const principal =
      p === n ? balance : Math.min(balance, Math.max(0, formulaPmt - interest));
    balance = Math.max(0, balance - principal);
    rawTotalInterest += interest;
    rawRows.push({
      period: p,
      paymentDate: addMonthsIso(loan.startDate, p),
      principalTwd: principal,
      interestTwd: interest,
      remainingPrincipalTwd: balance,
    });
  }

  // Only scale active-loan full schedule when an explicit contract total interest override is provided
  const interestScale =
    !isClosed &&
    loan.totalInterestOverrideTwd &&
    loan.totalInterestOverrideTwd > 0 &&
    rawTotalInterest > 1e-6
      ? loan.totalInterestOverrideTwd / rawTotalInterest
      : 1;

  let cumPrincipal = 0;
  let cumInterest = 0;

  const fullSchedule = rawRows.map((row) => {
    const scaledInterest = row.interestTwd * interestScale;
    const paymentTwd =
      loan.monthlyPaymentTwd && loan.monthlyPaymentTwd > 0
        ? loan.monthlyPaymentTwd
        : row.principalTwd + scaledInterest;
    cumPrincipal += row.principalTwd;
    cumInterest += scaledInterest;
    return {
      period: row.period,
      paymentDate: row.paymentDate,
      paymentTwd,
      principalTwd: row.principalTwd,
      interestTwd: scaledInterest,
      cumulativePrincipalTwd: cumPrincipal,
      cumulativeInterestTwd: cumInterest,
      remainingPrincipalTwd: row.remainingPrincipalTwd,
      paid: row.paymentDate <= effectiveDate,
    };
  });

  if (isClosed) {
    return fullSchedule.filter((row) => row.paid);
  }
  return fullSchedule;
}

/**
 * Evaluates a single LoanFacility against tagged transactions & live market prices.
 */
export function computeLoanFacilitySummary(params: {
  loan: LoanFacility;
  transactions: Transaction[];
  assets: Asset[];
  market: MarketDataBundle;
  asOfDate: string;
  latestFxRate: number;
}): LoanFacilitySummary {
  const { loan, transactions, assets, market, asOfDate, latestFxRate } = params;

  const taggedTxs = transactions.filter(
    (tx) => (tx.fundingTag ?? "").trim() === loan.fundingTag.trim()
  );

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
    return findBarOnOrBefore(market.fxBars, date, true)?.close ?? latestFxRate;
  };

  const holdingMap = computeHoldingsAsOf(
    taggedTxs,
    splitsBySymbol,
    fxLookup,
    currencyBySymbol,
    asOfDate
  );

  let holdingsValueTwd = 0;
  let holdingsValueUsd = 0;
  const holdings: LoanHoldingSummary[] = [];

  for (const [symbol, pos] of holdingMap.entries()) {
    if (pos.splitAdjustedShares <= 1e-9) continue;
    const asset = assetMap.get(symbol);
    const currency = asset?.currency ?? "TWD";
    const ticker = market.tickers[symbol];
    const bar = ticker ? findBarOnOrBefore(ticker.bars, asOfDate, true) : null;
    const latestPrice = bar?.close ?? 0;

    const mvNative = pos.splitAdjustedShares * latestPrice;
    const mvTwd = currency === "TWD" ? mvNative : mvNative * latestFxRate;
    const mvUsd = currency === "USD" ? mvNative : mvTwd / (latestFxRate || 32);

    holdingsValueTwd += mvTwd;
    holdingsValueUsd += mvUsd;

    holdings.push({
      symbol,
      name: asset?.name || ticker?.name || symbol,
      currency,
      shares: pos.splitAdjustedShares,
      latestPrice,
      marketValueUsd: mvUsd,
      marketValueTwd: mvTwd,
      costBasisTwd: pos.costBasisTwd,
      unrealizedPnlTwd: mvTwd - pos.costBasisTwd,
    });
  }
  holdings.sort((a, b) => b.marketValueTwd - a.marketValueTwd);

  // Track residual USD cash for USD-funded loans (e.g. uninvested wire balance or cash from SELL)
  let residualCashUsd = 0;
  if (loan.receivedUsd && loan.receivedUsd > 0) {
    let netUsdSpent = 0;
    for (const tx of taggedTxs) {
      const currency = assetMap.get(tx.symbol)?.currency ?? "TWD";
      if (currency !== "USD") continue;
      if (tx.type === "BUY") {
        netUsdSpent += tx.shares * tx.price + tx.fee;
      } else if (tx.type === "SELL" || tx.type === "DIVIDEND") {
        netUsdSpent -= Math.max(0, tx.shares * tx.price - tx.fee);
      }
      // DRIP has 0 cash flow
    }
    residualCashUsd = Math.max(0, loan.receivedUsd - netUsdSpent);
  }

  const totalValueTwd = holdingsValueTwd + residualCashUsd * latestFxRate;
  const totalValueUsd = holdingsValueUsd + residualCashUsd;
  const totalCostTwd = loan.disbursedTwd + loan.wireFeeTwd;
  const avgEntryFxRate =
    loan.receivedUsd && loan.receivedUsd > 0
      ? totalCostTwd / loan.receivedUsd
      : null;

  // Amortization schedule & interest tracking (handles active vs refinanced/closed loans)
  const status = resolveLoanStatus(loan);
  const isClosed = status === "refinanced" || status === "closed";
  const refinancedPayoffTwd = loan.refinancedPayoffTwd ?? 0;

  const schedule = buildAmortizationSchedule(loan, asOfDate);
  const paidRows = schedule.filter((r) => r.paid);
  const lastPaid = paidRows[paidRows.length - 1];
  const monthsElapsed = paidRows.length;
  const accruedScheduleInterest = lastPaid?.cumulativeInterestTwd ?? 0;
  const repaidPrincipalBeforePayoff = lastPaid?.cumulativePrincipalTwd ?? 0;
  const remainingBeforePayoff = lastPaid
    ? lastPaid.remainingPrincipalTwd
    : loan.principalTwd;

  // If closed/refinanced, any payoff excess above scheduled remaining principal is stub interest / early payoff fee
  const payoffStubChargeTwd =
    isClosed && loan.payoffTwd && loan.payoffTwd > remainingBeforePayoff
      ? loan.payoffTwd - remainingBeforePayoff
      : 0;

  const accruedInterestToDateTwd = isClosed
    ? loan.totalInterestOverrideTwd && loan.totalInterestOverrideTwd > 0
      ? loan.totalInterestOverrideTwd
      : accruedScheduleInterest + payoffStubChargeTwd
    : accruedScheduleInterest;

  const repaidPrincipalToDateTwd = isClosed
    ? loan.principalTwd
    : repaidPrincipalBeforePayoff;

  const remainingPrincipalTwd = isClosed ? 0 : remainingBeforePayoff;

  const formulaMonthly = computeMonthlyPayment(
    loan.principalTwd,
    loan.apr,
    loan.termMonths
  );
  const monthlyPaymentTwd =
    loan.monthlyPaymentTwd && loan.monthlyPaymentTwd > 0
      ? loan.monthlyPaymentTwd
      : formulaMonthly;
  const activeMonthlyPaymentTwd = isClosed ? 0 : monthlyPaymentTwd;

  const fullTermInterestTwd = isClosed
    ? accruedInterestToDateTwd
    : loan.totalInterestOverrideTwd && loan.totalInterestOverrideTwd > 0
      ? loan.totalInterestOverrideTwd
      : schedule[schedule.length - 1]?.cumulativeInterestTwd ?? 0;

  // For refinance loans, total net bank funding = cash disbursed + payoff of prior loan
  // so that the refinanced payoff amount is NOT mistakenly treated as an origination fee.
  const bankNetFundingTwd = loan.disbursedTwd + refinancedPayoffTwd;
  const effectiveApr = computeEffectiveApr({
    netDisbursed: Math.max(1, bankNetFundingTwd - loan.wireFeeTwd),
    monthlyPayment: formulaMonthly,
    termMonths: loan.termMonths,
  });

  // P&L and FX vs Equity decomposition (matches spreadsheet definition identically)
  const grossPnlTwd = totalValueTwd - totalCostTwd;
  const grossReturn = totalCostTwd > 0 ? grossPnlTwd / totalCostTwd : 0;

  const fxPnlTwd =
    loan.receivedUsd && loan.receivedUsd > 0
      ? loan.receivedUsd * latestFxRate - totalCostTwd
      : null;
  const equityPnlTwd = grossPnlTwd - (fxPnlTwd ?? 0);

  const netPnlFullInterestTwd = grossPnlTwd - fullTermInterestTwd;
  const netReturnFullInterest =
    totalCostTwd > 0 ? netPnlFullInterestTwd / totalCostTwd : 0;

  const netPnlAccruedInterestTwd = grossPnlTwd - accruedInterestToDateTwd;
  const netReturnAccruedInterest =
    totalCostTwd > 0 ? netPnlAccruedInterestTwd / totalCostTwd : 0;

  const holdingDays = Math.max(0, diffCalendarDays(loan.startDate, asOfDate));
  const annualizedGrossReturn = computeAnnualizedReturn(grossReturn, holdingDays);
  const annualizedNetReturn = computeAnnualizedReturn(
    netReturnFullInterest,
    holdingDays
  );
  const carrySpread =
    annualizedGrossReturn !== null ? annualizedGrossReturn - loan.apr : null;

  return {
    id: loan.id,
    name: loan.name,
    fundingTag: loan.fundingTag,
    status,
    startDate: loan.startDate,
    closedDate: loan.closedDate ?? null,
    payoffTwd: loan.payoffTwd ?? null,
    refinancedPayoffTwd,
    holdingDays,
    principalTwd: loan.principalTwd,
    disbursedTwd: loan.disbursedTwd,
    wireFeeTwd: loan.wireFeeTwd,
    totalCostTwd,
    receivedUsd: loan.receivedUsd ?? null,
    avgEntryFxRate,
    apr: loan.apr,
    effectiveApr,
    termMonths: loan.termMonths,
    monthsElapsed,
    monthlyPaymentTwd,
    activeMonthlyPaymentTwd,
    fullTermInterestTwd,
    accruedInterestToDateTwd,
    repaidPrincipalToDateTwd,
    remainingPrincipalTwd,
    holdingsValueTwd,
    residualCashUsd,
    totalValueTwd,
    totalValueUsd,
    grossPnlTwd,
    grossReturn,
    fxPnlTwd,
    equityPnlTwd,
    netPnlFullInterestTwd,
    netReturnFullInterest,
    netPnlAccruedInterestTwd,
    netReturnAccruedInterest,
    annualizedGrossReturn,
    annualizedNetReturn,
    carrySpread,
    holdings,
    schedule,
  };
}

/**
 * Aggregates all LoanFacilities alongside the full portfolio engine output
 * to compute net worth, leverage ratio, debt-to-asset ratio, and combined carry P&L.
 */
export function computePortfolioLeverageSummary(params: {
  sheets: PortfolioSheetsData;
  market: MarketDataBundle;
  engine: QuantEngineOutput;
}): PortfolioLeverageSummary {
  const { sheets, market, engine } = params;
  const loans = sheets.loans ?? [];

  const facilities = loans.map((loan) =>
    computeLoanFacilitySummary({
      loan,
      transactions: sheets.transactions,
      assets: sheets.assets,
      market,
      asOfDate: engine.asOfDate,
      latestFxRate: engine.latestFxRate,
    })
  );

  let totalPrincipalTwd = 0;
  let totalCostTwd = 0;
  let totalReceivedUsd = 0;
  let totalMonthlyPaymentTwd = 0;
  let weightedAprNum = 0;
  let totalFullTermInterestTwd = 0;
  let totalAccruedInterestTwd = 0;
  let totalRemainingDebtTwd = 0;
  let totalLoanAssetValueTwd = 0;
  let totalLoanAssetValueUsd = 0;
  let totalLoanFxPnlTwd = 0;
  let totalLoanEquityPnlTwd = 0;

  for (const f of facilities) {
    // Only count active loans in current principal, monthly outflow, and weighted APR
    // so refinanced / paid-off loans are never double-counted in debt!
    if (f.status === "active") {
      totalPrincipalTwd += f.principalTwd;
      weightedAprNum += f.principalTwd * f.apr;
    }
    totalMonthlyPaymentTwd += f.activeMonthlyPaymentTwd;
    totalCostTwd += f.totalCostTwd;
    totalReceivedUsd += f.receivedUsd ?? 0;
    totalFullTermInterestTwd += f.fullTermInterestTwd;
    totalAccruedInterestTwd += f.accruedInterestToDateTwd;
    totalRemainingDebtTwd += f.remainingPrincipalTwd;
    totalLoanAssetValueTwd += f.totalValueTwd;
    totalLoanAssetValueUsd += f.totalValueUsd;
    totalLoanFxPnlTwd += f.fxPnlTwd ?? 0;
    totalLoanEquityPnlTwd += f.equityPnlTwd;
  }

  const weightedApr = totalPrincipalTwd > 0 ? weightedAprNum / totalPrincipalTwd : 0;
  const weightedAvgEntryFxRate =
    totalReceivedUsd > 0 ? totalCostTwd / totalReceivedUsd : null;

  const totalLoanGrossPnlTwd = totalLoanAssetValueTwd - totalCostTwd;
  const totalLoanGrossReturn =
    totalCostTwd > 0 ? totalLoanGrossPnlTwd / totalCostTwd : 0;

  const totalLoanNetPnlFullInterestTwd =
    totalLoanGrossPnlTwd - totalFullTermInterestTwd;
  const totalLoanNetReturnFullInterest =
    totalCostTwd > 0 ? totalLoanNetPnlFullInterestTwd / totalCostTwd : 0;

  const totalLoanNetPnlAccruedInterestTwd =
    totalLoanGrossPnlTwd - totalAccruedInterestTwd;
  const totalLoanNetReturnAccruedInterest =
    totalCostTwd > 0 ? totalLoanNetPnlAccruedInterestTwd / totalCostTwd : 0;

  const grossPortfolioAssetsTwd =
    engine.totalInvestedValueTwd + engine.totalCashValueTwd;
  const netWorthTwd = grossPortfolioAssetsTwd - totalRemainingDebtTwd;
  const leverageRatio =
    netWorthTwd > 0 ? grossPortfolioAssetsTwd / netWorthTwd : null;
  const debtToAssetRatio =
    grossPortfolioAssetsTwd > 0
      ? totalRemainingDebtTwd / grossPortfolioAssetsTwd
      : 0;

  return {
    asOfDate: engine.asOfDate,
    latestFxRate: engine.latestFxRate,
    facilities,
    totalPrincipalTwd,
    totalCostTwd,
    totalReceivedUsd,
    weightedAvgEntryFxRate,
    totalMonthlyPaymentTwd,
    weightedApr,
    totalFullTermInterestTwd,
    totalAccruedInterestTwd,
    totalRemainingDebtTwd,
    totalLoanAssetValueTwd,
    totalLoanAssetValueUsd,
    totalLoanGrossPnlTwd,
    totalLoanGrossReturn,
    totalLoanFxPnlTwd,
    totalLoanEquityPnlTwd,
    totalLoanNetPnlFullInterestTwd,
    totalLoanNetReturnFullInterest,
    totalLoanNetPnlAccruedInterestTwd,
    totalLoanNetReturnAccruedInterest,
    grossPortfolioAssetsTwd,
    netWorthTwd,
    leverageRatio,
    debtToAssetRatio,
  };
}

export interface LumpSumVsDcaPoint {
  year: number;
  lumpSumValueTwd: number; // Funded by loan principal up front
  dcaValueTwd: number; // Investing the equivalent monthly loan payment each month
  advantageTwd: number; // lumpSumValueTwd - dcaValueTwd
}

/**
 * Compares borrowing a lump sum (repaid via equal monthly payments over `termMonths`)
 * vs investing that exact same monthly payment via monthly DCA at a given expected annual
 * capital growth rate + dividend yield. Replaces the `定期定額與一次投入比較` spreadsheet tab.
 */
export function simulateLumpSumVsDca(params: {
  principalTwd: number;
  originationFeeTwd: number;
  apr: number;
  termMonths: number;
  expectedAnnualGrowth: number;
  dividendYield: number;
}): {
  monthlyPaymentTwd: number;
  totalInterestTwd: number;
  effectiveApr: number;
  yearlyPoints: LumpSumVsDcaPoint[];
  finalAdvantageTwd: number;
} {
  const {
    principalTwd,
    originationFeeTwd,
    apr,
    termMonths,
    expectedAnnualGrowth,
    dividendYield,
  } = params;

  const netDisbursed = Math.max(0, principalTwd - originationFeeTwd);
  const monthlyPaymentTwd = computeMonthlyPayment(principalTwd, apr, termMonths);
  const totalInterestTwd = Math.max(0, monthlyPaymentTwd * termMonths - principalTwd);
  const effectiveApr = computeEffectiveApr({
    netDisbursed,
    monthlyPayment: monthlyPaymentTwd,
    termMonths,
  });

  const totalAnnualReturn = (1 + expectedAnnualGrowth) * (1 + dividendYield) - 1;
  const monthlyReturn = Math.pow(1 + totalAnnualReturn, 1 / 12) - 1;

  let lumpSum = netDisbursed;
  let dca = 0;
  const yearlyPoints: LumpSumVsDcaPoint[] = [];

  for (let m = 1; m <= termMonths; m++) {
    lumpSum = lumpSum * (1 + monthlyReturn);
    dca = (dca + monthlyPaymentTwd) * (1 + monthlyReturn);

    if (m % 12 === 0 || m === termMonths) {
      yearlyPoints.push({
        year: Number((m / 12).toFixed(1)),
        lumpSumValueTwd: lumpSum,
        dcaValueTwd: dca,
        advantageTwd: lumpSum - dca,
      });
    }
  }

  const last = yearlyPoints[yearlyPoints.length - 1];
  return {
    monthlyPaymentTwd,
    totalInterestTwd,
    effectiveApr,
    yearlyPoints,
    finalAdvantageTwd: last?.advantageTwd ?? 0,
  };
}
