export type MarketCode = "TW" | "US";
export type CurrencyCode = "TWD" | "USD";
export type TransactionType = "BUY" | "SELL" | "DIVIDEND" | "DRIP";
export type BenchmarkScope = "TW" | "US" | "ALL";

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  symbol: string;
  type: TransactionType;
  shares: number;
  price: number;
  fee: number;
  fxRate?: number | null;
  fundingTag?: string; // e.g. "自有資金", "2025信貸", "2026增貸"
  note?: string;
}

export interface Asset {
  symbol: string;
  name: string;
  market: MarketCode;
  currency: CurrencyCode;
  yahooTicker: string;
  monitorMdd: boolean;
}

export interface CashSnapshot {
  date: string; // YYYY-MM-DD
  currency: CurrencyCode;
  balance: number;
  note?: string;
}

export interface BenchmarkConfig {
  symbol: string;
  name: string;
  yahooTicker: string;
  currency: CurrencyCode;
  scope: BenchmarkScope;
}

export type LoanStatus = "active" | "refinanced" | "closed";

export interface LoanFacility {
  id: string;
  name: string;
  fundingTag: string; // Matches Transaction.fundingTag
  startDate: string; // YYYY-MM-DD
  principalTwd: number; // Contract loan principal (NTD)
  disbursedTwd: number; // Net NEW cash disbursed for investing after origination fee & any payoff (NTD)
  wireFeeTwd: number; // Outbound wire / misc fees (NTD)
  receivedUsd?: number | null; // Net USD credited to broker (optional, enables FX attribution)
  apr: number; // Annual interest rate as decimal, e.g. 0.0246 for 2.46%
  termMonths: number; // Amortization term in months, e.g. 84
  monthlyPaymentTwd?: number | null; // Optional contract monthly payment override
  totalInterestOverrideTwd?: number | null; // Optional full-term interest override
  status?: LoanStatus; // "active" (default) | "refinanced" (paid off by newer loan) | "closed"
  closedDate?: string | null; // YYYY-MM-DD when loan was paid off / refinanced
  payoffTwd?: number | null; // Actual payoff amount paid to close this loan (NTD)
  refinancedPayoffTwd?: number | null; // Portion of this loan's principal used to pay off a prior loan (NTD)
  note?: string;
}

export interface PortfolioSheetsData {
  transactions: Transaction[];
  assets: Asset[];
  cashSnapshots: CashSnapshot[];
  benchmarks: BenchmarkConfig[];
  loans?: LoanFacility[];
  syncedAt?: string;
  source: "demo" | "google-sheets" | "csv";
}
