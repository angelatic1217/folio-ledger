"use client";

import {
  Activity,
  BarChart3,
  CalendarRange,
  Database,
  Download,
  Landmark,
  LayoutDashboard,
  Moon,
  RefreshCw,
  Settings,
  ShieldAlert,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyShellOnboarding } from "@/components/shell/EmptyShellOnboarding";
import { ExportModal } from "@/components/shell/ExportModal";
import { SettingsModal } from "@/components/shell/SettingsModal";
import { Badge, Button } from "@/components/ui/primitives";
import { AnnualAlphaView } from "@/components/views/AnnualAlphaView";
import { DynamicPeriodView } from "@/components/views/DynamicPeriodView";
import { LedgerSchemaView } from "@/components/views/LedgerSchemaView";
import { LoansLeverageView } from "@/components/views/LoansLeverageView";
import { MddMatrixView } from "@/components/views/MddMatrixView";
import { OverviewView } from "@/components/views/OverviewView";
import {
  createDemoSheetsData,
  createFallbackMarketBundle,
} from "@/lib/demo/fixtures";
import { syncPrivateGoogleSheet } from "@/lib/google/sheets-client";
import { runQuantEngine } from "@/lib/quant/engine";
import { computePortfolioLeverageSummary } from "@/lib/quant/loan";
import {
  parseAssetsGrid,
  parseBenchmarksGrid,
  parseCashSnapshotsGrid,
  parseCsvToGrid,
  parseLoansGrid,
  parseTransactionsGrid,
} from "@/lib/sheets/parser";
import {
  clearAllLocalData,
  DEFAULT_LOCAL_SETTINGS,
  loadCachedSheetsData,
  loadLocalSettings,
  saveCachedSheetsData,
  saveLocalSettings,
  type LocalAppSettings,
} from "@/lib/storage/indexeddb";
import { withBasePath } from "@/lib/utils";
import type { MarketDataBundle } from "@/types/market";
import type { PortfolioScope } from "@/types/quant";
import type { CurrencyCode, PortfolioSheetsData } from "@/types/sheet";

type NavTab = "overview" | "loans" | "mdd" | "period" | "annual" | "ledger";

export default function HomePage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const [settings, setSettings] = useState<LocalAppSettings>(DEFAULT_LOCAL_SETTINGS);
  const [sheets, setSheets] = useState<PortfolioSheetsData | null>(null);
  const [market, setMarket] = useState<MarketDataBundle | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  const [activeTab, setActiveTab] = useState<NavTab>("overview");
  const [scope, setScope] = useState<PortfolioScope>("invested");
  const [currency, setCurrency] = useState<CurrencyCode>("TWD");
  const [fundingFilter, setFundingFilter] = useState<string>("ALL");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState<{ title: string; body?: string; error?: boolean } | null>(
    null
  );

  const showToast = useCallback((title: string, body?: string, error = false) => {
    setToast({ title, body, error });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  // Load public market-data.json + local IndexedDB state on mount
  useEffect(() => {
    setMounted(true);
    let cancelled = false;

    async function bootstrap() {
      const [loadedSettings, cachedSheets, fetchedMarket] = await Promise.all([
        loadLocalSettings(),
        loadCachedSheetsData(),
        fetch(withBasePath("/data/market-data.json"))
          .then((r) => (r.ok ? (r.json() as Promise<MarketDataBundle>) : null))
          .catch(() => null),
      ]);

      if (cancelled) return;

      const resolvedMarket = fetchedMarket ?? createFallbackMarketBundle();
      setMarket(resolvedMarket);
      setSettings(loadedSettings);

      if (loadedSettings.activeMode === "local" && cachedSheets) {
        setSheets(cachedSheets);
      } else if (loadedSettings.activeMode === "demo") {
        setSheets(createDemoSheetsData());
      } else {
        setSheets(null);
      }

      setIsLoading(false);
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const availableFundingTags = useMemo(() => {
    if (!sheets) return [];
    const set = new Set<string>();
    for (const tx of sheets.transactions) {
      set.add(tx.fundingTag?.trim() || "自有資金");
    }
    for (const l of sheets.loans ?? []) {
      if (l.fundingTag.trim()) set.add(l.fundingTag.trim());
    }
    return Array.from(set);
  }, [sheets]);

  const effectiveFundingFilter =
    fundingFilter === "ALL" || availableFundingTags.includes(fundingFilter)
      ? fundingFilter
      : "ALL";

  const filteredSheets = useMemo(() => {
    if (!sheets || effectiveFundingFilter === "ALL") return sheets;
    return {
      ...sheets,
      transactions: sheets.transactions.filter(
        (tx) => (tx.fundingTag?.trim() || "自有資金") === effectiveFundingFilter
      ),
      cashSnapshots: [],
    };
  }, [sheets, effectiveFundingFilter]);

  const fullEngine = useMemo(() => {
    if (!sheets || !market) return null;
    return runQuantEngine(sheets, market, settings.mddThresholds);
  }, [sheets, market, settings.mddThresholds]);

  const engine = useMemo(() => {
    if (!filteredSheets || !market) return null;
    if (effectiveFundingFilter === "ALL") return fullEngine;
    return runQuantEngine(filteredSheets, market, settings.mddThresholds);
  }, [filteredSheets, market, settings.mddThresholds, effectiveFundingFilter, fullEngine]);

  const leverageSummary = useMemo(() => {
    if (!sheets || !market || !fullEngine) return null;
    return computePortfolioLeverageSummary({ sheets, market, engine: fullEngine });
  }, [sheets, market, fullEngine]);

  const handleSaveSettings = async (next: LocalAppSettings) => {
    setSettings(next);
    await saveLocalSettings(next);
    showToast("設定已儲存", "本地偏好與風控門檻已更新至 IndexedDB");
  };

  const handleSyncGoogleSheet = async (clientId: string, spreadsheetId: string) => {
    setIsSyncing(true);
    try {
      const synced = await syncPrivateGoogleSheet({ clientId, spreadsheetId });
      const nextSettings: LocalAppSettings = {
        ...settings,
        googleClientId: clientId.trim(),
        spreadsheetId: spreadsheetId.trim(),
        activeMode: "local",
      };
      setSettings(nextSettings);
      setSheets(synced);
      await Promise.all([
        saveLocalSettings(nextSettings),
        saveCachedSheetsData(synced),
      ]);
      const loanCount = synced.loans?.length ?? 0;
      showToast(
        "Google Sheet 同步完成",
        `已讀取 ${synced.transactions.length} 筆交易、${synced.assets.length} 檔標的${
          loanCount > 0 ? `、${loanCount} 筆信貸方案` : ""
        }並更新本地快取`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "同步失敗";
      showToast("同步失敗", msg, true);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleImportCsvFile = async (
    tab: "transactions" | "assets" | "cash_snapshots" | "benchmarks" | "loans",
    file: File
  ) => {
    try {
      const text = await file.text();
      const grid = parseCsvToGrid(text);
      const baseSheets = sheets ?? createDemoSheetsData();
      let updated: PortfolioSheetsData = {
        ...baseSheets,
        source: "csv",
        syncedAt: new Date().toISOString(),
      };

      if (tab === "transactions") {
        const parsed = parseTransactionsGrid(grid);
        if (parsed.length === 0) {
          throw new Error("CSV 中找不到有效交易列（需含 date/symbol/type 欄位）");
        }
        updated = {
          ...updated,
          transactions: parsed,
          assets: parseAssetsGrid([], parsed).map((inferred) => {
            const existing = baseSheets.assets.find((a) => a.symbol === inferred.symbol);
            return existing ?? inferred;
          }),
        };
      } else if (tab === "assets") {
        updated = { ...updated, assets: parseAssetsGrid(grid, updated.transactions) };
      } else if (tab === "cash_snapshots") {
        updated = { ...updated, cashSnapshots: parseCashSnapshotsGrid(grid) };
      } else if (tab === "benchmarks") {
        updated = { ...updated, benchmarks: parseBenchmarksGrid(grid) };
      } else if (tab === "loans") {
        const parsedLoans = parseLoansGrid(grid);
        if (parsedLoans.length === 0) {
          throw new Error("CSV 中找不到有效信貸方案（需含 start_date 與 principal_twd 欄位）");
        }
        updated = { ...updated, loans: parsedLoans };
      }

      const nextSettings: LocalAppSettings = { ...settings, activeMode: "local" };
      setSettings(nextSettings);
      setSheets(updated);
      await Promise.all([
        saveLocalSettings(nextSettings),
        saveCachedSheetsData(updated),
      ]);
      showToast(`已匯入 ${tab}.csv`, "資料已寫入本機瀏覽器 IndexedDB 並完成重算");
    } catch (err) {
      showToast("CSV 匯入失敗", err instanceof Error ? err.message : "格式錯誤", true);
    }
  };

  const handleEnterDemo = async () => {
    const demoData = createDemoSheetsData();
    const nextSettings: LocalAppSettings = { ...settings, activeMode: "demo" };
    setSettings(nextSettings);
    setSheets(demoData);
    await saveLocalSettings(nextSettings);
    showToast("已切換至 Demo 模式", "採用真實 Yahoo 收盤歷史價搭配內建模擬帳本");
  };

  const handlePreviewEmptyShell = async () => {
    const nextSettings: LocalAppSettings = { ...settings, activeMode: "empty" };
    setSettings(nextSettings);
    setSheets(null);
    await saveLocalSettings(nextSettings);
  };

  const handleClearAll = async () => {
    await clearAllLocalData();
    setSettings(DEFAULT_LOCAL_SETTINGS);
    setSheets(null);
    showToast("已清除本地資料", "所有 IndexedDB 帳本快取與設定已重置");
  };

  if (isLoading || !market) {
    return (
      <div className="flex min-h-screen items-center justify-center text-xs text-[var(--muted-foreground)]">
        正在載入公開歷史行情與本地量化引擎...
      </div>
    );
  }

  if (!sheets || !engine) {
    return (
      <>
        <EmptyShellOnboarding
          settings={settings}
          isSyncing={isSyncing}
          onSyncGoogleSheet={handleSyncGoogleSheet}
          onImportTransactionsCsv={(file) => handleImportCsvFile("transactions", file)}
          onEnterDemo={handleEnterDemo}
        />
        {toast && (
          <div
            className={`fixed right-5 bottom-5 z-50 max-w-sm rounded-xl border bg-[var(--card)] px-4 py-3 text-xs shadow-lg ${
              toast.error ? "border-[var(--danger)]" : "border-[var(--primary)]"
            }`}
          >
            <div className="font-semibold">{toast.title}</div>
            {toast.body && (
              <div className="mt-0.5 text-[var(--muted-foreground)]">{toast.body}</div>
            )}
          </div>
        )}
      </>
    );
  }

  const navItems: Array<{ key: NavTab; label: string; icon: typeof LayoutDashboard }> = [
    { key: "overview", label: "總覽與水下風控", icon: LayoutDashboard },
    { key: "loans", label: "信貸槓桿與攤還", icon: Landmark },
    { key: "mdd", label: "即時 MDD 監控矩陣", icon: ShieldAlert },
    { key: "period", label: "動態區間與匯率歸因", icon: CalendarRange },
    { key: "annual", label: "歷年績效與基準 Alpha", icon: BarChart3 },
    { key: "ledger", label: "試算表資料與匯入", icon: Database },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--card)] px-4 py-3 lg:px-6">
        <div className="mx-auto flex max-w-[1656px] flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary)]/15 text-[var(--primary)]">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight">FolioLedger</span>
                <Badge
                  variant={
                    sheets.source === "google-sheets"
                      ? "success"
                      : sheets.source === "csv"
                        ? "default"
                        : "warning"
                  }
                >
                  {sheets.source === "google-sheets"
                    ? "Google Sheet"
                    : sheets.source === "csv"
                      ? "本地 CSV"
                      : "Demo 模式"}
                </Badge>
              </div>
              <p className="text-[0.75rem] text-[var(--muted-foreground)]">
                收盤行情基準：{engine.asOfDate}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Funding Tag Filter (when multiple funding sources exist) */}
            {availableFundingTags.length > 1 && (
              <select
                aria-label="資金來源篩選"
                value={effectiveFundingFilter}
                onChange={(e) => setFundingFilter(e.target.value)}
                className="min-h-8 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
              >
                <option value="ALL">全部資金來源</option>
                {availableFundingTags.map((tag) => (
                  <option key={tag} value={tag}>
                    僅看 #{tag}
                  </option>
                ))}
              </select>
            )}

            {/* Portfolio Scope Switch */}
            <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5 text-xs">
              <button
                onClick={() => setScope("invested")}
                className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                  scope === "invested"
                    ? "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                    : "text-[var(--muted-foreground)]"
                }`}
              >
                純投資部位
              </button>
              <button
                onClick={() => setScope("total")}
                className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                  scope === "total"
                    ? "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                    : "text-[var(--muted-foreground)]"
                }`}
              >
                含現金全資產
              </button>
            </div>

            {/* Currency Switch */}
            <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5 text-xs">
              {(["TWD", "USD"] as const).map((ccy) => (
                <button
                  key={ccy}
                  onClick={() => setCurrency(ccy)}
                  className={`rounded-md px-2.5 py-1 font-mono transition cursor-pointer ${
                    currency === ccy
                      ? "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                      : "text-[var(--muted-foreground)]"
                  }`}
                >
                  {ccy}
                </button>
              ))}
            </div>

            {/* Theme Toggle */}
            {mounted && (
              <Button
                variant="outline"
                size="md"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                title="切換深色 / 淺色主題"
              >
                {theme === "dark" ? (
                  <Sun className="h-3.5 w-3.5" />
                ) : (
                  <Moon className="h-3.5 w-3.5" />
                )}
              </Button>
            )}

            {/* Export Data & Diagnostics */}
            <Button variant="outline" onClick={() => setExportOpen(true)}>
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">匯出</span>
            </Button>

            {/* Settings */}
            <Button variant="outline" onClick={() => setSettingsOpen(true)}>
              <Settings className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">設定</span>
            </Button>

            {/* Sync Google Sheet */}
            <Button
              disabled={isSyncing}
              onClick={() => {
                if (!settings.googleClientId || !settings.spreadsheetId) {
                  setSettingsOpen(true);
                  return;
                }
                handleSyncGoogleSheet(settings.googleClientId, settings.spreadsheetId);
              }}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
              <span>{isSyncing ? "同步中..." : "同步試算表"}</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <div className="mx-auto flex w-full max-w-[1656px] flex-1 flex-col lg:flex-row">
        {/* Sidebar */}
        <aside className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--card)]/50 p-3 lg:w-64 lg:flex-col lg:border-r lg:border-b-0">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                className={`flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-left text-xs transition cursor-pointer ${
                  active
                    ? "bg-[var(--primary)]/15 font-semibold text-[var(--primary)]"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </button>
            );
          })}

          <div className="mt-auto hidden space-y-2 border-t border-[var(--border)] pt-4 lg:block">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">USD/TWD</span>
                <span className="font-mono font-semibold tabular-nums">
                  {engine.latestFxRate.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">行情檔數</span>
                <span className="font-mono">{Object.keys(market.tickers).length} 檔</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">本地快取</span>
                <span className="font-mono text-[var(--success)]">IndexedDB</span>
              </div>
            </div>
            <button
              onClick={handlePreviewEmptyShell}
              className="flex w-full items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer transition"
            >
              <span>返回未連線空殼頁</span>
              <span>→</span>
            </button>
          </div>
        </aside>

        {/* Active View */}
        <main className="flex-1 overflow-x-hidden p-4 lg:p-6">
          {activeTab === "overview" && filteredSheets && (
            <OverviewView
              engine={engine}
              sheets={filteredSheets}
              market={market}
              scope={scope}
              currency={currency}
              fundingFilter={effectiveFundingFilter}
              leverage={leverageSummary}
              onNavigateMdd={() => setActiveTab("mdd")}
              onNavigateLoans={() => setActiveTab("loans")}
            />
          )}
          {activeTab === "loans" && leverageSummary && (
            <LoansLeverageView
              leverage={leverageSummary}
              currency={currency}
              onNavigateLedger={() => setActiveTab("ledger")}
              onSelectFundingFilter={(tag) => {
                setFundingFilter(tag);
                setActiveTab("overview");
              }}
            />
          )}
          {activeTab === "mdd" && (
            <MddMatrixView
              rows={engine.mddMatrix}
              thresholds={settings.mddThresholds}
            />
          )}
          {activeTab === "period" && filteredSheets && (
            <DynamicPeriodView
              engine={engine}
              sheets={filteredSheets}
              market={market}
              scope={scope}
              currency={currency}
            />
          )}
          {activeTab === "annual" && (
            <AnnualAlphaView engine={engine} currency={currency} />
          )}
          {activeTab === "ledger" && (
            <LedgerSchemaView
              sheets={sheets}
              onOpenSettings={() => setSettingsOpen(true)}
              onPreviewEmptyShell={handlePreviewEmptyShell}
              onImportCsvFile={handleImportCsvFile}
            />
          )}
        </main>
      </div>

      {/* Export Modal */}
      <ExportModal
        open={exportOpen}
        sheets={sheets}
        engine={engine}
        market={market}
        settings={settings}
        scope={scope}
        onClose={() => setExportOpen(false)}
        onExported={(label) => showToast("匯出完成", `已下載 ${label}`)}
      />

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        settings={settings}
        isSyncing={isSyncing}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
        onSyncNow={handleSyncGoogleSheet}
        onClearAll={handleClearAll}
      />

      {/* Toast */}
      {toast && (
        <div
          className={`fixed right-5 bottom-5 z-50 max-w-sm rounded-xl border bg-[var(--card)] px-4 py-3 text-xs shadow-lg ${
            toast.error ? "border-[var(--danger)]" : "border-[var(--primary)]"
          }`}
        >
          <div className="font-semibold">{toast.title}</div>
          {toast.body && (
            <div className="mt-0.5 text-[var(--muted-foreground)]">{toast.body}</div>
          )}
        </div>
      )}
    </div>
  );
}
