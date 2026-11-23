"use client";

import { ArrowRight, CheckCircle2, ShieldAlert, TrendingDown, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { TwrBenchmarkChart } from "@/components/charts/TwrBenchmarkChart";
import { UnderwaterAreaChart } from "@/components/charts/UnderwaterAreaChart";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { computePeriodPerformance } from "@/lib/quant/attribution";
import {
  buildNormalizedBenchmarkCurves,
  sliceSeriesByRange,
} from "@/lib/quant/engine";
import { formatMoney, formatPercent } from "@/lib/utils";
import type { MarketDataBundle } from "@/types/market";
import type {
  PortfolioLeverageSummary,
  PortfolioScope,
  QuantEngineOutput,
  TimeRangePreset,
} from "@/types/quant";
import type { CurrencyCode, PortfolioSheetsData } from "@/types/sheet";

const RANGES: TimeRangePreset[] = ["1M", "3M", "6M", "YTD", "1Y", "3Y", "ALL"];

const BENCHMARK_STYLES: Array<{ symbol: string; label: string; color: string }> = [
  { symbol: "VT", label: "VT (全球)", color: "var(--chart-2)" },
  { symbol: "0050", label: "0050 (台股)", color: "var(--chart-3)" },
  { symbol: "VOO", label: "VOO (美股)", color: "var(--chart-4)" },
];

interface OverviewViewProps {
  engine: QuantEngineOutput;
  sheets: PortfolioSheetsData;
  market: MarketDataBundle;
  scope: PortfolioScope;
  currency: CurrencyCode;
  fundingFilter?: string;
  leverage?: PortfolioLeverageSummary | null;
  onNavigateMdd: () => void;
  onNavigateLoans?: () => void;
}

export function OverviewView({
  engine,
  sheets,
  market,
  scope,
  currency,
  fundingFilter = "ALL",
  leverage,
  onNavigateMdd,
  onNavigateLoans,
}: OverviewViewProps) {
  const [range, setRange] = useState<TimeRangePreset>("1Y");
  const [enabledBenchmarks, setEnabledBenchmarks] = useState<Record<string, boolean>>({
    VT: true,
    "0050": true,
    VOO: false,
  });

  const activeSeries =
    scope === "total" ? engine.totalSeries : engine.investedSeries;

  const { points, drawdownSummary, rangeTwr } = useMemo(
    () => sliceSeriesByRange(activeSeries, range),
    [activeSeries, range]
  );

  const periodMd = useMemo(() => {
    if (points.length < 2) return 0;
    const perf = computePeriodPerformance({
      startDate: points[0].date,
      endDate: points[points.length - 1].date,
      transactions: sheets.transactions,
      assets: sheets.assets,
      market,
      dailySeries: activeSeries,
      scope,
    });
    return perf.modifiedDietz;
  }, [points, sheets, market, activeSeries, scope]);

  const activeBenchmarks = useMemo(
    () =>
      BENCHMARK_STYLES.filter(
        (b) => enabledBenchmarks[b.symbol] && Boolean(market.tickers[b.symbol])
      ),
    [enabledBenchmarks, market]
  );

  const benchmarkCurves = useMemo(
    () =>
      buildNormalizedBenchmarkCurves({
        portfolioPoints: points,
        benchmarks: sheets.benchmarks,
        market,
      }),
    [points, sheets.benchmarks, market]
  );

  const totalDisplayVal =
    scope === "total"
      ? engine.totalInvestedValueTwd + engine.totalCashValueTwd
      : engine.totalInvestedValueTwd;

  const unrealizedPnl =
    engine.totalInvestedValueTwd - engine.totalCostBasisTwd;
  const unrealizedPct =
    engine.totalCostBasisTwd > 0 ? unrealizedPnl / engine.totalCostBasisTwd : 0;

  const ddStatus =
    drawdownSummary.currentDrawdown > -0.03
      ? { label: "接近新高", variant: "success" as const, color: "var(--success)" }
      : drawdownSummary.currentDrawdown > -0.1
        ? { label: "輕度回檔", variant: "warning" as const, color: "var(--warning)" }
        : { label: "深度水下", variant: "danger" as const, color: "var(--danger)" };

  const allocationDenominator = Math.max(1, totalDisplayVal);
  const allocationItems =
    scope === "total"
      ? [
          {
            label: "美股部位 (US)",
            value: engine.totalUsValueTwd,
            pct: (engine.totalUsValueTwd / allocationDenominator) * 100,
            color: "var(--chart-1)",
          },
          {
            label: "台股部位 (TW)",
            value: engine.totalTwValueTwd,
            pct: (engine.totalTwValueTwd / allocationDenominator) * 100,
            color: "var(--chart-2)",
          },
          {
            label: "現金快照 (Cash)",
            value: engine.totalCashValueTwd,
            pct: (engine.totalCashValueTwd / allocationDenominator) * 100,
            color: "var(--chart-5)",
          },
        ]
      : [
          {
            label: "美股部位 (US)",
            value: engine.totalUsValueTwd,
            pct: (engine.totalUsValueTwd / allocationDenominator) * 100,
            color: "var(--chart-1)",
          },
          {
            label: "台股部位 (TW)",
            value: engine.totalTwValueTwd,
            pct: (engine.totalTwValueTwd / allocationDenominator) * 100,
            color: "var(--chart-2)",
          },
        ];

  return (
    <div className="space-y-5">
      {/* Header + Time Range Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold">總覽與水下風控儀表板</h2>
            {fundingFilter !== "ALL" && (
              <Badge variant="default">資金篩選：#{fundingFilter}</Badge>
            )}
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            {scope === "total"
              ? "含現金全資產（台股 + 美股 + 現金快照）"
              : "純投資部位（台股 + 美股，精確剝離出入金）"}{" "}
            · 資料基準日 {engine.asOfDate} · USD/TWD{" "}
            <span className="font-mono">{engine.latestFxRate.toFixed(2)}</span>
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 text-xs">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-2.5 py-1 font-mono transition cursor-pointer ${
                range === r
                  ? "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>{scope === "total" ? "全資產總淨值" : "投資組合總市值"}</span>
            <Badge>{currency === "TWD" ? "TWD 含匯率" : "USD 折算"}</Badge>
          </div>
          <div className="font-mono text-2xl font-bold tracking-tight tabular-nums">
            {formatMoney(totalDisplayVal, currency, engine.latestFxRate)}
          </div>
          <div className="flex items-center justify-between text-xs">
            <span
              className="font-mono font-medium tabular-nums"
              style={{
                color: unrealizedPnl >= 0 ? "var(--success)" : "var(--danger)",
              }}
            >
              {formatMoney(unrealizedPnl, currency, engine.latestFxRate, {
                signed: true,
              })}{" "}
              ({formatPercent(unrealizedPct, { signed: true })})
            </span>
            <span className="text-[var(--muted-foreground)]">未實現損益</span>
          </div>
        </Card>

        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5" /> 時間加權報酬 (TWR)
            </span>
            <span className="font-mono">區間: {range}</span>
          </div>
          <div
            className="font-mono text-2xl font-bold tracking-tight tabular-nums"
            style={{ color: rangeTwr >= 0 ? "var(--success)" : "var(--danger)" }}
          >
            {formatPercent(rangeTwr, { signed: true })}
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--muted-foreground)]">
              Modified Dietz (日加權)
            </span>
            <span className="font-mono font-semibold tabular-nums">
              {formatPercent(periodMd, { signed: true })}
            </span>
          </div>
        </Card>

        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1">
              <TrendingDown className="h-3.5 w-3.5" /> 區間最大回撤 (MDD)
            </span>
            <Badge variant="danger">基於 TWR 指數</Badge>
          </div>
          <div className="font-mono text-2xl font-bold tracking-tight text-[var(--danger)] tabular-nums">
            {formatPercent(drawdownSummary.maxDrawdown)}
          </div>
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>谷底：{drawdownSummary.maxDrawdownDate || "—"}</span>
            <span>
              {drawdownSummary.recoveryDays === null
                ? "尚未修復"
                : drawdownSummary.recoveryDays === 0
                  ? "無回撤"
                  : `修復 ${drawdownSummary.recoveryDays} 天`}
            </span>
          </div>
        </Card>

        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1">
              <ShieldAlert className="h-3.5 w-3.5" /> 當前水下深度
            </span>
            <Badge variant={ddStatus.variant}>{ddStatus.label}</Badge>
          </div>
          <div
            className="font-mono text-2xl font-bold tracking-tight tabular-nums"
            style={{ color: ddStatus.color }}
          >
            {formatPercent(drawdownSummary.currentDrawdown)}
          </div>
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>前高：{drawdownSummary.currentPeakDate || "—"}</span>
            <span>
              {drawdownSummary.currentDaysUnderwater === 0
                ? "區間新高"
                : `水下 ${drawdownSummary.currentDaysUnderwater} 交易日`}
            </span>
          </div>
        </Card>
      </div>

      {/* Chart 1: TWR Wealth Index vs Benchmarks */}
      <Card className="p-4 lg:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold">
              累積 TWR 淨值曲線 vs. 市場基準（基準日 = 100 · TWD 含匯率）
            </h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              已排除出入金干擾，與含息基準（Adj Close + 歷史匯率）同基準比較
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)]/15 px-2.5 py-1 font-medium text-[var(--primary)]">
              <span className="h-0.5 w-2.5 bg-[var(--chart-1)]" />
              我的投組 (TWR)
            </span>
            {BENCHMARK_STYLES.map((b) => {
              const active = Boolean(enabledBenchmarks[b.symbol]);
              return (
                <button
                  key={b.symbol}
                  onClick={() =>
                    setEnabledBenchmarks((prev) => ({
                      ...prev,
                      [b.symbol]: !prev[b.symbol],
                    }))
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-1 transition cursor-pointer ${
                    active ? "opacity-100" : "opacity-40"
                  }`}
                >
                  <span
                    className="h-0.5 w-2.5"
                    style={{ backgroundColor: b.color }}
                  />
                  {b.label}
                </button>
              );
            })}
          </div>
        </div>
        <TwrBenchmarkChart
          points={points}
          benchmarkCurves={benchmarkCurves}
          activeBenchmarks={activeBenchmarks}
        />
      </Card>

      {/* Chart 2: Underwater Area Chart + Allocation */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2 p-4 lg:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold">
                全資產每日水下深度圖（Underwater Area Chart）
              </h3>
              <p className="text-xs text-[var(--muted-foreground)]">
                基於 TWR 淨值指數計算之每日距離波峰回撤深度（%），不受定期定額或賣出提領影響
              </p>
            </div>
            <span className="font-mono text-xs font-semibold text-[var(--danger)] tabular-nums">
              區間 MDD: {formatPercent(drawdownSummary.maxDrawdown)}
            </span>
          </div>
          <UnderwaterAreaChart points={points} summary={drawdownSummary} />
        </Card>

        <Card className="flex flex-col justify-between p-4 lg:p-5 space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-bold">資產配置與風控摘要</h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              各市場最新估值佔比與累積股息收入
            </p>
          </div>

          <div className="space-y-3.5">
            {allocationItems.map((item) => (
              <div key={item.label} className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="font-medium">{item.label}</span>
                  <span className="font-mono text-[var(--muted-foreground)] tabular-nums">
                    {formatMoney(item.value, currency, engine.latestFxRate)} (
                    {item.pct.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--muted)]">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(100, item.pct)}%`,
                      backgroundColor: item.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2 border-t border-[var(--border)] pt-3 text-xs">
            <div className="flex justify-between">
              <span className="text-[var(--muted-foreground)]">累積已領現金股利</span>
              <span className="font-mono font-semibold text-[var(--success)] tabular-nums">
                {formatMoney(
                  engine.cumulativeDividendsTwd,
                  currency,
                  engine.latestFxRate
                )}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted-foreground)]">歷史拆股自動對齊</span>
              <span className="inline-flex items-center gap-1 font-medium text-[var(--success)]">
                <CheckCircle2 className="h-3.5 w-3.5" /> 已啟用 (含 0050 1拆4)
              </span>
            </div>
            {fundingFilter === "ALL" && leverage && leverage.facilities.length > 0 && (
              <>
                <div className="flex justify-between border-t border-[var(--border)] pt-2">
                  <span className="text-[var(--muted-foreground)]">
                    自有淨值（扣剩餘信貸）
                  </span>
                  <span className="font-mono font-semibold tabular-nums">
                    {formatMoney(leverage.netWorthTwd, currency, engine.latestFxRate)}
                    {leverage.leverageRatio
                      ? ` (${leverage.leverageRatio.toFixed(2)}x)`
                      : ""}
                  </span>
                </div>
                {onNavigateLoans && (
                  <Button
                    variant="outline"
                    className="w-full justify-between"
                    onClick={onNavigateLoans}
                  >
                    <span>檢視信貸槓桿與 84 期攤還總覽</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                )}
              </>
            )}
            <Button
              variant="outline"
              className="mt-2 w-full justify-between"
              onClick={onNavigateMdd}
            >
              <span>前往個別標的即時 MDD 監控矩陣</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
