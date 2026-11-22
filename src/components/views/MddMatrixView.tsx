"use client";

import { useMemo, useState } from "react";
import { SymbolUnderwaterChart } from "@/components/charts/SymbolUnderwaterChart";
import { Badge, Card } from "@/components/ui/primitives";
import { applyMddLookback } from "@/lib/quant/drawdown";
import { formatPercent, formatPrice } from "@/lib/utils";
import type {
  MddLookbackPreset,
  MddMatrixRow,
  MddSignalLevel,
  MddThresholds,
} from "@/types/quant";

interface MddMatrixViewProps {
  rows: MddMatrixRow[];
  thresholds: MddThresholds;
}

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

export function MddMatrixView({ rows, thresholds }: MddMatrixViewProps) {
  const [lookback, setLookback] = useState<MddLookbackPreset>("MAX");
  const [marketFilter, setMarketFilter] = useState<
    "ALL" | "HELD" | "TW" | "US" | "WATCH"
  >("ALL");
  const [sortBy, setSortBy] = useState<"dd-asc" | "ratio-desc" | "weight-desc">("dd-asc");
  const [selectedSymbol, setSelectedSymbol] = useState<string>(rows[0]?.symbol ?? "");

  const scopedRows = useMemo(
    () => applyMddLookback(rows, lookback, thresholds),
    [rows, lookback, thresholds]
  );

  const filteredRows = useMemo(() => {
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

  const activeRow =
    filteredRows.find((r) => r.symbol === selectedSymbol) ??
    filteredRows[0] ??
    null;

  const lookbackLabel =
    LOOKBACK_OPTIONS.find((o) => o.key === lookback)?.label ?? "上市以來";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">個別標的即時 MDD 監控矩陣</h2>
          <p className="text-xs text-[var(--muted-foreground)]">
            以標的自身含息還原價（Adj Close）計算歷史 MDD 與當前水下深度；門檻：輕度{" "}
            {(thresholds.mild * 100).toFixed(0)}% / 左側分批{" "}
            {(thresholds.moderate * 100).toFixed(0)}% / 深度折價{" "}
            {(thresholds.deep * 100).toFixed(0)}%
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
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

          <select
            value={marketFilter}
            onChange={(e) => setMarketFilter(e.target.value as typeof marketFilter)}
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
                <th className="px-3 py-3 text-right font-semibold">最新收盤價</th>
                <th className="px-3 py-3 text-right font-semibold">歷史含息高點</th>
                <th className="px-3 py-3 text-right font-semibold">當前水下深度</th>
                <th className="px-3 py-3 text-right font-semibold">
                  歷史 MDD ({lookbackLabel})
                </th>
                <th className="min-w-[210px] px-4 py-3 font-semibold">
                  水下水位（vs 歷史 MDD）
                </th>
                <th className="px-3 py-3 text-right font-semibold">水下天數</th>
                <th className="px-3 py-3 text-right font-semibold">權重 / 未實現</th>
                <th className="px-4 py-3 text-center font-semibold">風控訊號</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filteredRows.map((row) => {
                const sig = SIGNAL_META[row.signal];
                const isSelected = activeRow?.symbol === row.symbol;
                return (
                  <tr
                    key={row.symbol}
                    onClick={() => setSelectedSymbol(row.symbol)}
                    className={`cursor-pointer transition hover:bg-[var(--muted)]/50 ${
                      isSelected ? "bg-[var(--primary)]/10" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold">{row.symbol}</span>
                        <Badge variant="outline">{row.market}</Badge>
                        {!row.held && <Badge variant="warning">觀察中</Badge>}
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
                      <div>{formatPrice(row.peakAdjPrice, row.currency)}</div>
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
                            {formatPercent(row.unrealizedPnlPct, { signed: true })}
                          </div>
                        </>
                      ) : (
                        <span className="text-[var(--muted-foreground)]">未持有</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={sig.variant}>{sig.label}</Badge>
                    </td>
                  </tr>
                );
              })}
              {filteredRows.length === 0 && (
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
      </Card>

      {/* Selected Symbol Drill-Down */}
      {activeRow && (
        <Card className="p-4 lg:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold">
                  {activeRow.symbol} — {activeRow.name} 含息還原水下軌跡
                </h3>
                <Badge>{activeRow.yahooTicker}</Badge>
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                點擊上方矩陣任一標的即時切換；曲線反映含息還原價（Adj Close）歷史回撤深度
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4 font-mono text-xs tabular-nums">
              <span>
                最新價：<strong>{formatPrice(activeRow.latestPrice, activeRow.currency)}</strong>
              </span>
              <span className="text-[var(--danger)]">
                當前水下：<strong>{formatPercent(activeRow.currentDrawdown)}</strong>
              </span>
              <span className="text-[var(--muted-foreground)]">
                歷史 MDD ({lookbackLabel})：{formatPercent(activeRow.historicalMdd)} ({activeRow.mddDate})
              </span>
            </div>
          </div>
          <SymbolUnderwaterChart
            series={activeRow.underwaterSeries}
            historicalMdd={activeRow.historicalMdd}
            mddDate={activeRow.mddDate}
          />
        </Card>
      )}
    </div>
  );
}
