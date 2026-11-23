import type {
  Asset,
  BenchmarkConfig,
  BenchmarkScope,
  CashSnapshot,
  CurrencyCode,
  LoanFacility,
  LoanStatus,
  MarketCode,
  Transaction,
  TransactionType,
} from "@/types/sheet";

const SYMBOL_ALIASES: Record<string, string> = {
  "LON:VALU": "VALU.LON",
  "VALU.L": "VALU.LON",
};

export function normalizeSymbol(raw: unknown): string {
  const cleaned = String(raw ?? "").trim().toUpperCase();
  if (!cleaned) return "";
  if (SYMBOL_ALIASES[cleaned]) return SYMBOL_ALIASES[cleaned];
  // Extract leading TW stock ticker when mixed with Chinese name (e.g. "006208富邦台50" -> "006208")
  const twMatch = cleaned.match(/^(\d{4,6}[A-Z]?)[\u4e00-\u9fff]/);
  if (twMatch) return twMatch[1];
  return cleaned;
}

export function normalizeFundingTag(raw: unknown): string | undefined {
  const s = String(raw ?? "")
    .trim()
    .replace(/^\[+/, "")
    .replace(/\]+$/, "")
    .trim();
  return s || undefined;
}

function normalizeHeader(h: string): string {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function parseNumber(val: unknown): number {
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;
  const cleaned = String(val ?? "")
    .replace(/[,$\sNT%]/gi, "")
    .trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseRate(val: unknown): number {
  const rawStr = String(val ?? "").trim();
  if (!rawStr) return 0;
  const hasPercent = rawStr.includes("%");
  const num = parseNumber(val);
  if (hasPercent || num > 1) return num / 100;
  return num;
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
  if (
    s === "BUY" ||
    s === "買入" ||
    s === "買進" ||
    s === "首次建倉" ||
    s === "增貸建倉" ||
    s === "買入配置" ||
    s === "定期定額"
  ) {
    return "BUY";
  }
  if (s === "SELL" || s === "賣出" || s === "賣出換股" || s === "賣出平倉") {
    return "SELL";
  }
  if (s === "DIVIDEND" || s === "現金股利" || s === "股利" || s === "配息") {
    return "DIVIDEND";
  }
  if (s === "DRIP" || s === "股息再投資" || s === "股息再投入" || s === "配息再投入") {
    return "DRIP";
  }
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

  const iDate = findCol(headers, ["date", "日期", "交易日期"]);
  const iSymbol = findCol(headers, ["symbol", "標的代號", "代碼"]);
  const iType = findCol(headers, ["type", "交易類別", "類別"]);
  const iShares = findCol(headers, ["shares", "股數", "數量", "變動股數"]);
  const iPrice = findCol(headers, ["price", "成交單價", "單價", "成交單價_(usd)"]);
  const iFee = findCol(headers, ["fee", "手續費與稅", "手續費"]);
  const iFx = findCol(headers, ["fx_rate", "當日匯率", "匯率", "參考匯率"]);
  const iTag = findCol(headers, [
    "funding_tag",
    "tag",
    "資金來源標籤",
    "資金來源",
    "帳戶",
    "方案",
  ]);
  const iNote = findCol(headers, ["note", "備註", "說明", "交易備註說明"]);

  if (iDate === -1 || iSymbol === -1 || iType === -1) return [];

  const result: Transaction[] = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || row.length === 0) continue;
    const date = parseDate(row[iDate]);
    const symbol = normalizeSymbol(row[iSymbol]);
    const type = parseTxType(row[iType]);
    if (!date || !symbol || !type) continue;

    const rawShares = iShares >= 0 ? parseNumber(row[iShares]) : 0;
    const shares = Math.abs(rawShares);
    const price = iPrice >= 0 ? Math.abs(parseNumber(row[iPrice])) : 0;
    const fee = iFee >= 0 ? Math.abs(parseNumber(row[iFee])) : 0;
    const rawFx = iFx >= 0 ? parseNumber(row[iFx]) : 0;
    const fundingTag = iTag >= 0 ? normalizeFundingTag(row[iTag]) : undefined;
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
      fundingTag,
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
        const symbol = normalizeSymbol(row[iSymbol]);
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

function parseLoanStatus(val: unknown, hasClosedDate: boolean): LoanStatus {
  const s = String(val ?? "").trim().toLowerCase();
  if (s === "refinanced" || s === "借新還舊" || s === "已轉貸" || s === "轉貸結清" || s === "代償結清") {
    return "refinanced";
  }
  if (s === "closed" || s === "已結清" || s === "已清償" || s === "結清") {
    return "closed";
  }
  if (s === "active" || s === "進行中" || s === "還款中") {
    return "active";
  }
  return hasClosedDate ? "refinanced" : "active";
}

export function parseLoansGrid(grid: unknown[][]): LoanFacility[] {
  if (grid.length < 2) return [];
  const headers = grid[0].map((h) => normalizeHeader(String(h ?? "")));

  const iId = findCol(headers, ["id", "代碼", "方案代碼"]);
  const iName = findCol(headers, ["name", "方案名稱", "名稱", "貸款名稱"]);
  const iTag = findCol(headers, ["funding_tag", "tag", "資金來源標籤", "資金來源", "標籤"]);
  const iStartDate = findCol(headers, ["start_date", "撥款日", "起始日", "日期"]);
  const iPrincipal = findCol(headers, ["principal_twd", "principal", "核貸本金", "核貸總本金", "本金"]);
  const iDisbursed = findCol(headers, ["disbursed_twd", "disbursed", "實撥金額", "實際撥款金額", "實際到款"]);
  const iWireFee = findCol(headers, ["wire_fee_twd", "wire_fee", "匯費", "規費"]);
  const iReceivedUsd = findCol(headers, ["received_usd", "實收美金", "券商實收到款"]);
  const iApr = findCol(headers, ["apr", "年利率", "利率"]);
  const iTerm = findCol(headers, ["term_months", "term", "期數"]);
  const iMonthly = findCol(headers, ["monthly_payment_twd", "monthly_payment", "月還款", "每月償還"]);
  const iTotalInterest = findCol(headers, [
    "total_interest_twd",
    "total_interest_override_twd",
    "全期總利息",
    "總利息",
  ]);
  const iStatus = findCol(headers, ["status", "狀態", "貸款狀態"]);
  const iClosedDate = findCol(headers, ["closed_date", "結清日", "代償日", "結束日"]);
  const iPayoff = findCol(headers, ["payoff_twd", "結清金額", "清償金額"]);
  const iRefiPayoff = findCol(headers, [
    "refinanced_payoff_twd",
    "代償舊貸金額",
    "借新還舊代償",
    "代償金額",
  ]);
  const iNote = findCol(headers, ["note", "備註", "說明"]);

  if (iPrincipal === -1 && iDisbursed === -1) return [];

  const result: LoanFacility[] = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || row.length === 0) continue;

    const principalTwd = iPrincipal >= 0 ? Math.abs(parseNumber(row[iPrincipal])) : 0;
    const rawDisbursed = iDisbursed >= 0 ? Math.abs(parseNumber(row[iDisbursed])) : 0;
    const disbursedTwd = rawDisbursed > 0 ? rawDisbursed : principalTwd;
    if (principalTwd <= 0 && disbursedTwd <= 0) continue;

    const startDate = parseDate(iStartDate >= 0 ? row[iStartDate] : "");
    if (!startDate) continue;

    const name =
      (iName >= 0 ? String(row[iName] ?? "").trim() : "") ||
      `信貸方案 ${r}`;
    const fundingTag =
      (iTag >= 0 ? normalizeFundingTag(row[iTag]) : undefined) ?? name;
    const id =
      (iId >= 0 ? String(row[iId] ?? "").trim() : "") || `loan-${r}-${fundingTag}`;
    const wireFeeTwd = iWireFee >= 0 ? Math.abs(parseNumber(row[iWireFee])) : 0;
    const rawReceivedUsd = iReceivedUsd >= 0 ? Math.abs(parseNumber(row[iReceivedUsd])) : 0;
    const apr = iApr >= 0 ? Math.max(0, parseRate(row[iApr])) : 0;
    const termMonths = Math.max(
      1,
      Math.round(iTerm >= 0 ? Math.abs(parseNumber(row[iTerm])) : 84) || 84
    );
    const rawMonthly = iMonthly >= 0 ? Math.abs(parseNumber(row[iMonthly])) : 0;
    const rawTotalInterest =
      iTotalInterest >= 0 ? Math.abs(parseNumber(row[iTotalInterest])) : 0;
    const closedDate = iClosedDate >= 0 ? parseDate(row[iClosedDate]) : "";
    const status = parseLoanStatus(iStatus >= 0 ? row[iStatus] : "", Boolean(closedDate));
    const rawPayoff = iPayoff >= 0 ? Math.abs(parseNumber(row[iPayoff])) : 0;
    const rawRefiPayoff = iRefiPayoff >= 0 ? Math.abs(parseNumber(row[iRefiPayoff])) : 0;
    const note = iNote >= 0 ? String(row[iNote] ?? "").trim() : undefined;

    result.push({
      id,
      name,
      fundingTag,
      startDate,
      principalTwd: principalTwd > 0 ? principalTwd : disbursedTwd,
      disbursedTwd,
      wireFeeTwd,
      receivedUsd: rawReceivedUsd > 0 ? rawReceivedUsd : null,
      apr,
      termMonths,
      monthlyPaymentTwd: rawMonthly > 0 ? rawMonthly : null,
      totalInterestOverrideTwd: rawTotalInterest > 0 ? rawTotalInterest : null,
      status,
      closedDate: closedDate || null,
      payoffTwd: rawPayoff > 0 ? rawPayoff : null,
      refinancedPayoffTwd: rawRefiPayoff > 0 ? rawRefiPayoff : null,
      note: note || undefined,
    });
  }

  return result.sort((a, b) => a.startDate.localeCompare(b.startDate));
}
