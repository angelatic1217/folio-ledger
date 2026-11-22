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

export interface PortfolioSheetsData {
  transactions: Transaction[];
  assets: Asset[];
  cashSnapshots: CashSnapshot[];
  benchmarks: BenchmarkConfig[];
  syncedAt?: string;
  source: "demo" | "google-sheets" | "csv";
}
