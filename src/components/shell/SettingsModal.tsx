"use client";

import { RefreshCw, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button, Card, Input } from "@/components/ui/primitives";
import type { LocalAppSettings } from "@/lib/storage/indexeddb";

interface SettingsModalProps {
  open: boolean;
  settings: LocalAppSettings;
  isSyncing: boolean;
  onClose: () => void;
  onSave: (next: LocalAppSettings) => Promise<void>;
  onSyncNow: (clientId: string, spreadsheetId: string) => Promise<void>;
  onClearAll: () => Promise<void>;
}

export function SettingsModal({
  open,
  settings,
  isSyncing,
  onClose,
  onSave,
  onSyncNow,
  onClearAll,
}: SettingsModalProps) {
  const [clientId, setClientId] = useState(settings.googleClientId);
  const [sheetId, setSheetId] = useState(settings.spreadsheetId);
  const [mildPct, setMildPct] = useState(String(Math.round(Math.abs(settings.mddThresholds.mild) * 100)));
  const [modPct, setModPct] = useState(String(Math.round(Math.abs(settings.mddThresholds.moderate) * 100)));
  const [deepPct, setDeepPct] = useState(String(Math.round(Math.abs(settings.mddThresholds.deep) * 100)));

  if (!open) return null;

  const buildNextSettings = (): LocalAppSettings => {
    const mild = -Math.abs(Number(mildPct) || 5) / 100;
    const moderate = -Math.abs(Number(modPct) || 10) / 100;
    const deep = -Math.abs(Number(deepPct) || 15) / 100;
    return {
      ...settings,
      googleClientId: clientId.trim(),
      spreadsheetId: sheetId.trim(),
      mddThresholds: { mild, moderate, deep },
    };
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <Card className="w-full max-w-lg p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold">本地連線設定與風控門檻</h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              所有設定僅儲存在本機瀏覽器 IndexedDB
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label className="mb-1 block text-[var(--muted-foreground)]">
              Google OAuth Client ID（GCP 憑證 · Authorized JS Origin 填你的 GitHub Pages 網域）
            </label>
            <Input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="xxxxx.apps.googleusercontent.com"
              className="font-mono"
            />
          </div>

          <div>
            <label className="mb-1 block text-[var(--muted-foreground)]">
              私人 Google Sheet 連結或 ID
            </label>
            <Input
              value={sheetId}
              onChange={(e) => setSheetId(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="font-mono"
            />
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 p-3 space-y-2.5">
            <div className="font-semibold">自訂 MDD 監控矩陣警示門檻（下跌 %）</div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="mb-1 block text-[0.75rem] text-[var(--muted-foreground)]">
                  輕度回檔 (-%)
                </label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={mildPct}
                  onChange={(e) => setMildPct(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div>
                <label className="mb-1 block text-[0.75rem] text-[var(--muted-foreground)]">
                  左側分批 (-%)
                </label>
                <Input
                  type="number"
                  min={2}
                  max={60}
                  value={modPct}
                  onChange={(e) => setModPct(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div>
                <label className="mb-1 block text-[0.75rem] text-[var(--muted-foreground)]">
                  深度折價 (-%)
                </label>
                <Input
                  type="number"
                  min={5}
                  max={80}
                  value={deepPct}
                  onChange={(e) => setDeepPct(e.target.value)}
                  className="font-mono"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
          <Button
            variant="danger"
            onClick={async () => {
              await onClearAll();
              onClose();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> 清除本地資料回到空殼
          </Button>

          <div className="flex items-center gap-2">
            {clientId.trim() && sheetId.trim() && (
              <Button
                variant="outline"
                disabled={isSyncing}
                onClick={async () => {
                  await onSave(buildNextSettings());
                  await onSyncNow(clientId, sheetId);
                  onClose();
                }}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                儲存並同步
              </Button>
            )}
            <Button
              onClick={async () => {
                await onSave(buildNextSettings());
                onClose();
              }}
            >
              儲存設定
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
