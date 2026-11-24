"use client";

import {
  ArrowLeft,
  Coins,
  Layers,
  ReceiptText,
  Scale,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState } from "react";
import { SymbolUnderwaterChart } from "@/components/charts/SymbolUnderwaterChart";
import { SymbolWealthGrowthChart } from "@/components/charts/SymbolWealthGrowthChart";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { usePrivacy } from "@/lib/privacy/context";
import { findBarOnOrBefore } from "@/lib/quant/calendar";
import { toSplitAdjustedShares } from "@/lib/quant/holdings";
import { formatPercent, formatPrice } from "@/lib/utils";
import type { MarketDataBundle } from "@/types/market";
import type {
  MddLookbackPreset,
  MddMatrixRow,
  MddSignalLevel,
  SymbolHoldingStatus,
  SymbolPerformanceRow,
} from "@/types/quant";
import type { CurrencyCode, Transaction, TransactionType } from "@/types/sheet";

type DetailChartMode = "wealth" | "compounding" | "underwater";

interface AssetDetailViewProps {
  performanceRow: SymbolPerformanceRow;
  mddRow: MddMatrixRow | null;
  allSymbols: Array<{ symbol: string; name: string; status: SymbolHoldingStatus }>;
  transactions: Transaction[];
  market: MarketDataBundle;
  latestFxRate: number;
  currency: CurrencyCode;
  lookback: MddLookbackPreset;
  onLookbackChange: (next: MddLookbackPreset) => void;
  initialChartMode: DetailChartMode;
  returnTabLabel: string;
  onBack: () => void;
  onSelectSymbol: (symbol: string) => void;
}

const LOOKBACK_OPTIONS: Array<{ key: MddLookbackPreset; label: string }> = [
  { key: "5Y", label: "近 5 年" },
  { key: "10Y", label: "近 10 年" },
  { key: "MAX", label: "上市以來 (MAX)" },
];

const STATUS_BADGE: Record<
  SymbolHoldingStatus,
  { label: string; variant: "success" | "muted" | "warning" }
> = {
  held: { label: "持有中", variant: "success" },
  closed: { label: "已清倉", variant: "muted" },
  watch: { label: "觀察中", variant: "warning" },
};

const SIGNAL_META: Record<
  MddSignalLevel,
  { label: string; variant: "success" | "default" | "warning" | "danger" }
> = {
  "near-high": { label: "接近新高", variant: "success" },
  mild: { label: "輕度回檔", variant: "default" },
  moderate: { label: "左側分批區", variant: "warning" },
  deep: { label: "深度折價區", variant: "danger" },
};

const TX_TYPE_META: Record<
  TransactionType,
  { label: string; variant: "default" | "danger" | "success" | "warning" }
> = {
  BUY: { label: "買進 BUY", variant: "default" },
  SELL: { label: "賣出 SELL", variant: "danger" },
  DIVIDEND: { label: "現金股利", variant: "success" },
  DRIP: { label: "股息再投入", variant: "warning" },
};

function formatTenure(days: number): string {
  if (days <= 0) return "—";
  if (days < 365) return `${days} 天`;
  return `${(days / 365).toFixed(1)} 年`;
}

export function AssetDetailView({
  performanceRow: row,
  mddRow,
  allSymbols,
  transactions,
  market,
  latestFxRate,
  currency,
  lookback,
  onLookbackChange,
  initialChartMode,
  returnTabLabel,
  onBack,
  onSelectSymbol,
}: AssetDetailViewProps) {
  const { fmtMoney, fmtShares } = usePrivacy();

  const [chartMode, setChartMode] = useState<DetailChartMode>(() => {
    if (initialChartMode === "underwater" && mddRow) return "underwater";
    if (initialChartMode === "wealth" && row.wealthSeries.length > 0) {
      return "wealth";
    }
    return row.wealthSeries.length > 0 ? "wealth" : "compounding";
  });
  const [includeDividendsInChart, setIncludeDividendsInChart] = useState(true);
  const [txTypeFilter, setTxTypeFilter] = useState<"ALL" | TransactionType>(
    "ALL"
  );
  const [txSortOrder, setTxSortOrder] = useState<"desc" | "asc">("desc");

  // Ensure chart mode remains valid when switching symbols via quick selector
  const effectiveChartMode: DetailChartMode = useMemo(() => {
    if (chartMode === "wealth" && row.wealthSeries.length === 0) {
      return "compounding";
    }
    if (chartMode === "underwater" && !mddRow) {
      return row.wealthSeries.length > 0 ? "wealth" : "compounding";
    }
    return chartMode;
  }, [chartMode, row.wealthSeries.length, mddRow]);

  const splits = useMemo(
    () => market.tickers[row.symbol]?.splits ?? [],
    [market.tickers, row.symbol]
  );

  // Enrich symbol transactions with split-adjusted shares & TWD amounts
  const enrichedTxs = useMemo(() => {
    return transactions
      .filter((tx) => tx.symbol === row.symbol)
      .map((tx) => {
        const adjShares = toSplitAdjustedShares(tx, splits);
        const hasSplit =
          tx.type !== "DIVIDEND" &&
          tx.shares > 0 &&
          Math.abs(adjShares - tx.shares) > 1e-4;
        const spotFx =
          findBarOnOrBefore(market.fxBars, tx.date, true)?.close ?? latestFxRate;
        const effectiveFx =
          row.currency === "TWD"
            ? 1
            : tx.fxRate && tx.fxRate > 0
              ? tx.fxRate
              : spotFx;
        const isInferredFx =
          row.currency === "USD" && !(tx.fxRate && tx.fxRate > 0);

        let localAmount = 0;
        if (tx.type === "BUY") {
          localAmount = tx.shares * tx.price + tx.fee;
        } else if (tx.type === "SELL" || tx.type === "DIVIDEND") {
          localAmount = Math.max(0, tx.shares * tx.price - tx.fee);
        } else {
          // DRIP informational value
          localAmount = tx.shares * tx.price;
        }
        const twdAmount = localAmount * effectiveFx;

        return {
          tx,
          adjShares,
          hasSplit,
          effectiveFx,
          isInferredFx,
          localAmount,
          twdAmount,
        };
      });
  }, [transactions, row.symbol, row.currency, splits, market.fxBars, latestFxRate]);

  const txCounts = useMemo(() => {
    const counts: Record<TransactionType, number> = {
      BUY: 0,
      SELL: 0,
      DIVIDEND: 0,
      DRIP: 0,
    };
    for (const item of enrichedTxs) {
      counts[item.tx.type] += 1;
    }
    return counts;
  }, [enrichedTxs]);

  const filteredTxs = useMemo(() => {
    const list =
      txTypeFilter === "ALL"
        ? enrichedTxs
        : enrichedTxs.filter((item) => item.tx.type === txTypeFilter);

    return [...list].sort((a, b) => {
      const cmp = a.tx.date.localeCompare(b.tx.date);
      if (cmp !== 0) return txSortOrder === "desc" ? -cmp : cmp;
      return txSortOrder === "desc"
        ? b.tx.id.localeCompare(a.tx.id)
        : a.tx.id.localeCompare(b.tx.id);
    });
  }, [enrichedTxs, txTypeFilter, txSortOrder]);

  const statusMeta = STATUS_BADGE[row.status];
  const lookbackLabel =
    LOOKBACK_OPTIONS.find((o) => o.key === lookback)?.label ?? "上市以來";
  const metrics = row.marketMetrics[lookback];
  const displayXirr = currency === "TWD" ? row.xirrTwd : row.xirrUsd;
  const displayUnrealPct =
    currency === "USD" && row.currency === "USD"
      ? row.unrealizedPnlPctLocal
      : row.unrealizedPnlPctTwd;
  const displayTotalPct =
    currency === "USD" && row.currency === "USD"
      ? row.totalReturnPctLocal
      : row.totalReturnPctTwd;
  const displayMoic =
    currency === "USD" && row.currency === "USD"
      ? row.totalInvestedLocal > 1e-6
        ? (row.totalInvestedLocal + row.totalPnlLocal) / row.totalInvestedLocal
        : null
      : row.wealthMultipleTwd;

  return (
    <div className="space-y-5">
      {/* Top Breadcrumb + Quick Symbol Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" />
            返回{returnTabLabel}
          </Button>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-mono text-base font-bold">{row.symbol}</h2>
              <span className="text-sm font-semibold">{row.name}</span>
              <Badge variant="outline">{row.market}</Badge>
              <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
              <Badge variant="muted">{row.yahooTicker}</Badge>
              {mddRow && (
                <Badge variant={SIGNAL_META[mddRow.signal].variant}>
                  {SIGNAL_META[mddRow.signal].label} (
                  {formatPercent(mddRow.currentDrawdown)})
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              最新收盤{" "}
              <span className="font-mono font-semibold text-[var(--foreground)]">
                {formatPrice(row.latestPrice, row.currency)}
              </span>{" "}
              ({row.latestDate})
              {row.firstBuyDate
                ? ` · 首次建倉 ${row.firstBuyDate} · 持有 ${formatTenure(row.holdingDays)}`
                : ` · 行情起自 ${row.firstMarketDate}`}
            </p>
          </div>
        </div>

        {/* Quick Switcher across tracked symbols */}
        <div className="flex items-center gap-2 text-xs">
          <label
            htmlFor="detail-symbol-switcher"
            className="text-[var(--muted-foreground)]"
          >
            切換標的
          </label>
          <select
            id="detail-symbol-switcher"
            value={row.symbol}
            onChange={(e) => onSelectSymbol(e.target.value)}
            className="min-h-9 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 font-mono text-xs text-[var(--foreground)] cursor-pointer"
          >
            {allSymbols.map((s) => (
              <option key={s.symbol} value={s.symbol}>
                {s.symbol} — {s.name} ({STATUS_BADGE[s.status].label})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 4 Symbol KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" /> 目前市值 / 持有股數
            </span>
            {row.held && (
              <Badge variant="outline">權重 {row.weightPct.toFixed(1)}%</Badge>
            )}
          </div>
          <div className="font-mono text-2xl font-bold tracking-tight tabular-nums">
            {row.held
              ? fmtMoney(row.marketValueTwd, currency, latestFxRate)
              : "—"}
          </div>
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)] font-mono tabular-nums">
            <span>
              {row.held
                ? `${fmtShares(row.shares, { maxDigits: 4 })} 股`
                : row.status === "closed"
                  ? "已全部清倉"
                  : "尚未持有"}
            </span>
            <span>
              {row.held
                ? `成本 ${fmtMoney(row.costBasisTwd, currency, latestFxRate)}`
                : row.status === "closed"
                  ? `歷史投入 ${fmtMoney(row.totalInvestedTwd, currency, latestFxRate)}`
                  : ""}
            </span>
          </div>
        </Card>

        <Card className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" /> 未實現損益 / 均價
            </span>
            <Badge variant="outline">{currency}</Badge>
          </div>
          <div
            className="font-mono text-2xl font-bold tracking-tight tabular-nums"
            style={{
              color: !row.held
                ? "var(--muted-foreground)"
                : row.unrealizedPnlTwd >= 0
                  ? "var(--success)"
                  : "var(--danger)",
            }}
          >
            {row.held
              ? fmtMoney(row.unrealizedPnlTwd, currency, latestFxRate, {
                  signed: true,
                })
              : "—"}
          </div>
          <div className="flex items-center justify-between text-xs font-mono tabular-nums">
            <span className="text-[var(--muted-foreground)]">
              均價{" "}
              {row.avgCostLocal !== null
                ? formatPrice(row.avgCostLocal, row.currency)
                : "—"}
            </span>
            <span
              className="font-semibold"
              style={{
                color:
                  displayUnrealPct === null
                    ? "var(--muted-foreground)"
                    : displayUnrealPct >= 0
                      ? "var(--success)"
                      : "var(--danger)",
              }}
            >
              {formatPercent(displayUnrealPct, { signed: true })}
            </span>
          </div>
        </Card>

        <Card className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1.5">
              <Coins className="h-3.5 w-3.5" /> 總含息損益（含息＋已實現）
            </span>
            {displayMoic !== null && (
              <Badge variant={displayMoic >= 1 ? "success" : "danger"}>
                {displayMoic.toFixed(2)}x
              </Badge>
            )}
          </div>
          <div
            className="font-mono text-2xl font-bold tracking-tight tabular-nums"
            style={{
              color:
                row.status === "watch"
                  ? "var(--muted-foreground)"
                  : row.totalPnlTwd >= 0
                    ? "var(--success)"
                    : "var(--danger)",
            }}
          >
            {row.status !== "watch"
              ? fmtMoney(row.totalPnlTwd, currency, latestFxRate, {
                  signed: true,
                })
              : "—"}
          </div>
          <div className="flex items-center justify-between text-xs font-mono tabular-nums">
            <span className="text-[var(--muted-foreground)]">
              含息兩平{" "}
              {row.breakevenPriceLocal !== null
                ? formatPrice(row.breakevenPriceLocal, row.currency)
                : "—"}
            </span>
            <span
              className="font-semibold"
              style={{
                color:
                  displayTotalPct === null
                    ? "var(--muted-foreground)"
                    : displayTotalPct >= 0
                      ? "var(--success)"
                      : "var(--danger)",
              }}
            >
              {formatPercent(displayTotalPct, { signed: true })}
            </span>
          </div>
        </Card>

        <Card className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1.5">
              <Scale className="h-3.5 w-3.5" /> 個人年化 (XIRR) / 標的年化
            </span>
            <Badge variant="default">{lookbackLabel}</Badge>
          </div>
          <div
            className="font-mono text-2xl font-bold tracking-tight tabular-nums"
            style={{
              color:
                displayXirr === null
                  ? "var(--muted-foreground)"
                  : displayXirr >= 0
                    ? "var(--success)"
                    : "var(--danger)",
            }}
          >
            {displayXirr !== null
              ? formatPercent(displayXirr, { signed: true })
              : row.status !== "watch" && row.holdingDays < 30
                ? "未滿 30 天"
                : "—"}
          </div>
          <div className="flex items-center justify-between text-xs font-mono tabular-nums text-[var(--muted-foreground)]">
            <span>
              標的 CAGR {formatPercent(metrics.cagr, { signed: true })}
            </span>
            <span>
              Calmar{" "}
              {metrics.calmar !== null ? metrics.calmar.toFixed(2) : "—"}
            </span>
          </div>
        </Card>
      </div>

      {/* TOP SECTION: Historical Charts Card */}
      <Card className="p-4 lg:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold">
              {effectiveChartMode === "wealth"
                ? `${row.symbol} 個人累積投入成本 vs 持倉市值走勢`
                : effectiveChartMode === "compounding"
                  ? `${row.symbol} 長期含息複利成長軌跡 (${lookbackLabel})`
                  : `${row.symbol} 含息還原水下深度軌跡 (${lookbackLabel})`}
            </h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              {effectiveChartMode === "wealth"
                ? "虛線為剩餘投入成本，實線面積為持倉總市值；呈現長期投入累積的複利安全墊"
                : effectiveChartMode === "compounding"
                  ? "以含息還原價（Adj Close）標準化為 100，呈現長期買進持有的複利倍數"
                  : "以含息還原價（Adj Close）計算距離歷史高點之回撤深度與歷史最大回撤 (MDD)"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Chart Mode Switcher */}
            <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5">
              {row.wealthSeries.length > 0 && (
                <button
                  onClick={() => setChartMode("wealth")}
                  className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                    effectiveChartMode === "wealth"
                      ? "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  }`}
                >
                  成本 vs 市值
                </button>
              )}
              <button
                onClick={() => setChartMode("compounding")}
                className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                  effectiveChartMode === "compounding"
                    ? "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                長期含息複利
              </button>
              {mddRow && (
                <button
                  onClick={() => setChartMode("underwater")}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 transition cursor-pointer ${
                    effectiveChartMode === "underwater"
                      ? "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  }`}
                >
                  <ShieldAlert className="h-3 w-3" />
                  水下深度 (MDD)
                </button>
              )}
            </div>

            {/* Extra toggle per chart mode */}
            {effectiveChartMode === "wealth" ? (
              <button
                onClick={() => setIncludeDividendsInChart((v) => !v)}
                className={`rounded-lg border px-2.5 py-1 transition cursor-pointer ${
                  includeDividendsInChart
                    ? "border-[var(--primary)] bg-[var(--primary)]/15 font-semibold text-[var(--primary)]"
                    : "border-[var(--border)] text-[var(--muted-foreground)]"
                }`}
              >
                {includeDividendsInChart ? "✓ 計入累積股息" : "僅看持倉市值"}
              </button>
            ) : (
              <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5">
                {LOOKBACK_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => onLookbackChange(opt.key)}
                    className={`rounded-md px-2 py-1 transition cursor-pointer ${
                      lookback === opt.key
                        ? "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                        : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Chart Body */}
        {effectiveChartMode === "underwater" && mddRow ? (
          <SymbolUnderwaterChart
            series={mddRow.underwaterSeries}
            historicalMdd={mddRow.historicalMdd}
            mddDate={mddRow.mddDate}
          />
        ) : (
          <SymbolWealthGrowthChart
            mode={effectiveChartMode === "wealth" ? "wealth" : "compounding"}
            wealthSeries={row.wealthSeries}
            marketSeries={row.marketSeries}
            lookback={lookback}
            includeDividends={includeDividendsInChart}
            currency={currency}
            fxRate={latestFxRate}
          />
        )}

        {/* 4-Column Structural Details Strip */}
        <div className="grid grid-cols-1 gap-3 border-t border-[var(--border)] pt-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg bg-[var(--muted)]/40 p-3 space-y-1">
            <div className="text-[var(--muted-foreground)]">
              拆股還原均價 / 含息兩平價
            </div>
            <div className="font-mono font-semibold tabular-nums">
              {row.avgCostLocal !== null
                ? formatPrice(row.avgCostLocal, row.currency)
                : "—"}
              <span className="mx-1.5 text-[var(--muted-foreground)]">/</span>
              <span className="text-[var(--success)]">
                {row.breakevenPriceLocal !== null
                  ? formatPrice(row.breakevenPriceLocal, row.currency)
                  : "—"}
              </span>
            </div>
            <div className="font-mono text-[0.72rem] text-[var(--muted-foreground)]">
              距均價安全墊{" "}
              {formatPercent(row.priceVsAvgCostPct, { signed: true })}
              {row.dripShares > 1e-4
                ? ` · DRIP +${fmtShares(row.dripShares, { maxDigits: 2 })}`
                : ""}
            </div>
          </div>

          <div className="rounded-lg bg-[var(--muted)]/40 p-3 space-y-1">
            <div className="text-[var(--muted-foreground)]">
              累積現金股利 / 已實現損益
            </div>
            <div className="font-mono font-semibold tabular-nums text-[var(--success)]">
              {fmtMoney(row.cumulativeDividendsTwd, currency, latestFxRate)}
              {row.dividendRecoveryPct !== null && row.dividendRecoveryPct > 0
                ? ` (回收 ${(row.dividendRecoveryPct * 100).toFixed(1)}%)`
                : ""}
            </div>
            <div className="font-mono text-[0.72rem] text-[var(--muted-foreground)]">
              已實現：
              {fmtMoney(row.realizedPnlTwd, currency, latestFxRate, {
                signed: true,
              })}{" "}
              · 總手續費 {fmtMoney(row.totalFeesTwd, currency, latestFxRate)}
            </div>
          </div>

          <div className="rounded-lg bg-[var(--muted)]/40 p-3 space-y-1">
            <div className="text-[var(--muted-foreground)]">
              長期風險與品質 ({lookbackLabel})
            </div>
            <div className="font-mono font-semibold tabular-nums">
              歷史 MDD {formatPercent(metrics.maxDrawdown)}
              {mddRow ? ` · 現水下 ${formatPercent(mddRow.currentDrawdown)}` : ""}
            </div>
            <div className="font-mono text-[0.72rem] text-[var(--muted-foreground)]">
              波動{" "}
              {formatPercent(metrics.volatility, { digits: 1 })} · Sharpe{" "}
              {metrics.sharpe !== null ? metrics.sharpe.toFixed(2) : "—"} ·
              Calmar {metrics.calmar !== null ? metrics.calmar.toFixed(2) : "—"}
            </div>
          </div>

          <div className="rounded-lg bg-[var(--muted)]/40 p-3 space-y-1">
            <div className="text-[var(--muted-foreground)]">
              {row.currency === "USD" && row.held
                ? "美股買進均匯 / 股匯拆解"
                : "個人年化 (TWD / USD)"}
            </div>
            {row.currency === "USD" &&
            row.held &&
            row.avgEntryFxRate !== null &&
            row.fxPnlTwd !== null ? (
              <>
                <div className="font-mono font-semibold tabular-nums">
                  {row.avgEntryFxRate.toFixed(2)} → {latestFxRate.toFixed(2)}
                </div>
                <div className="font-mono text-[0.72rem] text-[var(--muted-foreground)]">
                  股價{" "}
                  {fmtMoney(row.equityPnlTwd, "TWD", latestFxRate, {
                    signed: true,
                    compact: true,
                  })}{" "}
                  · 匯率{" "}
                  {fmtMoney(row.fxPnlTwd, "TWD", latestFxRate, {
                    signed: true,
                    compact: true,
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="font-mono font-semibold tabular-nums">
                  TWD {formatPercent(row.xirrTwd, { signed: true })}
                </div>
                <div className="font-mono text-[0.72rem] text-[var(--muted-foreground)]">
                  USD 折算 {formatPercent(row.xirrUsd, { signed: true })}
                </div>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* BOTTOM SECTION: Symbol Transaction History Table */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3.5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <ReceiptText className="h-4 w-4 text-[var(--primary)]" />
              <h3 className="text-sm font-bold">
                {row.symbol} 歷史交易紀錄
              </h3>
              <Badge variant="outline">共 {enrichedTxs.length} 筆</Badge>
              {txCounts.BUY > 0 && (
                <span className="text-xs text-[var(--muted-foreground)]">
                  買進 {txCounts.BUY}
                  {txCounts.SELL > 0 ? ` · 賣出 ${txCounts.SELL}` : ""}
                  {txCounts.DIVIDEND > 0 ? ` · 領息 ${txCounts.DIVIDEND}` : ""}
                  {txCounts.DRIP > 0 ? ` · DRIP ${txCounts.DRIP}` : ""}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              完整呈現該標的之買賣、領息與股息再投入紀錄；若遇歷史拆股將自動並列拆股還原股數
            </p>
          </div>

          {enrichedTxs.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5">
                {(
                  [
                    { key: "ALL", label: "全部" },
                    { key: "BUY", label: "買進" },
                    { key: "SELL", label: "賣出" },
                    { key: "DIVIDEND", label: "股利" },
                    { key: "DRIP", label: "DRIP" },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setTxTypeFilter(item.key)}
                    className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                      txTypeFilter === item.key
                        ? "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                        : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <button
                onClick={() =>
                  setTxSortOrder((prev) => (prev === "desc" ? "asc" : "desc"))
                }
                className="min-h-8 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1 text-xs text-[var(--foreground)] hover:bg-[var(--muted)] cursor-pointer transition"
              >
                日期：{txSortOrder === "desc" ? "最新在前 ↓" : "最舊在前 ↑"}
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-[var(--muted-foreground)]">
                <th className="px-4 py-2.5 font-semibold">交易日期</th>
                <th className="px-3 py-2.5 font-semibold">類別</th>
                <th className="px-3 py-2.5 text-right font-semibold">
                  股數（拆股還原）
                </th>
                <th className="px-3 py-2.5 text-right font-semibold">
                  成交單價 ({row.currency})
                </th>
                <th className="px-3 py-2.5 text-right font-semibold">
                  手續費 ({row.currency})
                </th>
                <th className="px-3 py-2.5 text-right font-semibold">
                  交易總額 ({currency})
                </th>
                <th className="px-3 py-2.5 text-right font-semibold">匯率</th>
                <th className="px-4 py-2.5 font-semibold">資金來源 / 備註</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filteredTxs.map(
                ({
                  tx,
                  adjShares,
                  hasSplit,
                  effectiveFx,
                  isInferredFx,
                  localAmount,
                  twdAmount,
                }) => {
                  const typeMeta = TX_TYPE_META[tx.type];
                  return (
                    <tr
                      key={`${tx.id}-${tx.date}`}
                      className="hover:bg-[var(--muted)]/40"
                    >
                      <td className="px-4 py-2.5 font-mono tabular-nums">
                        {tx.date}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge variant={typeMeta.variant}>{typeMeta.label}</Badge>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        <div>{fmtShares(tx.shares, { maxDigits: 4 })}</div>
                        {hasSplit && (
                          <div className="text-[0.7rem] text-[var(--primary)]">
                            還原 {fmtShares(adjShares, { maxDigits: 4 })}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {formatPrice(tx.price, row.currency)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--muted-foreground)]">
                        {tx.fee > 0 ? formatPrice(tx.fee, row.currency) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        <div className="font-semibold">
                          {fmtMoney(twdAmount, currency, latestFxRate)}
                        </div>
                        {row.currency !== currency && (
                          <div className="text-[0.7rem] text-[var(--muted-foreground)]">
                            原幣{" "}
                            {row.currency === "USD"
                              ? fmtMoney(
                                  localAmount * effectiveFx,
                                  "USD",
                                  effectiveFx
                                )
                              : fmtMoney(localAmount, "TWD", 1)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--muted-foreground)]">
                        {row.currency === "USD" ? (
                          <span
                            title={
                              isInferredFx
                                ? "採用當日歷史收盤匯率"
                                : "交易紀錄指定匯率"
                            }
                          >
                            {effectiveFx.toFixed(2)}
                            {isInferredFx ? "*" : ""}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline">
                            #{tx.fundingTag?.trim() || "自有資金"}
                          </Badge>
                          {tx.note && (
                            <span className="text-[var(--muted-foreground)]">
                              {tx.note}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                }
              )}

              {filteredTxs.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="py-8 text-center text-[var(--muted-foreground)]"
                  >
                    {enrichedTxs.length === 0
                      ? "尚無此標的之歷史交易紀錄（目前為觀察標的）"
                      : "此分類下無交易紀錄"}
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
