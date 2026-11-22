"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson,
  FileSpreadsheet,
  ShieldCheck,
  X,
} from "lucide-react";
import { useMemo } from "react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import {
  buildAnnualPerformanceCsv,
  buildAnonymizedDiagnosticJson,
  buildDailySeriesCsv,
  buildFullExportJson,
  buildMddMatrixCsv,
  buildSheetTabCsv,
  runDataHealthCheck,
  triggerFileDownload,
} from "@/lib/export/exporter";
import type { LocalAppSettings } from "@/lib/storage/indexeddb";
import type { MarketDataBundle } from "@/types/market";
import type { PortfolioScope, QuantEngineOutput } from "@/types/quant";
import type { PortfolioSheetsData } from "@/types/sheet";

interface ExportModalProps {
  open: boolean;
  sheets: PortfolioSheetsData;
  engine: QuantEngineOutput;
  market: MarketDataBundle;
  settings: LocalAppSettings;
  scope: PortfolioScope;
  onClose: () => void;
  onExported: (label: string) => void;
}

export function ExportModal({
  open,
  sheets,
  engine,
  market,
  settings,
  scope,
  onClose,
  onExported,
}: ExportModalProps) {
  const health = useMemo(
    () => runDataHealthCheck(sheets, market),
    [sheets, market]
  );

  if (!open) return null;

  const stamp = engine.asOfDate || new Date().toISOString().slice(0, 10);
  const hasWarnings =
    health.missingMarketSymbols.length > 0 ||
    health.zeroPriceTransactions > 0 ||
    health.preMarketTransactions.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <Card className="w-full max-w-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold">匯出資料與運算診斷報告</h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              所有匯出皆於本機瀏覽器直接產生檔案下載，不經過任何外部伺服器
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Instant Data Health Check */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 p-3.5 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold flex items-center gap-1.5">
              {hasWarnings ? (
                <AlertTriangle className="h-4 w-4 text-[var(--warning)]" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
              )}
              資料健檢摘要（{health.totalTransactions} 筆交易 · {health.dateRange.first ?? "—"} ~ {health.dateRange.last ?? "—"}）
            </span>
            <Badge variant={hasWarnings ? "warning" : "success"}>
              {hasWarnings ? "發現需要注意項目" : "資料對齊正常"}
            </Badge>
          </div>

          {health.missingMarketSymbols.length > 0 && (
            <div className="rounded-lg bg-[var(--danger)]/10 px-2.5 py-1.5 text-[var(--danger)]">
              <strong>缺少歷史行情的代碼：</strong>{" "}
              <span className="font-mono">{health.missingMarketSymbols.join(", ")}</span>
              （需加入 <code className="font-mono">config/tickers.json</code> 並執行行情排程）
            </div>
          )}

          {health.preMarketTransactions.length > 0 && (
            <div className="rounded-lg bg-[var(--warning)]/15 px-2.5 py-1.5 text-[var(--warning)]">
              有 {health.preMarketTransactions.length} 筆交易日期早於目前歷史行情起始日（最早行情{" "}
              {health.preMarketTransactions[0].firstBarDate}）
            </div>
          )}

          {health.zeroPriceTransactions > 0 && (
            <div className="rounded-lg bg-[var(--warning)]/15 px-2.5 py-1.5 text-[var(--warning)]">
              偵測到 {health.zeroPriceTransactions} 筆非 DRIP 交易的成交單價為 0，請確認欄位格式
            </div>
          )}

          {health.detectedSplits.length > 0 && (
            <div className="text-[var(--muted-foreground)]">
              已自動套用歷史拆股事件：
              <span className="font-mono text-[var(--foreground)] ml-1">
                {health.detectedSplits
                  .map((s) => `${s.symbol} (${s.date}, 1:${s.ratio})`)
                  .join(" / ")}
              </span>
            </div>
          )}
        </div>

        {/* JSON Diagnostics & Backup */}
        <div className="space-y-2.5">
          <div className="text-xs font-semibold text-[var(--muted-foreground)]">
            JSON 完整備份與除錯診斷（推薦交給 AI 檢視計算細節用）
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col justify-between gap-3 rounded-xl border border-[var(--primary)]/40 bg-[var(--primary)]/5 p-3.5">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--primary)]">
                  <ShieldCheck className="h-4 w-4" />
                  脫敏診斷報告 (.json)
                </div>
                <p className="text-xs text-[var(--muted-foreground)]">
                  將金額與股數等比例縮放至 NT$100 萬，<strong>不暴露真實資產</strong>，完整保留 TWR、Modified Dietz、MDD、權重、拆股與每日序列供抓蟲對帳。
                </p>
              </div>
              <Button
                onClick={() => {
                  const content = buildAnonymizedDiagnosticJson({
                    sheets,
                    engine,
                    market,
                    settings,
                  });
                  triggerFileDownload(
                    `folio-ledger-diagnostic-anonymized-${stamp}.json`,
                    content,
                    "application/json;charset=utf-8"
                  );
                  onExported("脫敏診斷報告 (.json)");
                }}
              >
                <Download className="h-3.5 w-3.5" /> 下載脫敏診斷 JSON
              </Button>
            </div>

            <div className="flex flex-col justify-between gap-3 rounded-xl border border-[var(--border)] p-3.5">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-bold">
                  <FileJson className="h-4 w-4 text-[var(--success)]" />
                  完整備份 + 運算結果 (.json)
                </div>
                <p className="text-xs text-[var(--muted-foreground)]">
                  包含原始未縮放的 4 張試算表資料、全部每日淨值/TWR/水下序列、MDD 矩陣與歷年 Alpha，適合本機完整備份。
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  const content = buildFullExportJson({
                    sheets,
                    engine,
                    market,
                    settings,
                  });
                  triggerFileDownload(
                    `folio-ledger-full-export-${stamp}.json`,
                    content,
                    "application/json;charset=utf-8"
                  );
                  onExported("完整備份與運算結果 (.json)");
                }}
              >
                <Download className="h-3.5 w-3.5" /> 下載完整 JSON
              </Button>
            </div>
          </div>
        </div>

        {/* CSV Analytical Exports */}
        <div className="space-y-2.5">
          <div className="text-xs font-semibold text-[var(--muted-foreground)]">
            CSV 報表匯出（可直接用 Excel / Google Sheets 逐筆驗算）
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => {
                triggerFileDownload(
                  `daily-portfolio-series-${scope}-${stamp}.csv`,
                  buildDailySeriesCsv(engine, scope),
                  "text/csv;charset=utf-8"
                );
                onExported("每日淨值與水下序列 (.csv)");
              }}
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-[var(--primary)]" />
              每日淨值 & 水下序列
            </Button>

            <Button
              variant="outline"
              className="justify-start"
              onClick={() => {
                triggerFileDownload(
                  `mdd-matrix-${stamp}.csv`,
                  buildMddMatrixCsv(engine),
                  "text/csv;charset=utf-8"
                );
                onExported("個別標的 MDD 矩陣 (.csv)");
              }}
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-[var(--danger)]" />
              MDD 監控矩陣
            </Button>

            <Button
              variant="outline"
              className="justify-start"
              onClick={() => {
                triggerFileDownload(
                  `annual-performance-${stamp}.csv`,
                  buildAnnualPerformanceCsv(engine),
                  "text/csv;charset=utf-8"
                );
                onExported("歷年績效與 Alpha (.csv)");
              }}
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-[var(--success)]" />
              歷年績效 & Alpha
            </Button>
          </div>
        </div>

        {/* Raw 4 Tables CSV Export */}
        <div className="space-y-2 border-t border-[var(--border)] pt-3">
          <div className="text-xs font-semibold text-[var(--muted-foreground)]">
            匯出目前同步的原始試算表分頁 (.csv)
          </div>
          <div className="flex flex-wrap gap-2">
            {(["transactions", "assets", "cash_snapshots", "benchmarks"] as const).map(
              (tab) => (
                <Button
                  key={tab}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    triggerFileDownload(
                      `${tab}-${stamp}.csv`,
                      buildSheetTabCsv(sheets, tab),
                      "text/csv;charset=utf-8"
                    );
                    onExported(`${tab}.csv`);
                  }}
                >
                  <Download className="h-3 w-3" /> {tab}.csv
                </Button>
              )
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
