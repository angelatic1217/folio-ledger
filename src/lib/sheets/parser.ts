import type {
  Asset,
  BenchmarkConfig,
  BenchmarkScope,
  CashSnapshot,
  CurrencyCode,
  MarketCode,
  Transaction,
  TransactionType,
} from "@/types/sheet";

function normalizeHeader(h: string): string {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function parseNumber(val: unknown): number {
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;
  const cleaned = String(val ?? "")
    .replace(/[,$\sNT]/gi, "")
    .trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(val: unknown): string {
  const s = String(val ?? "").trim();
  if (!s) return "";
  // Support YYYY/MM/DD or YYYY-MM-DD
  const match = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function parseTxType(val: unknown): TransactionType | null {
  const s = String(val ?? "").trim().toUpperCase();
  if (s === "BUY" || s === "買入" || s === "買進") return "BUY";
  if (s === "SELL" || s === "賣出") return "SELL";
  if (s === "DIVIDEND" || s === "現金股利" || s === "股利" || s === "配息") return "DIVIDEND";
  if (s === "DRIP" || s === "股息再投資" || s === "配息再投入") return "DRIP";
  return null;
}

function parseMarket(val: unknown, symbol: string): MarketCode {
  const s = String(val ?? "").trim().toUpperCase();
  if (s === "US" || s === "美股") return "US";
  if (s === "TW" || s === "台股") return "TW";
  return /^\d/.test(symbol) ? "TW" : "US";
}

function parseCurrency(val: unknown, market: MarketCode): CurrencyCode {
  const s = String(val ?? "").trim().toUpperCase();
  if (s === "USD") return "USD";
  if (s === "TWD") return "TWD";
  return market === "US" ? "USD" : "TWD";
}

function parseBool(val: unknown, fallback = true): boolean {
  const s = String(val ?? "").trim().toUpperCase();
  if (!s) return fallback;
  return s === "TRUE" || s === "1" || s === "YES" || s === "Y" || s === "是";
}

/**
 * Simple RFC-4180 CSV parser (handles quoted commas and CRLF/LF).
 */
export function parseCsvToGrid(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const cleanText = text.replace(/^\uFEFF/, ""); // Strip BOM

  for (let i = 0; i < cleanText.length; i++) {
    const ch = cleanText[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleanText[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && cleanText[i + 1] === "\n") i++;
      row.push(field.trim());
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  row.push(field.trim());
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

function findCol(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const idx = headers.indexOf(normalizeHeader(alias));
    if (idx !== -1) return idx;
  }
  return -1;
}

export function parseTransactionsGrid(grid: unknown[][]): Transaction[] {
  if (grid.length < 2) return [];
  const headers = grid[0].map((h) => normalizeHeader(String(h ?? "")));

  const iDate = findCol(headers, ["date", "日期"]);
  const iSymbol = findCol(headers, ["symbol", "標的代號", "代碼"]);
  const iType = findCol(headers, ["type", "交易類別", "類別"]);
  const iShares = findCol(headers, ["shares", "股數", "數量"]);
  const iPrice = findCol(headers, ["price", "成交單價", "單價"]);
  const iFee = findCol(headers, ["fee", "手續費與稅", "手續費"]);
  const iFx = findCol(headers, ["fx_rate", "當日匯率", "匯率"]);
  const iNote = findCol(headers, ["note", "備註", "說明"]);

  if (iDate === -1 || iSymbol === -1 || iType === -1) return [];

  const result: Transaction[] = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || row.length === 0) continue;
    const date = parseDate(row[iDate]);
    const symbol = String(row[iSymbol] ?? "").trim().toUpperCase();
    const type = parseTxType(row[iType]);
    if (!date || !symbol || !type) continue;

    const shares = iShares >= 0 ? parseNumber(row[iShares]) : 0;
    const price = iPrice >= 0 ? parseNumber(row[iPrice]) : 0;
    const fee = iFee >= 0 ? parseNumber(row[iFee]) : 0;
    const rawFx = iFx >= 0 ? parseNumber(row[iFx]) : 0;
    const note = iNote >= 0 ? String(row[iNote] ?? "").trim() : undefined;

    result.push({
      id: `tx-${r}-${date}-${symbol}`,
      date,
      symbol,
      type,
      shares,
      price,
      fee,
      fxRate: rawFx > 0 ? rawFx : null,
      note: note || undefined,
    });
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

export function parseAssetsGrid(
  grid: unknown[][],
  fallbackTransactions: Transaction[] = []
): Asset[] {
  const result: Asset[] = [];
  const seen = new Set<string>();

  if (grid.length >= 2) {
    const headers = grid[0].map((h) => normalizeHeader(String(h ?? "")));
    const iSymbol = findCol(headers, ["symbol", "標的代號", "代碼"]);
    const iName = findCol(headers, ["name", "標的名稱", "名稱"]);
    const iMarket = findCol(headers, ["market", "市場分類", "市場"]);
    const iCurrency = findCol(headers, ["currency", "幣別", "計價幣別"]);
    const iYahoo = findCol(headers, ["yahoo_ticker", "報價代碼", "gf_報價代碼"]);
    const iMonitor = findCol(headers, ["monitor_mdd", "mdd監控", "監控"]);

    if (iSymbol !== -1) {
      for (let r = 1; r < grid.length; r++) {
        const row = grid[r];
        if (!row) continue;
        const symbol = String(row[iSymbol] ?? "").trim().toUpperCase();
        if (!symbol || seen.has(symbol)) continue;
        seen.add(symbol);

        const market = parseMarket(iMarket >= 0 ? row[iMarket] : "", symbol);
        const currency = parseCurrency(iCurrency >= 0 ? row[iCurrency] : "", market);
        const rawYahoo = iYahoo >= 0 ? String(row[iYahoo] ?? "").trim() : "";
        const yahooTicker =
          rawYahoo || (market === "TW" ? `${symbol}.TW` : symbol);

        result.push({
          symbol,
          name: (iName >= 0 ? String(row[iName] ?? "").trim() : "") || symbol,
          market,
          currency,
          yahooTicker,
          monitorMdd: iMonitor >= 0 ? parseBool(row[iMonitor], true) : true,
        });
      }
    }
  }

  // Ensure every symbol referenced in transactions exists in assets
  for (const tx of fallbackTransactions) {
    if (seen.has(tx.symbol)) continue;
    seen.add(tx.symbol);
    const market = parseMarket("", tx.symbol);
    const currency = parseCurrency("", market);
    result.push({
      symbol: tx.symbol,
      name: tx.symbol,
      market,
      currency,
      yahooTicker: market === "TW" ? `${tx.symbol}.TW` : tx.symbol,
      monitorMdd: true,
    });
  }

  return result;
}

export function parseCashSnapshotsGrid(grid: unknown[][]): CashSnapshot[] {
  if (grid.length < 2) return [];
  const headers = grid[0].map((h) => normalizeHeader(String(h ?? "")));
  const iDate = findCol(headers, ["date", "日期"]);
  const iCurrency = findCol(headers, ["currency", "幣別"]);
  const iBalance = findCol(headers, ["balance", "餘額", "金額"]);
  const iNote = findCol(headers, ["note", "備註"]);

  if (iDate === -1 || iBalance === -1) return [];

  const result: CashSnapshot[] = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    const date = parseDate(row[iDate]);
    if (!date) continue;
    const ccyRaw = iCurrency >= 0 ? String(row[iCurrency] ?? "").trim().toUpperCase() : "TWD";
    const currency: CurrencyCode = ccyRaw === "USD" ? "USD" : "TWD";
    const balance = parseNumber(row[iBalance]);
    const note = iNote >= 0 ? String(row[iNote] ?? "").trim() : undefined;
    result.push({ date, currency, balance, note: note || undefined });
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

export function parseBenchmarksGrid(grid: unknown[][]): BenchmarkConfig[] {
  if (grid.length < 2) return [];
  const headers = grid[0].map((h) => normalizeHeader(String(h ?? "")));
  const iSymbol = findCol(headers, ["symbol", "代號"]);
  const iName = findCol(headers, ["name", "名稱"]);
  const iYahoo = findCol(headers, ["yahoo_ticker", "報價代碼"]);
  const iCurrency = findCol(headers, ["currency", "幣別"]);
  const iScope = findCol(headers, ["scope", "比較組別", "適用範圍"]);

  if (iSymbol === -1) return [];

  const result: BenchmarkConfig[] = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    const symbol = String(row[iSymbol] ?? "").trim().toUpperCase();
    if (!symbol) continue;
    const market = parseMarket("", symbol);
    const currency = parseCurrency(iCurrency >= 0 ? row[iCurrency] : "", market);
    const scopeRaw = iScope >= 0 ? String(row[iScope] ?? "").trim().toUpperCase() : "ALL";
    const scope: BenchmarkScope =
      scopeRaw === "TW" || scopeRaw === "US" ? scopeRaw : "ALL";
    const yahooTicker =
      (iYahoo >= 0 ? String(row[iYahoo] ?? "").trim() : "") ||
      (market === "TW" ? `${symbol}.TW` : symbol);

    result.push({
      symbol,
      name: (iName >= 0 ? String(row[iName] ?? "").trim() : "") || symbol,
      yahooTicker,
      currency,
      scope,
    });
  }

  return result;
}
