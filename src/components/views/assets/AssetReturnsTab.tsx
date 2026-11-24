"use client";

import { ChevronRight, Coins, Layers, Scale, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Card } from "@/components/ui/primitives";
import { usePrivacy } from "@/lib/privacy/context";
import { findBarOnOrBefore } from "@/lib/quant/calendar";
import { computeSubsetAggregateXirr } from "@/lib/quant/symbol-performance";
import { formatPercent, formatPrice } from "@/lib/utils";
import type { MarketDataBundle } from "@/types/market";
import type {
  MddLookbackPreset,
  SymbolHoldingStatus,
  SymbolPerformanceRow,
} from "@/types/quant";
import type { Asset, CurrencyCode, Transaction } from "@/types/sheet";

type MarketFilter = "ALL" | "HELD" | "TW" | "US" | "WATCH";
type ReturnTableView = "cost-pnl" | "compounding";
type ReturnSortKey =
  | "weight-desc"
  | "unrealized-pct-desc"
  | "unrealized-amt-desc"
  | "total-pnl-desc"
  | "xirr-desc"
  | "cagr-desc"
  | "calmar-desc"
  | "cost-desc";

interface AssetReturnsTabProps {
  rows: SymbolPerformanceRow[];
  transactions: Transaction[];
  assets: Asset[];
  market: MarketDataBundle;
  asOfDate: string;
  latestFxRate: number;
  currency: CurrencyCode;
  lookback: MddLookbackPreset;
  onLookbackChange: (next: MddLookbackPreset) => void;
  marketFilter: MarketFilter;
  onMarketFilterChange: (next: MarketFilter) => void;
  onOpenDetail: (symbol: string) => void;
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

function formatTenure(days: number): string {
  if (days <= 0) return "—";
  if (days < 365) return `${days} 天`;
  const years = days / 365;
  return `${years.toFixed(1)} 年`;
}

function getRowXirr(
  row: SymbolPerformanceRow,
  currency: CurrencyCode
): number | null {
  return currency === "TWD" ? row.xirrTwd : row.xirrUsd;
}

function getRowUnrealizedPct(
  row: SymbolPerformanceRow,
  currency: CurrencyCode
): number | null {
  if (currency === "USD" && row.currency === "USD") {
    return row.unrealizedPnlPctLocal;
  }
  return row.unrealizedPnlPctTwd;
}

function getRowTotalReturnPct(
  row: SymbolPerformanceRow,
  currency: CurrencyCode
): number | null {
  if (currency === "USD" && row.currency === "USD") {
    return row.totalReturnPctLocal;
  }
  return row.totalReturnPctTwd;
}

function getRowWealthMultiple(
  row: SymbolPerformanceRow,
  currency: CurrencyCode
): number | null {
  if (currency === "USD" && row.currency === "USD") {
    return row.totalInvestedLocal > 1e-6
      ? (row.totalInvestedLocal + row.totalPnlLocal) / row.totalInvestedLocal
      : null;
  }
  return row.wealthMultipleTwd;
}

export function AssetReturnsTab({
  rows,
  transactions,
  assets,
  market,
  asOfDate,
  latestFxRate,
  currency,
  lookback,
  onLookbackChange,
  marketFilter,
  onMarketFilterChange,
  onOpenDetail,
}: AssetReturnsTabProps) {
  const { fmtMoney, fmtShares } = usePrivacy();
  const [tableView, setTableView] = useState<ReturnTableView>("cost-pnl");
  const [sortBy, setSortBy] = useState<ReturnSortKey>("weight-desc");

  const filteredRows = useMemo(() => {
    const list = rows.filter((r) => {
      if (marketFilter === "HELD") return r.held;
      if (marketFilter === "TW") return r.market === "TW";
      if (marketFilter === "US") return r.market === "US";
      if (marketFilter === "WATCH") return !r.held;
      return true;
    });

    const nullableDesc = (a: number | null, b: number | null) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return b - a;
    };

    return [...list].sort((a, b) => {
      if (sortBy === "weight-desc") {
        if (a.held !== b.held) return a.held ? -1 : 1;
        return b.marketValueTwd - a.marketValueTwd;
      }
      if (sortBy === "unrealized-pct-desc") {
        return nullableDesc(
          getRowUnrealizedPct(a, currency),
          getRowUnrealizedPct(b, currency)
        );
      }
      if (sortBy === "unrealized-amt-desc") {
        if (a.held !== b.held) return a.held ? -1 : 1;
        return b.unrealizedPnlTwd - a.unrealizedPnlTwd;
      }
      if (sortBy === "total-pnl-desc") {
        return b.totalPnlTwd - a.totalPnlTwd;
      }
      if (sortBy === "xirr-desc") {
        return nullableDesc(getRowXirr(a, currency), getRowXirr(b, currency));
      }
      if (sortBy === "cagr-desc") {
        return nullableDesc(
          a.marketMetrics[lookback].cagr,
          b.marketMetrics[lookback].cagr
        );
      }
      if (sortBy === "calmar-desc") {
        return nullableDesc(
          a.marketMetrics[lookback].calmar,
          b.marketMetrics[lookback].calmar
        );
      }
      return b.costBasisTwd - a.costBasisTwd;
    });
  }, [rows, marketFilter, sortBy, currency, lookback]);

  // Dynamic KPI summary over currently filtered rows
  const summary = useMemo(() => {
    let totalMarketValueTwd = 0;
    let totalOpenCostTwd = 0;
    let totalInvestedTwd = 0;
    let totalUnrealizedTwd = 0;
    let totalRealizedTwd = 0;
    let totalDividendsTwd = 0;
    let totalPnlTwd = 0;
    let heldCount = 0;
    let closedCount = 0;
    let watchCount = 0;

    const symbolSet = new Set<string>();
    for (const r of filteredRows) {
      symbolSet.add(r.symbol);
      if (r.status === "held") heldCount++;
      else if (r.status === "closed") closedCount++;
      else watchCount++;

      totalMarketValueTwd += r.marketValueTwd;
      totalOpenCostTwd += r.costBasisTwd;
      totalInvestedTwd += r.totalInvestedTwd;
      totalUnrealizedTwd += r.unrealizedPnlTwd;
      totalRealizedTwd += r.realizedPnlTwd;
      totalDividendsTwd += r.cumulativeDividendsTwd;
      totalPnlTwd += r.totalPnlTwd;
    }

    // Compute pure out-of-pocket net capital (BUY - SELL) over filtered symbols so swaps don't dilute MOIC
    const assetMap = new Map(assets.map((a) => [a.symbol, a]));
    const filteredTxs = transactions
      .filter((tx) => tx.date <= asOfDate && symbolSet.has(tx.symbol))
      .sort((a, b) => a.date.localeCompare(b.date));

    let netPrincipalTwd = 0;
    let peakNetPrincipalTwd = 0;
    let dayDate = "";
    let dayDelta = 0;
    const flushDay = () => {
      if (!dayDate) return;
      netPrincipalTwd += dayDelta;
      if (netPrincipalTwd > peakNetPrincipalTwd) {
        peakNetPrincipalTwd = netPrincipalTwd;
      }
      dayDelta = 0;
    };
    for (const tx of filteredTxs) {
      if (tx.date !== dayDate) {
        flushDay();
        dayDate = tx.date;
      }
      if (tx.type !== "BUY" && tx.type !== "SELL") continue;
      const assetCcy = assetMap.get(tx.symbol)?.currency ?? "TWD";
      const fx =
        assetCcy === "TWD"
          ? 1
          : tx.fxRate && tx.fxRate > 0
            ? tx.fxRate
            : findBarOnOrBefore(market.fxBars, tx.date, true)?.close ?? latestFxRate;
      if (tx.type === "BUY") {
        dayDelta += (tx.shares * tx.price + tx.fee) * fx;
      } else {
        dayDelta -= Math.max(0, tx.shares * tx.price - tx.fee) * fx;
      }
    }
    flushDay();

    const capitalBaseTwd =
      netPrincipalTwd > 1e-6
        ? Math.max(netPrincipalTwd, peakNetPrincipalTwd)
        : peakNetPrincipalTwd > 1e-6
          ? peakNetPrincipalTwd
          : totalInvestedTwd;

    const unrealizedPct =
      totalOpenCostTwd > 1e-6 ? totalUnrealizedTwd / totalOpenCostTwd : null;
    const totalReturnPct =
      capitalBaseTwd > 1e-6 ? totalPnlTwd / capitalBaseTwd : null;
    const wealthMultiple =
      capitalBaseTwd > 1e-6
        ? (capitalBaseTwd + totalPnlTwd) / capitalBaseTwd
        : null;

    const aggregateXirr = computeSubsetAggregateXirr({
      symbols: symbolSet,
      rows,
      transactions,
      assets,
      market,
      asOfDate,
      latestFxRate,
      currency,
    });

    return {
      totalMarketValueTwd,
      totalOpenCostTwd,
      netPrincipalTwd,
      capitalBaseTwd,
      totalInvestedTwd,
      totalUnrealizedTwd,
      totalRealizedTwd,
      totalDividendsTwd,
      totalPnlTwd,
      unrealizedPct,
      totalReturnPct,
      wealthMultiple,
      aggregateXirr,
      heldCount,
      closedCount,
      watchCount,
    };
  }, [
    filteredRows,
    rows,
    transactions,
    assets,
    market,
    asOfDate,
    latestFxRate,
    currency,
  ]);

  const lookbackLabel =
    LOOKBACK_OPTIONS.find((o) => o.key === lookback)?.label ?? "上市以來";

  return (
    <div className="space-y-5">
      {/* 4 KPI Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" /> 篩選持倉總市值
            </span>
            <Badge variant="outline">
              {summary.heldCount} 持有
              {summary.closedCount > 0 ? ` · ${summary.closedCount} 清倉` : ""}
              {summary.watchCount > 0 ? ` · ${summary.watchCount} 觀察` : ""}
            </Badge>
          </div>
          <div className="font-mono text-2xl font-bold tracking-tight tabular-nums">
            {fmtMoney(summary.totalMarketValueTwd, currency, latestFxRate)}
          </div>
          <div className="space-y-0.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[var(--muted-foreground)]">
                淨投入資金（實投）
              </span>
              <span className="font-mono font-semibold tabular-nums">
                {summary.netPrincipalTwd >= 0
                  ? fmtMoney(summary.netPrincipalTwd, currency, latestFxRate)
                  : `已回本 (${fmtMoney(summary.netPrincipalTwd, currency, latestFxRate, { signed: true, compact: true })})`}
              </span>
            </div>
            <div className="flex items-center justify-between text-[0.72rem] text-[var(--muted-foreground)]">
              <span>目前持倉成本（含換股）</span>
              <span className="font-mono tabular-nums">
                {fmtMoney(summary.totalOpenCostTwd, currency, latestFxRate)}
              </span>
            </div>
          </div>
        </Card>

        <Card className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" /> 未實現損益
            </span>
            <Badge variant="outline">{currency}</Badge>
          </div>
          <div
            className="font-mono text-2xl font-bold tracking-tight tabular-nums"
            style={{
              color:
                summary.totalUnrealizedTwd >= 0
                  ? "var(--success)"
                  : "var(--danger)",
            }}
          >
            {fmtMoney(summary.totalUnrealizedTwd, currency, latestFxRate, {
              signed: true,
            })}
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--muted-foreground)]">未實現報酬率</span>
            <span
              className="font-mono font-semibold tabular-nums"
              style={{
                color:
                  (summary.unrealizedPct ?? 0) >= 0
                    ? "var(--success)"
                    : "var(--danger)",
              }}
            >
              {formatPercent(summary.unrealizedPct, { signed: true })}
            </span>
          </div>
        </Card>

        <Card className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1.5">
              <Coins className="h-3.5 w-3.5" /> 總含息損益（含息＋已實現）
            </span>
            {summary.wealthMultiple !== null && (
              <Badge
                variant={summary.wealthMultiple >= 1 ? "success" : "danger"}
              >
                {summary.wealthMultiple.toFixed(2)}x
              </Badge>
            )}
          </div>
          <div
            className="font-mono text-2xl font-bold tracking-tight tabular-nums"
            style={{
              color:
                summary.totalPnlTwd >= 0 ? "var(--success)" : "var(--danger)",
            }}
          >
            {fmtMoney(summary.totalPnlTwd, currency, latestFxRate, {
              signed: true,
            })}
          </div>
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>
              股利 {fmtMoney(summary.totalDividendsTwd, currency, latestFxRate, { compact: true })}
              {Math.abs(summary.totalRealizedTwd) > 1
                ? ` · 已實現 ${fmtMoney(summary.totalRealizedTwd, currency, latestFxRate, { signed: true, compact: true })}`
                : ""}
            </span>
            <span
              className="font-mono font-semibold tabular-nums"
              style={{
                color:
                  (summary.totalReturnPct ?? 0) >= 0
                    ? "var(--success)"
                    : "var(--danger)",
              }}
            >
              {formatPercent(summary.totalReturnPct, { signed: true })}
            </span>
          </div>
        </Card>

        <Card className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1.5">
              <Scale className="h-3.5 w-3.5" /> 篩選組合年化報酬 (XIRR)
            </span>
            <Badge variant="default">資金加權</Badge>
          </div>
          <div
            className="font-mono text-2xl font-bold tracking-tight tabular-nums"
            style={{
              color:
                summary.aggregateXirr === null
                  ? "var(--muted-foreground)"
                  : summary.aggregateXirr >= 0
                    ? "var(--success)"
                    : "var(--danger)",
            }}
          >
            {formatPercent(summary.aggregateXirr, { signed: true })}
          </div>
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>計價幣別：{currency === "TWD" ? "TWD 含匯率" : "USD 折算"}</span>
            <span className="font-mono">滿 30 天計算</span>
          </div>
        </Card>
      </div>

      {/* Toolbar: Table View Switch + Lookback + Filter + Sort */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* Dual Table View Switch */}
          <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)] p-1">
            <button
              onClick={() => setTableView("cost-pnl")}
              className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                tableView === "cost-pnl"
                  ? "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              持倉成本與損益
            </button>
            <button
              onClick={() => setTableView("compounding")}
              className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                tableView === "compounding"
                  ? "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              長期複利與配置體質
            </button>
          </div>

          {/* Lookback Window (for Market CAGR / Volatility / Calmar / Compounding chart) */}
          <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)] p-1">
            {LOOKBACK_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => onLookbackChange(opt.key)}
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
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={marketFilter}
            onChange={(e) => onMarketFilterChange(e.target.value as MarketFilter)}
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
            onChange={(e) => setSortBy(e.target.value as ReturnSortKey)}
            className="min-h-9 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs text-[var(--foreground)] cursor-pointer"
          >
            <option value="weight-desc">排序：持倉市值 / 權重由高到低</option>
            <option value="unrealized-pct-desc">排序：未實現損益比例由高到低</option>
            <option value="unrealized-amt-desc">排序：未實現損益金額由高到低</option>
            <option value="total-pnl-desc">排序：總含息損益由高到低</option>
            <option value="xirr-desc">排序：個人年化 XIRR 由高到低</option>
            <option value="cagr-desc">排序：標的長期 CAGR 由高到低</option>
            <option value="calmar-desc">排序：Calmar 風險報酬比由高到低</option>
            <option value="cost-desc">排序：投入成本由高到低</option>
          </select>
        </div>
      </div>

      {/* Main Matrix Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          {tableView === "cost-pnl" ? (
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]/60 text-[var(--muted-foreground)]">
                  <th className="px-4 py-3 font-semibold">標的 / 持有年資</th>
                  <th className="px-3 py-3 text-right font-semibold">股數 / 權重</th>
                  <th className="px-3 py-3 text-right font-semibold">
                    均價 vs 現價 (含息兩平)
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    投入成本 / 目前市值
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">未實現損益</th>
                  <th className="px-3 py-3 text-right font-semibold">未實現比例</th>
                  <th className="px-3 py-3 text-right font-semibold">
                    累積股利 / 已實現
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">
                    個人年化 (XIRR)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredRows.map((row) => {
                  const statusMeta = STATUS_BADGE[row.status];
                  const rowXirr = getRowXirr(row, currency);
                  const rowUnrealPct = getRowUnrealizedPct(row, currency);

                  return (
                    <tr
                      key={row.symbol}
                      onClick={() => onOpenDetail(row.symbol)}
                      title={`點擊檢視 ${row.symbol} 詳細走勢與交易紀錄`}
                      className="group cursor-pointer transition hover:bg-[var(--muted)]/50"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold group-hover:text-[var(--primary)] transition-colors">
                            {row.symbol}
                          </span>
                          <Badge variant="outline">{row.market}</Badge>
                          <Badge variant={statusMeta.variant}>
                            {statusMeta.label}
                          </Badge>
                          <ChevronRight className="h-3.5 w-3.5 text-[var(--muted-foreground)] opacity-0 transition group-hover:opacity-100" />
                        </div>
                        <div className="mt-0.5 text-[var(--muted-foreground)]">
                          {row.name}
                          {row.holdingDays > 0 && (
                            <span className="ml-1.5 font-mono text-[0.72rem] opacity-80">
                              · {formatTenure(row.holdingDays)}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-3 py-3 text-right font-mono tabular-nums">
                        {row.held ? (
                          <>
                            <div className="font-semibold">
                              {fmtShares(row.shares, { maxDigits: 4 })}
                            </div>
                            <div className="text-[0.72rem] text-[var(--muted-foreground)]">
                              權重 {row.weightPct.toFixed(1)}%
                              {row.dripShares > 1e-4
                                ? ` · DRIP +${fmtShares(row.dripShares, { maxDigits: 2 })}`
                                : ""}
                            </div>
                          </>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>

                      <td className="px-3 py-3 text-right font-mono tabular-nums">
                        {row.held && row.avgCostLocal !== null ? (
                          <>
                            <div>
                              <span className="text-[var(--muted-foreground)]">
                                {formatPrice(row.avgCostLocal, row.currency)}
                              </span>
                              <span className="mx-1 text-[var(--muted-foreground)]">
                                →
                              </span>
                              <span className="font-semibold">
                                {formatPrice(row.latestPrice, row.currency)}
                              </span>
                            </div>
                            <div className="text-[0.72rem] text-[var(--muted-foreground)]">
                              含息兩平{" "}
                              {row.breakevenPriceLocal !== null
                                ? formatPrice(row.breakevenPriceLocal, row.currency)
                                : "—"}
                            </div>
                          </>
                        ) : (
                          <>
                            <div>{formatPrice(row.latestPrice, row.currency)}</div>
                            <div className="text-[0.72rem] text-[var(--muted-foreground)]">
                              最新收盤 ({row.latestDate})
                            </div>
                          </>
                        )}
                      </td>

                      <td className="px-3 py-3 text-right font-mono tabular-nums">
                        {row.held ? (
                          <>
                            <div className="font-semibold">
                              {fmtMoney(row.marketValueTwd, currency, latestFxRate)}
                            </div>
                            <div className="text-[0.72rem] text-[var(--muted-foreground)]">
                              成本 {fmtMoney(row.costBasisTwd, currency, latestFxRate)}
                            </div>
                          </>
                        ) : row.status === "closed" ? (
                          <div className="text-[var(--muted-foreground)]">
                            歷史投入 {fmtMoney(row.totalInvestedTwd, currency, latestFxRate)}
                          </div>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>

                      <td
                        className="px-3 py-3 text-right font-mono font-semibold tabular-nums"
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
                      </td>

                      <td className="px-3 py-3 text-right font-mono tabular-nums">
                        {row.held && rowUnrealPct !== null ? (
                          <>
                            <div
                              className="font-bold"
                              style={{
                                color:
                                  rowUnrealPct >= 0
                                    ? "var(--success)"
                                    : "var(--danger)",
                              }}
                            >
                              {formatPercent(rowUnrealPct, { signed: true })}
                            </div>
                            {row.currency === "USD" &&
                              currency === "TWD" &&
                              row.unrealizedPnlPctLocal !== null && (
                                <div className="text-[0.72rem] text-[var(--muted-foreground)]">
                                  原幣{" "}
                                  {formatPercent(row.unrealizedPnlPctLocal, {
                                    signed: true,
                                  })}
                                </div>
                              )}
                          </>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>

                      <td className="px-3 py-3 text-right font-mono tabular-nums">
                        {row.status !== "watch" ? (
                          <>
                            <div
                              className={
                                row.cumulativeDividendsTwd > 0
                                  ? "text-[var(--success)]"
                                  : "text-[var(--muted-foreground)]"
                              }
                            >
                              息{" "}
                              {fmtMoney(
                                row.cumulativeDividendsTwd,
                                currency,
                                latestFxRate
                              )}
                            </div>
                            {Math.abs(row.realizedPnlTwd) > 1 ? (
                              <div
                                className="text-[0.72rem]"
                                style={{
                                  color:
                                    row.realizedPnlTwd >= 0
                                      ? "var(--success)"
                                      : "var(--danger)",
                                }}
                              >
                                已實現{" "}
                                {fmtMoney(row.realizedPnlTwd, currency, latestFxRate, {
                                  signed: true,
                                  compact: true,
                                })}
                              </div>
                            ) : row.dividendRecoveryPct !== null &&
                              row.dividendRecoveryPct > 0 ? (
                              <div className="text-[0.72rem] text-[var(--muted-foreground)]">
                                回收 {(row.dividendRecoveryPct * 100).toFixed(1)}%
                              </div>
                            ) : (
                              <div className="text-[0.72rem] text-[var(--muted-foreground)]">
                                無已實現
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {rowXirr !== null ? (
                          <>
                            <div
                              className="font-bold"
                              style={{
                                color:
                                  rowXirr >= 0 ? "var(--success)" : "var(--danger)",
                              }}
                            >
                              {formatPercent(rowXirr, { signed: true })}
                            </div>
                            {row.currency === "USD" &&
                              currency === "TWD" &&
                              row.xirrLocal !== null && (
                                <div className="text-[0.72rem] text-[var(--muted-foreground)]">
                                  USD {formatPercent(row.xirrLocal, { signed: true })}
                                </div>
                              )}
                          </>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">
                            {row.status !== "watch" && row.holdingDays < 30
                              ? "未滿 30 天"
                              : "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {filteredRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-8 text-center text-[var(--muted-foreground)]"
                    >
                      無符合篩選條件的監控標的
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]/60 text-[var(--muted-foreground)]">
                  <th className="px-4 py-3 font-semibold">標的 / 建倉日</th>
                  <th className="px-3 py-3 text-right font-semibold">
                    總含息損益 / 報酬
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    複利倍數 (MOIC)
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    個人年化 (XIRR)
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    標的年化 ({lookbackLabel})
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    年化波動率 ({lookbackLabel})
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    Calmar / Sharpe
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">
                    股價 vs 匯率拆解
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredRows.map((row) => {
                  const statusMeta = STATUS_BADGE[row.status];
                  const metrics = row.marketMetrics[lookback];
                  const rowXirr = getRowXirr(row, currency);
                  const rowTotalPct = getRowTotalReturnPct(row, currency);
                  const moic = getRowWealthMultiple(row, currency);

                  return (
                    <tr
                      key={row.symbol}
                      onClick={() => onOpenDetail(row.symbol)}
                      title={`點擊檢視 ${row.symbol} 詳細走勢與交易紀錄`}
                      className="group cursor-pointer transition hover:bg-[var(--muted)]/50"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold group-hover:text-[var(--primary)] transition-colors">
                            {row.symbol}
                          </span>
                          <Badge variant="outline">{row.market}</Badge>
                          <Badge variant={statusMeta.variant}>
                            {statusMeta.label}
                          </Badge>
                          <ChevronRight className="h-3.5 w-3.5 text-[var(--muted-foreground)] opacity-0 transition group-hover:opacity-100" />
                        </div>
                        <div className="mt-0.5 text-[var(--muted-foreground)]">
                          {row.name}
                          <span className="ml-1.5 font-mono text-[0.72rem] opacity-80">
                            {row.firstBuyDate
                              ? `建倉 ${row.firstBuyDate}`
                              : `起自 ${row.firstMarketDate.slice(0, 7)}`}
                          </span>
                        </div>
                      </td>

                      <td className="px-3 py-3 text-right font-mono tabular-nums">
                        {row.status !== "watch" ? (
                          <>
                            <div
                              className="font-semibold"
                              style={{
                                color:
                                  row.totalPnlTwd >= 0
                                    ? "var(--success)"
                                    : "var(--danger)",
                              }}
                            >
                              {fmtMoney(row.totalPnlTwd, currency, latestFxRate, {
                                signed: true,
                              })}
                            </div>
                            <div
                              className="text-[0.72rem]"
                              style={{
                                color:
                                  (rowTotalPct ?? 0) >= 0
                                    ? "var(--success)"
                                    : "var(--danger)",
                              }}
                            >
                              {formatPercent(rowTotalPct, { signed: true })}
                            </div>
                          </>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>

                      <td className="px-3 py-3 text-right font-mono font-semibold tabular-nums">
                        {moic !== null ? (
                          <span
                            style={{
                              color:
                                moic >= 1 ? "var(--success)" : "var(--danger)",
                            }}
                          >
                            {moic.toFixed(2)}x
                          </span>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>

                      <td
                        className="px-3 py-3 text-right font-mono font-bold tabular-nums"
                        style={{
                          color:
                            rowXirr === null
                              ? "var(--muted-foreground)"
                              : rowXirr >= 0
                                ? "var(--success)"
                                : "var(--danger)",
                        }}
                      >
                        {formatPercent(rowXirr, { signed: true })}
                      </td>

                      <td className="px-3 py-3 text-right font-mono tabular-nums">
                        <div
                          className="font-semibold"
                          style={{
                            color:
                              metrics.cagr === null
                                ? "var(--muted-foreground)"
                                : metrics.cagr >= 0
                                  ? "var(--success)"
                                  : "var(--danger)",
                          }}
                        >
                          {formatPercent(metrics.cagr, { signed: true })}
                        </div>
                        <div className="text-[0.72rem] text-[var(--muted-foreground)]">
                          MDD {formatPercent(metrics.maxDrawdown)}
                        </div>
                      </td>

                      <td className="px-3 py-3 text-right font-mono tabular-nums text-[var(--muted-foreground)]">
                        {metrics.volatility !== null
                          ? formatPercent(metrics.volatility, { digits: 1 })
                          : "—"}
                      </td>

                      <td className="px-3 py-3 text-right font-mono tabular-nums">
                        <div className="font-semibold">
                          {metrics.calmar !== null
                            ? metrics.calmar.toFixed(2)
                            : "—"}
                        </div>
                        <div className="text-[0.72rem] text-[var(--muted-foreground)]">
                          Sharpe{" "}
                          {metrics.sharpe !== null
                            ? metrics.sharpe.toFixed(2)
                            : "—"}
                        </div>
                      </td>

                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {row.currency === "USD" &&
                        row.held &&
                        row.avgEntryFxRate !== null &&
                        row.fxPnlTwd !== null ? (
                          <>
                            <div className="text-[0.72rem] text-[var(--muted-foreground)]">
                              均匯 {row.avgEntryFxRate.toFixed(2)} →{" "}
                              {latestFxRate.toFixed(2)}
                            </div>
                            <div className="text-[0.72rem]">
                              股{" "}
                              <span
                                style={{
                                  color:
                                    row.equityPnlTwd >= 0
                                      ? "var(--success)"
                                      : "var(--danger)",
                                }}
                              >
                                {fmtMoney(row.equityPnlTwd, "TWD", latestFxRate, {
                                  signed: true,
                                  compact: true,
                                })}
                              </span>{" "}
                              · 匯{" "}
                              <span
                                style={{
                                  color:
                                    row.fxPnlTwd >= 0
                                      ? "var(--success)"
                                      : "var(--danger)",
                                }}
                              >
                                {fmtMoney(row.fxPnlTwd, "TWD", latestFxRate, {
                                  signed: true,
                                  compact: true,
                                })}
                              </span>
                            </div>
                          </>
                        ) : row.currency === "TWD" ? (
                          <span className="text-[var(--muted-foreground)]">
                            台幣計價
                          </span>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {filteredRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-8 text-center text-[var(--muted-foreground)]"
                    >
                      無符合篩選條件的監控標的
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        {filteredRows.length > 0 && (
          <div className="border-t border-[var(--border)] bg-[var(--muted)]/20 px-4 py-2 text-[0.72rem] text-[var(--muted-foreground)]">
            提示：點擊任一標的列即可開啟該標的專屬詳情頁（含長期走勢圖與完整交易紀錄）。
          </div>
        )}
      </Card>
    </div>
  );
}
