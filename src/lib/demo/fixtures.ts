import type { MarketDataBundle } from "@/types/market";
import type {
  Asset,
  BenchmarkConfig,
  CashSnapshot,
  LoanFacility,
  PortfolioSheetsData,
  Transaction,
} from "@/types/sheet";

export const DEFAULT_DEMO_ASSETS: Asset[] = [
  { symbol: "0050", name: "元大台灣50", market: "TW", currency: "TWD", yahooTicker: "0050.TW", monitorMdd: true },
  { symbol: "006208", name: "富邦台50", market: "TW", currency: "TWD", yahooTicker: "006208.TW", monitorMdd: true },
  { symbol: "QQQ", name: "Invesco QQQ Trust", market: "US", currency: "USD", yahooTicker: "QQQ", monitorMdd: true },
  { symbol: "VOO", name: "Vanguard S&P 500", market: "US", currency: "USD", yahooTicker: "VOO", monitorMdd: true },
  { symbol: "VT", name: "Vanguard Total World", market: "US", currency: "USD", yahooTicker: "VT", monitorMdd: true },
  { symbol: "SOXX", name: "iShares 半導體 ETF", market: "US", currency: "USD", yahooTicker: "SOXX", monitorMdd: true },
];

export const DEFAULT_DEMO_BENCHMARKS: BenchmarkConfig[] = [
  { symbol: "0050", name: "元大台灣50", yahooTicker: "0050.TW", currency: "TWD", scope: "TW" },
  { symbol: "TWII", name: "台灣加權指數", yahooTicker: "^TWII", currency: "TWD", scope: "TW" },
  { symbol: "VOO", name: "標普 500 (VOO)", yahooTicker: "VOO", currency: "USD", scope: "US" },
  { symbol: "VT", name: "全球股票 (VT)", yahooTicker: "VT", currency: "USD", scope: "ALL" },
  { symbol: "AOA", name: "股債平衡 (AOA)", yahooTicker: "AOA", currency: "USD", scope: "ALL" },
];

export const DEMO_TRANSACTIONS: Transaction[] = [
  // 2023-2024: Pre-split 0050 raw broker shares (automatically aligned against Yahoo Finance 0050 1-for-4 split!)
  { id: "d1", date: "2023-06-15", symbol: "0050", type: "BUY", shares: 1000, price: 132.5, fee: 20, fxRate: 1, fundingTag: "自有資金", note: "建立台股核心部位（拆股前原始股數）" },
  { id: "d2", date: "2023-09-20", symbol: "006208", type: "BUY", shares: 1200, price: 73.2, fee: 20, fxRate: 1, fundingTag: "自有資金", note: "定期定額投入" },
  { id: "d3", date: "2024-01-18", symbol: "VOO", type: "BUY", shares: 12, price: 438.5, fee: 0, fxRate: 31.4, fundingTag: "自有資金", note: "建立美股大盤部位" },
  { id: "d4", date: "2024-03-15", symbol: "QQQ", type: "BUY", shares: 10, price: 439.2, fee: 0, fxRate: 31.6, fundingTag: "自有資金", note: "建立科技成長部位" },
  { id: "d5", date: "2024-05-10", symbol: "VT", type: "BUY", shares: 45, price: 111.5, fee: 0, fxRate: 32.3, fundingTag: "自有資金", note: "全球市場分散" },
  { id: "d6", date: "2024-06-28", symbol: "VOO", type: "DRIP", shares: 0.042, price: 500.8, fee: 0, fxRate: 32.4, fundingTag: "自有資金", note: "股息再投資 (CF=0)" },
  { id: "d7", date: "2024-07-22", symbol: "0050", type: "DIVIDEND", shares: 1000, price: 1.0, fee: 10, fxRate: 1, fundingTag: "自有資金", note: "2024 下半年現金股利" },
  { id: "d8", date: "2024-11-15", symbol: "0050", type: "BUY", shares: 500, price: 192.0, fee: 20, fxRate: 1, fundingTag: "自有資金", note: "年底定期加碼（拆股前）" },
  { id: "d9", date: "2025-02-18", symbol: "VOO", type: "BUY", shares: 6, price: 560.0, fee: 0, fxRate: 32.7, fundingTag: "自有資金", note: "美股加碼" },
  { id: "d10", date: "2025-04-09", symbol: "QQQ", type: "BUY", shares: 6, price: 445.0, fee: 0, fxRate: 32.9, fundingTag: "自有資金", note: "左側大幅回檔逢低布局" },
  { id: "d11", date: "2025-06-27", symbol: "VOO", type: "DRIP", shares: 0.068, price: 562.0, fee: 0, fxRate: 29.8, fundingTag: "自有資金", note: "股息再投資 (CF=0)" },
  { id: "d12", date: "2025-08-15", symbol: "0050", type: "BUY", shares: 2500, price: 53.5, fee: 20, fxRate: 1, fundingTag: "自有資金", note: "拆股後定期定額加碼" },
  { id: "d13", date: "2025-10-15", symbol: "006208", type: "BUY", shares: 800, price: 138.0, fee: 20, fxRate: 1, fundingTag: "自有資金", note: "台股部位加碼" },
  { id: "d14", date: "2025-11-20", symbol: "VT", type: "BUY", shares: 25, price: 132.0, fee: 0, fxRate: 31.4, fundingTag: "2025示範信貸", note: "示範信貸建倉：全球配置" },
  { id: "d15", date: "2026-01-20", symbol: "0050", type: "BUY", shares: 1500, price: 69.0, fee: 20, fxRate: 1, fundingTag: "自有資金", note: "2026 年初投入" },
  { id: "d16", date: "2026-03-25", symbol: "QQQ", type: "DRIP", shares: 0.045, price: 585.0, fee: 0, fxRate: 32.2, fundingTag: "自有資金", note: "股息再投資 (CF=0)" },
  { id: "d17", date: "2026-05-15", symbol: "VOO", type: "SELL", shares: 2, price: 598.0, fee: 1, fxRate: 32.1, fundingTag: "自有資金", note: "小幅再平衡獲利了結" },
  { id: "d18", date: "2026-07-24", symbol: "0050", type: "DIVIDEND", shares: 10000, price: 0.95, fee: 10, fxRate: 1, fundingTag: "自有資金", note: "2026 配息入帳" },
  { id: "d19", date: "2026-08-18", symbol: "VT", type: "BUY", shares: 15, price: 139.0, fee: 0, fxRate: 32.5, fundingTag: "2025示範信貸", note: "示範信貸加碼：全球分散" },
];

export const DEMO_LOANS: LoanFacility[] = [
  {
    id: "demo-loan-2025",
    name: "2025 示範信貸方案",
    fundingTag: "2025示範信貸",
    startDate: "2025-11-20",
    principalTwd: 200000,
    disbursedTwd: 198000,
    wireFeeTwd: 400,
    receivedUsd: 6250,
    apr: 0.025,
    termMonths: 84,
    monthlyPaymentTwd: null,
    totalInterestOverrideTwd: null,
    note: "內建 Demo 模擬信貸（對應 2025示範信貸 交易標籤）",
  },
];

export const DEMO_CASH_SNAPSHOTS: CashSnapshot[] = [
  { date: "2023-06-15", currency: "TWD", balance: 450000, note: "初始保留現金" },
  { date: "2024-12-31", currency: "TWD", balance: 530000, note: "2024 年底帳戶現金餘額" },
  { date: "2025-12-31", currency: "TWD", balance: 280000, note: "2025 年底帳戶現金餘額" },
  { date: "2026-10-31", currency: "TWD", balance: 510000, note: "最新交割戶與備用現金" },
];

export function createDemoSheetsData(): PortfolioSheetsData {
  return {
    transactions: DEMO_TRANSACTIONS,
    assets: DEFAULT_DEMO_ASSETS,
    cashSnapshots: DEMO_CASH_SNAPSHOTS,
    benchmarks: DEFAULT_DEMO_BENCHMARKS,
    loans: DEMO_LOANS,
    syncedAt: new Date().toISOString(),
    source: "demo",
  };
}

/**
 * Fallback deterministic market bundle used only if `public/data/market-data.json` cannot be fetched.
 */
export function createFallbackMarketBundle(): MarketDataBundle {
  const dates: string[] = [];
  const start = new Date("2023-06-01T00:00:00Z");
  const end = new Date("2026-11-20T00:00:00Z");
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(d.toISOString().slice(0, 10));
  }

  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const fxBars = dates.map((date, idx) => {
    const val = Number((31.2 + Math.sin(idx / 60) * 1.1 + idx * 0.0015).toFixed(4));
    return { date, close: val, adjClose: val };
  });

  const makeTicker = (
    symbol: string,
    yahooTicker: string,
    currency: "TWD" | "USD",
    startPx: number,
    drift: number,
    vol: number
  ) => {
    let px = startPx;
    let adj = startPx;
    const bars = dates.map((date, i) => {
      const shock = i > 440 && i < 475 ? -0.004 : 0;
      const r = (rand() - 0.48) * vol + drift + shock;
      px = Math.max(1, px * (1 + r));
      adj = Math.max(1, adj * (1 + r + 0.00008));
      return {
        date,
        close: Number(px.toFixed(4)),
        adjClose: Number(adj.toFixed(4)),
      };
    });
    const last = bars[bars.length - 1];
    return {
      symbol,
      yahooTicker,
      currency,
      lastPrice: last.close,
      lastDate: last.date,
      bars,
      splits: [],
    };
  };

  return {
    generatedAt: new Date().toISOString(),
    fxTicker: "TWD=X",
    fxBars,
    tickers: {
      "0050": makeTicker("0050", "0050.TW", "TWD", 33, 0.0007, 0.015),
      "006208": makeTicker("006208", "006208.TW", "TWD", 74, 0.0007, 0.015),
      QQQ: makeTicker("QQQ", "QQQ", "USD", 355, 0.0006, 0.018),
      VOO: makeTicker("VOO", "VOO", "USD", 390, 0.0005, 0.013),
      VT: makeTicker("VT", "VT", "USD", 96, 0.0004, 0.012),
      SOXX: makeTicker("SOXX", "SOXX", "USD", 160, 0.0005, 0.024),
      AOA: makeTicker("AOA", "AOA", "USD", 65, 0.00035, 0.009),
      TWII: makeTicker("TWII", "^TWII", "TWD", 16800, 0.00065, 0.014),
    },
  };
}
