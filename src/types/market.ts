import type { CurrencyCode } from "./sheet";

export interface DailyBar {
  date: string; // YYYY-MM-DD
  close: number; // Split-adjusted close (matches Yahoo Finance `close`)
  adjClose: number; // Split + dividend adjusted close (matches Yahoo Finance `adjclose`)
}

export interface SplitEvent {
  date: string; // YYYY-MM-DD (ex-split date)
  ratio: number; // e.g. 4 for 1-for-4 split (pre-split share * 4 = post-split share)
}

export interface TickerMarketData {
  symbol: string;
  yahooTicker: string;
  currency: CurrencyCode;
  lastPrice: number;
  lastDate: string;
  bars: DailyBar[];
  splits: SplitEvent[];
}

export interface MarketDataBundle {
  generatedAt: string;
  fxTicker: string;
  fxBars: DailyBar[];
  tickers: Record<string, TickerMarketData>;
}
