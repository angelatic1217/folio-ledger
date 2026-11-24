"use client";

import { ChevronRight, ShieldAlert, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Card } from "@/components/ui/primitives";
import { AssetDetailView } from "@/components/views/assets/AssetDetailView";
import { AssetReturnsTab } from "@/components/views/assets/AssetReturnsTab";
import { applyMddLookback } from "@/lib/quant/drawdown";
import { formatPercent, formatPrice } from "@/lib/utils";
import type { MarketDataBundle } from "@/types/market";
import type {
  MddLookbackPreset,
  MddMatrixRow,
  MddSignalLevel,
  MddThresholds,
  SymbolPerformanceRow,
} from "@/types/quant";
import type { Asset, CurrencyCode, Transaction } from "@/types/sheet";

type AssetMonitorSubTab = "mdd" | "returns";
type MarketFilter = "ALL" | "HELD" | "TW" | "US" | "WATCH";

interface MddMatrixViewProps {
  rows: MddMatrixRow[];
  performanceRows: SymbolPerformanceRow[];
  transactions: Transaction[];
  assets: Asset[];
  market: MarketDataBundle;
  asOfDate: string;
  latestFxRate: number;
  currency: CurrencyCode;
  fundingFilter?: string;
  thresholds: MddThresholds;
}

const SUB_TABS: Array<{
  key: AssetMonitorSubTab;
  label: string;
  icon: typeof ShieldAlert;
}> = [
  { key: "returns", label: "報酬與成本觀察", icon: TrendingUp },
  { key: "mdd", label: "MDD 水下風控", icon: ShieldAlert },
];

const LOOKBACK_OPTIONS: Array<{ key: MddLookbackPreset; label: string }> = [
  { key: "5Y", label: "近 5 年" },
  { key: "10Y", label: "近 10 年" },
  { key: "MAX", label: "上市以來 (MAX)" },
];

const SIGNAL_META: Record<
  MddSignalLevel,
  { label: string; variant: "success" | "default" | "warning" | "danger"; bar: string }
> = {
  "near-high": { label: "接近新高", variant: "success", bar: "var(--success)" },
  mild: { label: "輕度回檔", variant: "default", bar: "var(--primary)" },
  moderate: { label: "左側分批區", variant: "warning", bar: "var(--warning)" },
  deep: { label: "深度折價區", variant: "danger", bar: "var(--danger)" },
};

export function MddMatrixView({
  rows,
  performanceRows,
  transactions,
  assets,
  market,
  asOfDate,
  latestFxRate,
  currency,
  fundingFilter = "ALL",
  thresholds,
}: MddMatrixViewProps) {
  const [activeSubTab, setActiveSubTab] =
    useState<AssetMonitorSubTab>("returns");
  const [lookback, setLookback] = useState<MddLookbackPreset>("MAX");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("HELD");
  const [sortBy, setSortBy] = useState<"dd-asc" | "ratio-desc" | "weight-desc">(
    "dd-asc"
  );
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);
  const [detailOriginTab, setDetailOriginTab] =
    useState<AssetMonitorSubTab>("returns");

  const scopedRows = useMemo(
    () => applyMddLookback(rows, lookback, thresholds),
    [rows, lookback, thresholds]
  );

  const filteredMddRows = useMemo(() => {
    const list = scopedRows.filter((r) => {
      if (marketFilter === "HELD") return r.held;
      if (marketFilter === "TW") return r.market === "TW";
      if (marketFilter === "US") return r.market === "US";
      if (marketFilter === "WATCH") return !r.held;
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === "dd-asc") return a.currentDrawdown - b.currentDrawdown;
      if (sortBy === "ratio-desc") return b.mddRatioPct - a.mddRatioPct;
      return b.weightPct - a.weightPct;
    });
  }, [scopedRows, marketFilter, sortBy]);

  const allSymbols = useMemo(
    () =>
      performanceRows.map((r) => ({
        symbol: r.symbol,
        name: r.name,
        status: r.status,
      })),
    [performanceRows]
  );

  const detailPerfRow = useMemo(
    () =>
      detailSymbol
        ? performanceRows.find((r) => r.symbol === detailSymbol) ?? null
        : null,
    [detailSymbol, performanceRows]
  );

  const detailMddRow = useMemo(
    () =>
      detailSymbol
        ? scopedRows.find((r) => r.symbol === detailSymbol) ?? null
        : null,
    [detailSymbol, scopedRows]
  );

  const handleOpenDetail = (symbol: string, origin: AssetMonitorSubTab) => {
    setDetailOriginTab(origin);
    setDetailSymbol(symbol);
  };

  if (detailPerfRow) {
    return (
      <AssetDetailView
        performanceRow={detailPerfRow}
        mddRow={detailMddRow}
        allSymbols={allSymbols}
        transactions={transactions}
        market={market}
        latestFxRate={latestFxRate}
        currency={currency}
        lookback={lookback}
        onLookbackChange={setLookback}
        initialChartMode={
          detailOriginTab === "mdd" && detailMddRow
            ? "underwater"
            : detailPerfRow.wealthSeries.length > 0
              ? "wealth"
              : "compounding"
        }
        returnTabLabel={
          detailOriginTab === "mdd" ? " MDD 水下風控" : "報酬與成本觀察"
        }
        onBack={() => setDetailSymbol(null)}
        onSelectSymbol={(sym) => setDetailSymbol(sym)}
      />
    );
  }

  const lookbackLabel =
    LOOKBACK_OPTIONS.find((o) => o.key === lookback)?.label ?? "上市以來";

  const heldCount = performanceRows.filter((r) => r.held).length;
  const totalTracked = Math.max(rows.length, performanceRows.length);

  return (
    <div className="space-y-5">
      {/* Shared Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold">個別標的監控</h2>
            <Badge variant="default">
              {heldCount} 檔持有 · 共 {totalTracked} 檔追蹤
            </Badge>
            {fundingFilter !== "ALL" && (
              <Badge variant="outline">資金篩選：#{fundingFilter}</Badge>
            )}
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            {activeSubTab === "mdd"
              ? `以標的含息還原價（Adj Close）計算歷史 MDD 與當前水下深度；門檻：輕度 ${(thresholds.mild * 100).toFixed(0)}% / 左側分批 ${(thresholds.moderate * 100).toFixed(0)}% / 深度折價 ${(thresholds.deep * 100).toFixed(0)}%`
              : `長期指數持有視角：追蹤拆股還原均價、含息損益兩平價、未實現/含息總損益、資金加權 XIRR 與長期配置品質 · 基準日 ${asOfDate}`}
          </p>
        </div>
      </div>

      {/* Sub-Tab Bar (matches LoansLeverageView pattern) */}
      <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-1 text-xs">
        {SUB_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeSubTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveSubTab(tab.key)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 transition cursor-pointer ${
                active
                  ? "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)] shadow-xs"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeSubTab === "returns" ? (
        <AssetReturnsTab
          rows={performanceRows}
          transactions={transactions}
          assets={assets}
          market={market}
          asOfDate={asOfDate}
          latestFxRate={latestFxRate}
          currency={currency}
          lookback={lookback}
          onLookbackChange={setLookback}
          marketFilter={marketFilter}
          onMarketFilterChange={setMarketFilter}
          onOpenDetail={(sym) => handleOpenDetail(sym, "returns")}
        />
      ) : (
        <div className="space-y-5">
          {/* MDD Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)] p-1">
              {LOOKBACK_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setLookback(opt.key)}
                  className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                    lookback === opt.key
                      ? "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={marketFilter}
                onChange={(e) =>
                  setMarketFilter(e.target.value as MarketFilter)
                }
                className="min-h-9 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs text-[var(--foreground)] cursor-pointer"
              >
                <option value="ALL">全部標的</option>
                <option value="HELD">僅看目前持有</option>
                <option value="TW">僅看台股 (TW)</option>
                <option value="US">僅看美股 (US)</option>
                <option value="WATCH">僅看觀察 / 已清倉</option>
              </select>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="min-h-9 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs text-[var(--foreground)] cursor-pointer"
              >
                <option value="dd-asc">排序：當前水下最深優先</option>
                <option value="ratio-desc">排序：佔歷史 MDD 水位</option>
                <option value="weight-desc">排序：個人持倉權重由高到低</option>
              </select>
            </div>
          </div>

          {/* Monitoring Matrix Table */}
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--muted)]/60 text-[var(--muted-foreground)]">
                    <th className="px-4 py-3 font-semibold">標的 / 狀態</th>
                    <th className="px-3 py-3 text-right font-semibold">
                      最新收盤價
                    </th>
                    <th className="px-3 py-3 text-right font-semibold">
                      歷史含息高點
                    </th>
                    <th className="px-3 py-3 text-right font-semibold">
                      當前水下深度
                    </th>
                    <th className="px-3 py-3 text-right font-semibold">
                      歷史 MDD ({lookbackLabel})
                    </th>
                    <th className="min-w-[210px] px-4 py-3 font-semibold">
                      水下水位（vs 歷史 MDD）
                    </th>
                    <th className="px-3 py-3 text-right font-semibold">
                      水下天數
                    </th>
                    <th className="px-3 py-3 text-right font-semibold">
                      權重 / 未實現
                    </th>
                    <th className="px-4 py-3 text-center font-semibold">
                      風控訊號
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filteredMddRows.map((row) => {
                    const sig = SIGNAL_META[row.signal];
                    return (
                      <tr
                        key={row.symbol}
                        onClick={() => handleOpenDetail(row.symbol, "mdd")}
                        title={`點擊檢視 ${row.symbol} 水下軌跡與交易紀錄`}
                        className="group cursor-pointer transition hover:bg-[var(--muted)]/50"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold group-hover:text-[var(--primary)] transition-colors">
                              {row.symbol}
                            </span>
                            <Badge variant="outline">{row.market}</Badge>
                            {!row.held && <Badge variant="warning">觀察中</Badge>}
                            <ChevronRight className="h-3.5 w-3.5 text-[var(--muted-foreground)] opacity-0 transition group-hover:opacity-100" />
                          </div>
                          <div className="mt-0.5 text-[var(--muted-foreground)]">
                            {row.name}
                            <span className="ml-1.5 font-mono text-[0.75rem] opacity-75">
                              (起自 {row.firstDate.slice(0, 7)})
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums">
                          <div>{formatPrice(row.latestPrice, row.currency)}</div>
                          <div className="text-[0.75rem] text-[var(--muted-foreground)]">
                            {row.latestDate}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums text-[var(--muted-foreground)]">
                          <div>
                            {formatPrice(row.peakAdjPrice, row.currency)}
                          </div>
                          <div className="text-[0.75rem]">{row.peakDate}</div>
                        </td>
                        <td
                          className="px-3 py-3 text-right font-mono font-bold tabular-nums"
                          style={{ color: sig.bar }}
                        >
                          {formatPercent(row.currentDrawdown)}
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums text-[var(--muted-foreground)]">
                          <div>{formatPercent(row.historicalMdd)}</div>
                          <div className="text-[0.75rem]">{row.mddDate}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="mb-1 flex justify-between text-[0.75rem] text-[var(--muted-foreground)]">
                            <span>佔歷史 MDD</span>
                            <span className="font-mono font-semibold text-[var(--foreground)]">
                              {row.mddRatioPct}%
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-[var(--muted)]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(100, row.mddRatioPct)}%`,
                                backgroundColor: sig.bar,
                              }}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums">
                          {row.daysUnderwater} 天
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums">
                          {row.held ? (
                            <>
                              <div>{row.weightPct.toFixed(1)}%</div>
                              <div
                                style={{
                                  color:
                                    (row.unrealizedPnlPct ?? 0) >= 0
                                      ? "var(--success)"
                                      : "var(--danger)",
                                }}
                              >
                                {formatPercent(row.unrealizedPnlPct, {
                                  signed: true,
                                })}
                              </div>
                            </>
                          ) : (
                            <span className="text-[var(--muted-foreground)]">
                              未持有
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant={sig.variant}>{sig.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredMddRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={9}
                        className="py-8 text-center text-[var(--muted-foreground)]"
                      >
                        無符合篩選條件的監控標的
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {filteredMddRows.length > 0 && (
              <div className="border-t border-[var(--border)] bg-[var(--muted)]/20 px-4 py-2 text-[0.72rem] text-[var(--muted-foreground)]">
                提示：點擊任一標的列即可開啟該標的專屬詳情頁（含水下軌跡、長期走勢與完整交易紀錄）。
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
