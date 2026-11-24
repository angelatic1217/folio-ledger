import type { BenchmarkScope, CurrencyCode, LoanStatus, MarketCode } from "./sheet";

export type PortfolioScope = "invested" | "total";
export type TimeRangePreset = "1M" | "3M" | "6M" | "YTD" | "1Y" | "3Y" | "ALL";
export type MddLookbackPreset = "5Y" | "10Y" | "MAX";
export type MddSignalLevel = "near-high" | "mild" | "moderate" | "deep";

export interface MddThresholds {
  mild: number; // e.g. -0.05
  moderate: number; // e.g. -0.10
  deep: number; // e.g. -0.15
}

export interface DailyPortfolioPoint {
  date: string;
  investedValueTwd: number;
  cashValueTwd: number;
  totalValueTwd: number;
  twValueTwd: number;
  usValueTwd: number;
  fxRate: number;
  externalCashFlowTwd: number; // Positive = inflow (BUY), Negative = outflow (SELL / DIVIDEND)
  dividendIncomeTwd: number;
  dailyReturn: number;
  twrIndex: number; // Starts at 100
  peakTwrIndex: number;
  drawdown: number; // <= 0
  peakDate: string;
  daysUnderwater: number;
}

export interface DrawdownSummary {
  maxDrawdown: number;
  maxDrawdownDate: string;
  maxDrawdownPeakDate: string;
  recoveryDays: number | null;
  currentDrawdown: number;
  currentPeakDate: string;
  currentDaysUnderwater: number;
}

export interface SymbolUnderwaterPoint {
  date: string;
  drawdown: number;
  adjClose: number;
}

export type SymbolHoldingStatus = "held" | "closed" | "watch";

export interface SymbolLookbackMetrics {
  cagr: number | null; // Annualized total-return (adjClose) CAGR over lookback window
  volatility: number | null; // Annualized daily volatility (std * sqrt(252))
  maxDrawdown: number; // <= 0 over lookback window
  calmar: number | null; // cagr / |maxDrawdown|
  sharpe: number | null; // (cagr - riskFreeRate) / volatility
  totalReturn: number | null; // Cumulative adjClose return over lookback window
  years: number;
}

export interface SymbolWealthPoint {
  date: string;
  costBasisTwd: number;
  marketValueTwd: number;
  cumulativeDividendsTwd: number;
  totalValueInclDivTwd: number; // marketValueTwd + cumulativeDividendsTwd
  adjClose: number;
}

export interface SymbolPerformanceRow {
  symbol: string;
  name: string;
  market: MarketCode;
  currency: CurrencyCode;
  yahooTicker: string;
  status: SymbolHoldingStatus;
  held: boolean;

  // Position & Cost Basis
  shares: number;
  dripShares: number;
  weightPct: number;
  latestPrice: number;
  latestDate: string;
  firstMarketDate: string;

  // Per-share prices (local currency, split-adjusted)
  avgCostLocal: number | null;
  breakevenPriceLocal: number | null;
  priceVsAvgCostPct: number | null;

  // Valuation & Cost (Local + TWD)
  costBasisLocal: number;
  costBasisTwd: number;
  totalInvestedLocal: number;
  totalInvestedTwd: number;
  marketValueLocal: number;
  marketValueTwd: number;

  // P&L Breakdown
  unrealizedPnlLocal: number;
  unrealizedPnlTwd: number;
  unrealizedPnlPctLocal: number | null;
  unrealizedPnlPctTwd: number | null;
  realizedPnlLocal: number;
  realizedPnlTwd: number;
  cumulativeDividendsLocal: number;
  cumulativeDividendsTwd: number;
  dividendRecoveryPct: number | null;
  totalFeesTwd: number;

  // Total Return (Unrealized + Realized + Cash Dividends)
  totalPnlLocal: number;
  totalPnlTwd: number;
  totalReturnPctLocal: number | null;
  totalReturnPctTwd: number | null;
  wealthMultipleTwd: number | null;

  // US FX Attribution (null for TWD assets)
  avgEntryFxRate: number | null;
  equityPnlTwd: number;
  fxPnlTwd: number | null;

  // Tenure & Personal Annualized Return (XIRR)
  firstBuyDate: string | null;
  lastTxDate: string | null;
  holdingDays: number;
  txCount: number;
  xirrTwd: number | null;
  xirrUsd: number | null;
  xirrLocal: number | null;

  // Long-Term Market Quality by Lookback ("5Y" | "10Y" | "MAX")
  marketMetrics: Record<MddLookbackPreset, SymbolLookbackMetrics>;

  // Chart Series
  wealthSeries: SymbolWealthPoint[];
  marketSeries: Array<{ date: string; adjClose: number }>;
}

export interface MddMatrixRow {
  symbol: string;
  name: string;
  market: MarketCode;
  currency: CurrencyCode;
  yahooTicker: string;
  held: boolean;
  shares: number;
  firstDate: string;
  latestPrice: number;
  latestDate: string;
  peakAdjPrice: number;
  peakDate: string;
  currentDrawdown: number;
  historicalMdd: number;
  mddDate: string;
  mddRatioPct: number; // 0..100+
  daysUnderwater: number;
  weightPct: number;
  marketValueTwd: number;
  costBasisTwd: number;
  unrealizedPnlPct: number | null;
  signal: MddSignalLevel;
  underwaterSeries: SymbolUnderwaterPoint[];
}

export interface PeriodHoldingAttribution {
  symbol: string;
  name: string;
  market: MarketCode;
  currency: CurrencyCode;
  startShares: number;
  deltaShares: number;
  endShares: number;
  startPrice: number | null;
  endPrice: number | null;
  buyInflowTwd: number;
  sellAndDividendTwd: number;
  netCashFlowTwd: number;
  localReturn: number | null;
  twdReturn: number | null;
  fxImpact: number | null;
  endMarketValueTwd: number;
}

export interface PeriodPerformanceSummary {
  startDate: string;
  endDate: string;
  calendarDays: number;
  startFx: number;
  endFx: number;
  fxReturn: number;
  startValueTwd: number;
  endValueTwd: number;
  buyInflowTwd: number;
  sellAndDividendOutflowTwd: number;
  netCashFlowTwd: number;
  netPnlTwd: number;
  modifiedDietz: number;
  twr: number;
  annualizedReturn: number | null;
  holdings: PeriodHoldingAttribution[];
}

export interface AnnualPerformanceRow {
  year: string;
  scope: BenchmarkScope;
  startValueTwd: number;
  netInflowTwd: number;
  endValueTwd: number;
  netPnlTwd: number;
  modifiedDietz: number;
  twr: number;
  benchmarkSymbol: string;
  benchmarkName: string;
  benchmarkReturn: number | null;
  alpha: number | null;
}

export interface BenchmarkSeriesPoint {
  date: string;
  values: Record<string, number>; // normalized to 100 at range start
}

export interface QuantEngineOutput {
  asOfDate: string;
  latestFxRate: number;
  investedSeries: DailyPortfolioPoint[];
  totalSeries: DailyPortfolioPoint[];
  mddMatrix: MddMatrixRow[];
  symbolPerformance: SymbolPerformanceRow[];
  annualByScope: Record<BenchmarkScope, AnnualPerformanceRow[]>;
  totalCostBasisTwd: number;
  totalInvestedValueTwd: number;
  totalCashValueTwd: number;
  totalTwValueTwd: number;
  totalUsValueTwd: number;
  cumulativeDividendsTwd: number;
  cumulativeNetInvestedTwd: number;
}

export interface AmortizationRow {
  period: number; // 1..termMonths
  paymentDate: string; // YYYY-MM-DD
  paymentTwd: number;
  principalTwd: number;
  interestTwd: number;
  cumulativePrincipalTwd: number;
  cumulativeInterestTwd: number;
  remainingPrincipalTwd: number;
  paid: boolean;
}

export interface LoanHoldingSummary {
  symbol: string;
  name: string;
  currency: CurrencyCode;
  shares: number;
  dripShares: number;
  latestPrice: number;
  marketValueUsd: number;
  marketValueTwd: number;
  costBasisTwd: number;
  unrealizedPnlTwd: number;
  cumulativeDividendsTwd: number;
}

export interface LoanFacilitySummary {
  id: string;
  name: string;
  fundingTag: string;
  status: LoanStatus;
  startDate: string;
  closedDate: string | null;
  payoffTwd: number | null;
  refinancedPayoffTwd: number;
  holdingDays: number;
  principalTwd: number;
  disbursedTwd: number;
  wireFeeTwd: number;
  totalCostTwd: number; // disbursedTwd + wireFeeTwd (new capital invested)
  receivedUsd: number | null;
  avgEntryFxRate: number | null; // totalCostTwd / receivedUsd
  apr: number;
  effectiveApr: number; // True APR including origination + wire fees
  termMonths: number;
  monthsElapsed: number;
  monthlyPaymentTwd: number; // Contract monthly installment
  activeMonthlyPaymentTwd: number; // 0 when closed/refinanced; monthlyPaymentTwd when active
  fullTermInterestTwd: number; // Actual paid interest+payoff cost if closed/refinanced, else full-term interest
  accruedInterestToDateTwd: number;
  repaidPrincipalToDateTwd: number;
  remainingPrincipalTwd: number; // 0 when closed/refinanced
  holdingsValueTwd: number;
  residualCashUsd: number;
  residualCashTwd: number;
  cumulativeDividendsTwd: number;
  totalValueTwd: number;
  totalValueUsd: number;
  grossPnlTwd: number;
  grossReturn: number;
  fxPnlTwd: number | null; // USD FX gain/loss vs entry FX
  equityPnlTwd: number; // grossPnlTwd - (fxPnlTwd ?? 0)
  netPnlFullInterestTwd: number; // grossPnlTwd - fullTermInterestTwd
  netReturnFullInterest: number;
  netPnlAccruedInterestTwd: number; // grossPnlTwd - accruedInterestToDateTwd
  netReturnAccruedInterest: number;
  annualizedGrossReturn: number | null; // null if holdingDays < 30
  annualizedNetReturn: number | null; // based on full-term interest
  carrySpread: number | null; // annualizedGrossReturn - apr
  holdings: LoanHoldingSummary[];
  schedule: AmortizationRow[];
}

export interface PortfolioLeverageSummary {
  asOfDate: string;
  latestFxRate: number;
  facilities: LoanFacilitySummary[];
  totalPrincipalTwd: number;
  totalCostTwd: number;
  totalReceivedUsd: number;
  weightedAvgEntryFxRate: number | null;
  totalMonthlyPaymentTwd: number;
  weightedApr: number;
  totalFullTermInterestTwd: number;
  totalAccruedInterestTwd: number;
  totalRemainingDebtTwd: number;
  totalLoanAssetValueTwd: number;
  totalLoanAssetValueUsd: number;
  totalLoanGrossPnlTwd: number;
  totalLoanGrossReturn: number;
  totalLoanFxPnlTwd: number;
  totalLoanEquityPnlTwd: number;
  totalLoanNetPnlFullInterestTwd: number;
  totalLoanNetReturnFullInterest: number;
  totalLoanNetPnlAccruedInterestTwd: number;
  totalLoanNetReturnAccruedInterest: number;
  grossPortfolioAssetsTwd: number;
  netWorthTwd: number; // grossPortfolioAssetsTwd - totalRemainingDebtTwd
  leverageRatio: number | null; // grossPortfolioAssetsTwd / netWorthTwd
  debtToAssetRatio: number; // totalRemainingDebtTwd / grossPortfolioAssetsTwd
}
