import type { MddThresholds } from "@/types/quant";
import type { PortfolioSheetsData } from "@/types/sheet";
import { DEFAULT_MDD_THRESHOLDS } from "../quant/drawdown";

const DB_NAME = "folio-ledger-local-db";
const DB_VERSION = 1;
const STORE_NAME = "kv";

export interface LocalAppSettings {
  googleClientId: string;
  spreadsheetId: string;
  mddThresholds: MddThresholds;
  activeMode: "empty" | "demo" | "local";
}

export const DEFAULT_LOCAL_SETTINGS: LocalAppSettings = {
  googleClientId: "",
  spreadsheetId: "",
  mddThresholds: DEFAULT_MDD_THRESHOLDS,
  activeMode: "empty",
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadLocalSettings(): Promise<LocalAppSettings> {
  const saved = await idbGet<Partial<LocalAppSettings>>("settings");
  if (!saved) return DEFAULT_LOCAL_SETTINGS;
  return {
    googleClientId: saved.googleClientId ?? "",
    spreadsheetId: saved.spreadsheetId ?? "",
    mddThresholds: saved.mddThresholds ?? DEFAULT_MDD_THRESHOLDS,
    activeMode: saved.activeMode ?? "empty",
  };
}

export async function saveLocalSettings(settings: LocalAppSettings): Promise<void> {
  await idbSet("settings", settings);
}

export async function loadCachedSheetsData(): Promise<PortfolioSheetsData | null> {
  return idbGet<PortfolioSheetsData>("sheetsData");
}

export async function saveCachedSheetsData(data: PortfolioSheetsData): Promise<void> {
  await idbSet("sheetsData", data);
}

export async function clearAllLocalData(): Promise<void> {
  await idbClear();
}
