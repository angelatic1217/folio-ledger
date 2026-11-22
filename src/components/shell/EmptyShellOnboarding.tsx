"use client";

import { Database, FileSpreadsheet, Play, ShieldCheck, Upload } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, Input } from "@/components/ui/primitives";
import type { LocalAppSettings } from "@/lib/storage/indexeddb";

interface EmptyShellOnboardingProps {
  settings: LocalAppSettings;
  isSyncing: boolean;
  onSyncGoogleSheet: (clientId: string, spreadsheetId: string) => Promise<void>;
  onImportTransactionsCsv: (file: File) => void;
  onEnterDemo: () => void;
}

export function EmptyShellOnboarding({
  settings,
  isSyncing,
  onSyncGoogleSheet,
  onImportTransactionsCsv,
  onEnterDemo,
}: EmptyShellOnboardingProps) {
  const [clientId, setClientId] = useState(settings.googleClientId);
  const [sheetId, setSheetId] = useState(settings.spreadsheetId);

  return (
    <div className="flex min-h-screen items-center justify-center p-4 lg:p-8">
      <Card className="w-full max-w-2xl p-6 lg:p-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary)]/15 text-[var(--primary)]">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">FolioLedger</h1>
              <p className="text-xs text-[var(--muted-foreground)]">
                個人量化投資組合與水下風控系統 · Local-First 靜態空殼
              </p>
            </div>
          </div>
          <Badge variant="warning">未連線空殼狀態</Badge>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/50 p-4 text-xs leading-relaxed text-[var(--muted-foreground)] space-y-1.5">
          <p className="font-semibold text-[var(--foreground)]">
            零後端零隱私外洩架構（GitHub Pages 靜態託管）
          </p>
          <p>
            公開網站僅包含程式碼與公開 ETF 歷史收盤價；你的試算表 ID、交易紀錄與資產淨值只會保存在本機瀏覽器的{" "}
            <code className="font-mono text-[var(--foreground)]">IndexedDB</code>，不會傳送給任何伺服器。
          </p>
        </div>

        {/* Option 1: Private Google Sheet via GIS OAuth */}
        <div className="space-y-3 rounded-xl border border-[var(--border)] p-4">
          <div className="flex items-center gap-2 text-xs font-bold">
            <FileSpreadsheet className="h-4 w-4 text-[var(--primary)]" />
            方式一：直連你的非公開 Google Sheet（Google OAuth 唯讀授權）
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                Google OAuth Client ID
              </label>
              <Input
                placeholder="xxxxx.apps.googleusercontent.com"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="font-mono"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                私人 Google Sheet 連結或 ID
              </label>
              <Input
                placeholder="貼上試算表網址或 ID"
                value={sheetId}
                onChange={(e) => setSheetId(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-[var(--muted-foreground)]">
              同步後會自動寫入瀏覽器快取，下次打開免重登即可直接回顧
            </span>
            <Button
              disabled={isSyncing || !clientId.trim() || !sheetId.trim()}
              onClick={() => onSyncGoogleSheet(clientId, sheetId)}
            >
              {isSyncing ? "授權同步中..." : "以 Google 帳號授權並同步"}
            </Button>
          </div>
        </div>

        {/* Option 2 & 3: Local CSV or Demo */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col justify-between gap-3 rounded-xl border border-[var(--border)] p-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold">
                <Upload className="h-4 w-4 text-[var(--success)]" />
                方式二：直接匯入本地 CSV
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                免設 GCP OAuth！將試算表『交易紀錄』另存為 CSV 匯入，直接搭配真實 Yahoo 歷史行情計算。
              </p>
            </div>
            <label className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-xs font-medium hover:bg-[var(--muted)]">
              <Database className="h-3.5 w-3.5" /> 選擇 transactions.csv 匯入
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onImportTransactionsCsv(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>

          <div className="flex flex-col justify-between gap-3 rounded-xl border border-[var(--primary)]/40 bg-[var(--primary)]/5 p-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-[var(--primary)]">
                <Play className="h-4 w-4" />
                方式三：立即體驗 Demo（真實歷史行情）
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                載入模擬交易帳本（含 0050 拆股前紀錄、美股 DRIP）並套用真實 Yahoo 收盤歷史價執行完整量化運算。
              </p>
            </div>
            <Button onClick={onEnterDemo} className="w-full">
              進入 Demo 儀表板
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
