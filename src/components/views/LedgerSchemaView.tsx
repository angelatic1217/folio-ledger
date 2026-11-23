"use client";

import { Download, FileSpreadsheet, Settings, Shield, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, Card, Input } from "@/components/ui/primitives";
import { buildSheetTabCsv, triggerFileDownload } from "@/lib/export/exporter";
import type { PortfolioSheetsData } from "@/types/sheet";

type SheetTabKey = "transactions" | "assets" | "cash_snapshots" | "benchmarks" | "loans";

interface LedgerSchemaViewProps {
  sheets: PortfolioSheetsData;
  onOpenSettings: () => void;
  onPreviewEmptyShell: () => void;
  onImportCsvFile: (tab: SheetTabKey, file: File) => void;
}

const SAMPLE_CSV: Record<SheetTabKey, string> = {
  transactions:
    "date,symbol,type,shares,price,fee,fx_rate,funding_tag,note\n2025-01-15,0050,BUY,1000,195.0,20,,自有資金,定期投入\n2025-07-01,VT,BUY,120,128.5,0,32.1,2025信貸,信貸建倉\n",
  assets:
    "symbol,name,market,currency,yahoo_ticker,monitor_mdd\n0050,元大台灣50,TW,TWD,0050.TW,TRUE\nVOO,Vanguard S&P 500,US,USD,VOO,TRUE\n",
  cash_snapshots:
    "date,currency,balance,note\n2025-12-31,TWD,500000,年底帳戶現金\n",
  benchmarks:
    "symbol,name,yahoo_ticker,currency,scope\n0050,元大台灣50,0050.TW,TWD,TW\nVOO,標普500,VOO,USD,US\nVT,全球股票,VT,USD,ALL\n",
  loans:
    "id,name,funding_tag,start_date,principal_twd,disbursed_twd,wire_fee_twd,received_usd,apr,term_months,monthly_payment_twd,total_interest_twd,status,closed_date,payoff_twd,refinanced_payoff_twd,note\nloan-2025,2025 首期信貸,2025信貸,2025-07-01,1000000,995000,400,31000,0.025,84,12989,,refinanced,2026-10-01,835000,,已借新還舊結清\nloan-2026,2026 轉增貸,2026增貸,2026-10-01,1500000,663000,400,20400,0.029,84,19758,,active,,,835000,借新還舊方案\n",
};

export function LedgerSchemaView({
  sheets,
  onOpenSettings,
  onPreviewEmptyShell,
  onImportCsvFile,
}: LedgerSchemaViewProps) {
  const [activeTab, setActiveTab] = useState<SheetTabKey>("transactions");
  const [search, setSearch] = useState("");

  const downloadTemplate = (tab: SheetTabKey) => {
    const blob = new Blob(["\uFEFF" + SAMPLE_CSV[tab]], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tab}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tableView = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (cells: string[]) =>
      !q || cells.some((c) => c.toLowerCase().includes(q));

    if (activeTab === "transactions") {
      const rows = [...sheets.transactions]
        .reverse()
        .map((t) => [
          t.date,
          t.symbol,
          t.type,
          String(t.shares),
          String(t.price),
          String(t.fee),
          t.fxRate ? String(t.fxRate) : "自動歷史匯率",
          t.fundingTag ?? "自有資金",
          t.note ?? "—",
        ])
        .filter(match);
      return {
        headers: [
          "date",
          "symbol",
          "type",
          "shares",
          "price",
          "fee",
          "fx_rate",
          "funding_tag",
          "note",
        ],
        rows,
      };
    }

    if (activeTab === "assets") {
      const rows = sheets.assets
        .map((a) => [
          a.symbol,
          a.name,
          a.market,
          a.currency,
          a.yahooTicker,
          a.monitorMdd ? "TRUE" : "FALSE",
        ])
        .filter(match);
      return {
        headers: ["symbol", "name", "market", "currency", "yahoo_ticker", "monitor_mdd"],
        rows,
      };
    }

    if (activeTab === "cash_snapshots") {
      const rows = [...sheets.cashSnapshots]
        .reverse()
        .map((c) => [c.date, c.currency, c.balance.toLocaleString("en-US"), c.note ?? "—"])
        .filter(match);
      return {
        headers: ["date", "currency", "balance", "note"],
        rows,
      };
    }

    if (activeTab === "loans") {
      const rows = (sheets.loans ?? [])
        .map((l) => [
          l.id,
          l.name,
          l.fundingTag,
          l.status ?? "active",
          l.startDate,
          l.closedDate ?? "—",
          l.principalTwd.toLocaleString("en-US"),
          l.disbursedTwd.toLocaleString("en-US"),
          l.payoffTwd
            ? `結清 ${l.payoffTwd.toLocaleString("en-US")}`
            : l.refinancedPayoffTwd
              ? `代償 ${l.refinancedPayoffTwd.toLocaleString("en-US")}`
              : "—",
          `${(l.apr * 100).toFixed(2)}%`,
          String(l.termMonths),
          l.monthlyPaymentTwd ? l.monthlyPaymentTwd.toLocaleString("en-US") : "自動PMT",
        ])
        .filter(match);
      return {
        headers: [
          "id",
          "name",
          "funding_tag",
          "status",
          "start_date",
          "closed_date",
          "principal_twd",
          "disbursed_twd",
          "payoff / refi",
          "apr",
          "term",
          "monthly_payment",
        ],
        rows,
      };
    }

    const rows = sheets.benchmarks
      .map((b) => [b.symbol, b.name, b.yahooTicker, b.currency, b.scope])
      .filter(match);
    return {
      headers: ["symbol", "name", "yahoo_ticker", "currency", "scope"],
      rows,
    };
  }, [activeTab, search, sheets]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold">標準 5 表試算表資料與本地快取</h2>
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
                ? "Google Sheets 已同步"
                : sheets.source === "csv"
                  ? "本地 CSV 匯入"
                  : "內建 Demo 模式"}
            </Badge>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            資料僅保留於你本機瀏覽器 IndexedDB，不會上傳至任何伺服器
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={onOpenSettings}>
            <Settings className="h-3.5 w-3.5" /> 憑證與門檻設定
          </Button>
          <Button variant="outline" onClick={onPreviewEmptyShell}>
            <Shield className="h-3.5 w-3.5" /> 檢視空殼引導頁
          </Button>
        </div>
      </div>

      {/* Sub-tabs + Search + CSV Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 text-xs">
          {(
            [
              { key: "transactions", label: `transactions (${sheets.transactions.length})` },
              { key: "assets", label: `assets (${sheets.assets.length})` },
              { key: "cash_snapshots", label: `cash_snapshots (${sheets.cashSnapshots.length})` },
              { key: "benchmarks", label: `benchmarks (${sheets.benchmarks.length})` },
              { key: "loans", label: `loans (${(sheets.loans ?? []).length})` },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`rounded-md px-3 py-1 font-mono transition cursor-pointer ${
                activeTab === t.key
                  ? "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="搜尋代號、類別或備註..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48"
          />
          <Button
            variant="outline"
            onClick={() =>
              triggerFileDownload(
                `${activeTab}-exported.csv`,
                buildSheetTabCsv(sheets, activeTab),
                "text/csv;charset=utf-8"
              )
            }
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> 匯出此分頁 CSV
          </Button>
          <Button variant="outline" onClick={() => downloadTemplate(activeTab)}>
            <Download className="h-3.5 w-3.5" /> 空白範本
          </Button>
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3.5 py-1.5 text-xs font-medium text-[var(--primary-foreground)] hover:opacity-90">
            <Upload className="h-3.5 w-3.5" /> 匯入本地 CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImportCsvFile(activeTab, file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]/60 text-[var(--muted-foreground)]">
                {tableView.headers.map((h) => (
                  <th key={h} className="px-4 py-2.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {tableView.rows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-[var(--muted)]/40">
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className={`px-4 py-2.5 ${cIdx === 0 ? "font-semibold" : ""}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
              {tableView.rows.length === 0 && (
                <tr>
                  <td
                    colSpan={tableView.headers.length}
                    className="py-8 text-center font-sans text-[var(--muted-foreground)]"
                  >
                    目前此分頁無符合資料
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
