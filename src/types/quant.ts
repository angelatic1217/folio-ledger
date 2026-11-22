import type { BenchmarkScope, CurrencyCode, MarketCode } from "./sheet";

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
  annualByScope: Record<BenchmarkScope, AnnualPerformanceRow[]>;
  totalCostBasisTwd: number;
  totalInvestedValueTwd: number;
  totalCashValueTwd: number;
  totalTwValueTwd: number;
  totalUsValueTwd: number;
  cumulativeDividendsTwd: number;
  cumulativeNetInvestedTwd: number;
}
