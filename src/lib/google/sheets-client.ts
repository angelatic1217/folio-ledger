/**
 * Pure client-side Google Sheets reader using Google Identity Services (GIS) OAuth 2.0.
 * Works natively on static hosts (GitHub Pages) with zero backend server because
 * `https://sheets.googleapis.com` natively allows browser CORS requests with a Bearer token.
 */
import type { PortfolioSheetsData } from "@/types/sheet";
import {
  parseAssetsGrid,
  parseBenchmarksGrid,
  parseCashSnapshotsGrid,
  parseLoansGrid,
  parseTransactionsGrid,
} from "../sheets/parser";
import { DEFAULT_DEMO_BENCHMARKS } from "../demo/fixtures";

const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (resp: TokenResponse) => void;
    error_callback?: (err: { type?: string; message?: string }) => void;
  }) => {
    requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
  };
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: GoogleOAuth2;
      };
    };
  }
}

let gisLoadPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google OAuth 僅能在瀏覽器環境執行"));
  }
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisLoadPromise = null;
      reject(new Error("無法載入 Google Identity Services (accounts.google.com)"));
    };
    document.head.appendChild(script);
  });

  return gisLoadPromise;
}

/**
 * Extracts spreadsheet ID whether the user pastes a full Google Sheets URL or a bare ID.
 */
export function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : trimmed;
}

/**
 * Requests a short-lived browser-only read-only access token via Google Identity Services.
 */
export async function requestGoogleSheetsAccessToken(
  clientId: string
): Promise<string> {
  const cleanClientId = clientId.trim();
  if (!cleanClientId) {
    throw new Error("請先填寫 Google OAuth Client ID");
  }

  await loadGisScript();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error("Google OAuth 模組初始化失敗");
  }

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: cleanClientId,
      scope: SHEETS_READONLY_SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(
            new Error(resp.error_description || resp.error || "Google 授權失敗或已取消")
          );
          return;
        }
        resolve(resp.access_token);
      },
      error_callback: (err) => {
        reject(new Error(err?.message || err?.type || "Google 登入視窗已關閉"));
      },
    });
    client.requestAccessToken({ prompt: "" });
  });
}

async function fetchSheetRange(
  spreadsheetId: string,
  range: string,
  accessToken: string
): Promise<unknown[][] | null> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 400 || res.status === 404) {
    return null; // Sheet tab does not exist (optional tabs)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`讀取工作表 "${range}" 失敗 (HTTP ${res.status}) ${text.slice(0, 120)}`);
  }
  const json = await res.json();
  return (json.values as unknown[][]) ?? [];
}

/**
 * Fetches the 4 redesigned tables directly from a private Google Sheet via CORS-enabled Sheets API.
 * Also falls back to Chinese sheet name `交易紀錄` if `transactions` tab is not found.
 */
export async function syncPrivateGoogleSheet(params: {
  clientId: string;
  spreadsheetId: string;
}): Promise<PortfolioSheetsData> {
  const sheetId = extractSpreadsheetId(params.spreadsheetId);
  if (!sheetId) throw new Error("請填寫有效的 Google Sheet ID 或連結");

  const token = await requestGoogleSheetsAccessToken(params.clientId);

  const txGrid =
    (await fetchSheetRange(sheetId, "transactions!A:L", token)) ??
    (await fetchSheetRange(sheetId, "交易紀錄!A:L", token));

  if (!txGrid || txGrid.length < 2) {
    throw new Error("找不到 `transactions`（或 `交易紀錄`）分頁，或該分頁尚無資料列");
  }

  const [assetsGrid, cashGrid, benchGrid, loansGridPrimary, loansGridZh] =
    await Promise.all([
      fetchSheetRange(sheetId, "assets!A:H", token),
      fetchSheetRange(sheetId, "cash_snapshots!A:F", token),
      fetchSheetRange(sheetId, "benchmarks!A:F", token),
      fetchSheetRange(sheetId, "loans!A:N", token),
      fetchSheetRange(sheetId, "信貸方案!A:N", token),
    ]);

  const transactions = parseTransactionsGrid(txGrid);
  const assets = parseAssetsGrid(assetsGrid ?? [], transactions);
  const cashSnapshots = parseCashSnapshotsGrid(cashGrid ?? []);
  const parsedBenchmarks = parseBenchmarksGrid(benchGrid ?? []);
  const loans = parseLoansGrid(loansGridPrimary ?? loansGridZh ?? []);

  return {
    transactions,
    assets,
    cashSnapshots,
    benchmarks:
      parsedBenchmarks.length > 0 ? parsedBenchmarks : DEFAULT_DEMO_BENCHMARKS,
    loans,
    syncedAt: new Date().toISOString(),
    source: "google-sheets",
  };
}
