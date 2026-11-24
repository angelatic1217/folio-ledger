"use client";

import {
  Activity,
  ArrowRight,
  CalendarRange,
  CheckCircle2,
  Coins,
  Layers,
  Scale,
} from "lucide-react";
import { useMemo, useState } from "react";
import { PortfolioWealthGrowthChart } from "@/components/charts/PortfolioWealthGrowthChart";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { usePrivacy } from "@/lib/privacy/context";
import { diffCalendarDays } from "@/lib/quant/calendar";
import {
  buildNormalizedBenchmarkCurves,
  computePortfolioCapitalMetrics,
  sliceSeriesByRange,
} from "@/lib/quant/engine";
import { computeAnnualizedReturn } from "@/lib/quant/returns";
import { computeSubsetAggregateXirr } from "@/lib/quant/symbol-performance";
import { formatPercent } from "@/lib/utils";
import type { MarketDataBundle } from "@/types/market";
import type {
  PortfolioLeverageSummary,
  PortfolioScope,
  QuantEngineOutput,
  TimeRangePreset,
} from "@/types/quant";
import type { CurrencyCode, PortfolioSheetsData } from "@/types/sheet";

type ChartMode = "wealth" | "compounding";

const LONG_TERM_RANGES: TimeRangePreset[] = ["YTD", "1Y", "3Y", "ALL"];

const BENCHMARK_STYLES: Array<{ symbol: string; label: string; color: string }> = [
  { symbol: "VT", label: "VT (全球)", color: "var(--chart-2)" },
  { symbol: "0050", label: "0050 (台股)", color: "var(--chart-3)" },
  { symbol: "VOO", label: "VOO (美股)", color: "var(--chart-4)" },
];

const WEIGHT_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function formatTenure(days: number): string {
  if (days <= 0) return "—";
  if (days < 365) return `${days} 天`;
  return `${(days / 365).toFixed(1)} 年`;
}

interface OverviewReturnsTabProps {
  engine: QuantEngineOutput;
  sheets: PortfolioSheetsData;
  market: MarketDataBundle;
  scope: PortfolioScope;
  currency: CurrencyCode;
  fundingFilter?: string;
  leverage?: PortfolioLeverageSummary | null;
  onNavigateMdd: () => void;
  onNavigateLoans?: () => void;
  onNavigateAnnual?: () => void;
}

export function OverviewReturnsTab({
  engine,
  sheets,
  market,
  scope,
  currency,
  fundingFilter = "ALL",
  leverage,
  onNavigateMdd,
  onNavigateLoans,
  onNavigateAnnual,
}: OverviewReturnsTabProps) {
  const { fmtMoney, fmtShares } = usePrivacy();
  const [range, setRange] = useState<TimeRangePreset>("ALL");
  const [chartMode, setChartMode] = useState<ChartMode>("wealth");
  const [includeDividends, setIncludeDividends] = useState(true);
  const [enabledBenchmarks, setEnabledBenchmarks] = useState<Record<string, boolean>>({
    VT: true,
    "0050": true,
    VOO: false,
  });

  const activeSeries =
    scope === "total" ? engine.totalSeries : engine.investedSeries;

  const { points: twrPoints } = useMemo(
    () => sliceSeriesByRange(activeSeries, range),
    [activeSeries, range]
  );

  // Build cumulative net principal vs wealth series aligned with activeSeries
  const capitalMetrics = useMemo(
    () => computePortfolioCapitalMetrics(activeSeries, scope),
    [activeSeries, scope]
  );

  const rangedWealthPoints = useMemo(() => {
    if (capitalMetrics.points.length === 0 || twrPoints.length === 0) return [];
    const startDate = twrPoints[0].date;
    return capitalMetrics.points.filter((p) => p.date >= startDate);
  }, [capitalMetrics.points, twrPoints]);

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
        portfolioPoints: twrPoints,
        benchmarks: sheets.benchmarks,
        market,
      }),
    [twrPoints, sheets.benchmarks, market]
  );

  // Portfolio-level index-investing metrics (XIRR, MOIC, Total P&L, All-time CAGR/Vol/Calmar)
  const metrics = useMemo(() => {
    const perfRows = engine.symbolPerformance;
    let totalInvestedTwd = 0;
    let totalRealizedTwd = 0;
    let totalDripSymbols = 0;
    const allSymbolSet = new Set<string>();

    for (const r of perfRows) {
      allSymbolSet.add(r.symbol);
      totalInvestedTwd += r.totalInvestedTwd;
      totalRealizedTwd += r.realizedPnlTwd;
      if (r.dripShares > 1e-5) totalDripSymbols++;
    }

    const totalOpenCostTwd = engine.totalCostBasisTwd;
    const netPrincipalTwd = capitalMetrics.netPrincipalTwd;
    const capitalBaseTwd =
      capitalMetrics.effectiveCapitalBaseTwd > 1e-6
        ? capitalMetrics.effectiveCapitalBaseTwd
        : totalInvestedTwd;

    const totalUnrealizedTwd = engine.totalInvestedValueTwd - totalOpenCostTwd;
    const unrealizedPct =
      totalOpenCostTwd > 1e-6 ? totalUnrealizedTwd / totalOpenCostTwd : null;
    const totalDividendsTwd = engine.cumulativeDividendsTwd;
    const totalPnlTwd =
      totalUnrealizedTwd + totalRealizedTwd + totalDividendsTwd;
    const totalReturnPct =
      capitalBaseTwd > 1e-6 ? totalPnlTwd / capitalBaseTwd : null;
    const wealthMultiple =
      capitalBaseTwd > 1e-6
        ? (capitalBaseTwd + totalPnlTwd) / capitalBaseTwd
        : null;
    const dividendRecoveryPct =
      capitalBaseTwd > 1e-6 ? totalDividendsTwd / capitalBaseTwd : 0;

    const portfolioXirr = computeSubsetAggregateXirr({
      symbols: allSymbolSet,
      rows: perfRows,
      transactions: sheets.transactions,
      assets: sheets.assets,
      market,
      asOfDate: engine.asOfDate,
      latestFxRate: engine.latestFxRate,
      currency,
    });

    // All-time TWR CAGR, Annualized Volatility, Max Drawdown & Calmar Ratio
    let spanDays = 0;
    let firstDate: string | null = null;
    let allTimeTwr = 0;
    let allTimeCagr: number | null = null;
    let allTimeVol: number | null = null;
    let allTimeMdd = 0;
    let allTimeCalmar: number | null = null;

    if (activeSeries.length >= 2) {
      firstDate = activeSeries[0].date;
      const lastDate = activeSeries[activeSeries.length - 1].date;
      spanDays = Math.max(0, diffCalendarDays(firstDate, lastDate));
      const baseIdx = activeSeries[0].twrIndex || 100;
      const endIdx = activeSeries[activeSeries.length - 1].twrIndex;
      allTimeTwr = endIdx / baseIdx - 1;
      allTimeCagr = computeAnnualizedReturn(allTimeTwr, spanDays);

      const dailyReturns: number[] = [];
      for (let i = 1; i < activeSeries.length; i++) {
        dailyReturns.push(activeSeries[i].dailyReturn);
        if (activeSeries[i].drawdown < allTimeMdd) {
          allTimeMdd = activeSeries[i].drawdown;
        }
      }
      if (dailyReturns.length >= 20) {
        const mean =
          dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
        const variance =
          dailyReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) /
          (dailyReturns.length - 1);
        allTimeVol = Math.sqrt(variance) * Math.sqrt(252);
      }
      if (allTimeCagr !== null && Math.abs(allTimeMdd) > 1e-4) {
        allTimeCalmar = allTimeCagr / Math.abs(allTimeMdd);
      }
    }

    return {
      totalInvestedTwd,
      totalOpenCostTwd,
      netPrincipalTwd,
      capitalBaseTwd,
      totalUnrealizedTwd,
      unrealizedPct,
      totalRealizedTwd,
      totalDividendsTwd,
      totalPnlTwd,
      totalReturnPct,
      wealthMultiple,
      dividendRecoveryPct,
      totalDripSymbols,
      portfolioXirr,
      spanDays,
      firstDate,
      allTimeTwr,
      allTimeCagr,
      allTimeVol,
      allTimeMdd,
      allTimeCalmar,
    };
  }, [engine, sheets, market, currency, activeSeries, capitalMetrics]);

  const heldRows = useMemo(
    () =>
      engine.symbolPerformance
        .filter((r) => r.held)
        .sort((a, b) => b.marketValueTwd - a.marketValueTwd),
    [engine.symbolPerformance]
  );

  const recentAnnualRows = useMemo(() => {
    const allAnnual = engine.annualByScope.ALL ?? [];
    return [...allAnnual].reverse().slice(0, 6);
  }, [engine.annualByScope]);

  const totalDisplayVal =
    scope === "total"
      ? engine.totalInvestedValueTwd + engine.totalCashValueTwd
      : engine.totalInvestedValueTwd;

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
      {/* 4 Index-Investing KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" />
              {scope === "total" ? "全資產總淨值" : "投資組合總市值"}
            </span>
            <Badge variant="outline">
              {metrics.spanDays > 0
                ? `已複利 ${formatTenure(metrics.spanDays)}`
                : currency}
            </Badge>
          </div>
          <div className="font-mono text-2xl font-bold tracking-tight tabular-nums">
            {fmtMoney(totalDisplayVal, currency, engine.latestFxRate)}
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[var(--muted-foreground)]">
                淨投入資金（實投本金）
              </span>
              <span className="font-mono font-semibold tabular-nums">
                {metrics.netPrincipalTwd >= 0
                  ? fmtMoney(metrics.netPrincipalTwd, currency, engine.latestFxRate)
                  : `已回本 (${fmtMoney(metrics.netPrincipalTwd, currency, engine.latestFxRate, { signed: true, compact: true })})`}
              </span>
            </div>
            <div className="flex items-center justify-between text-[0.72rem] text-[var(--muted-foreground)]">
              <span>目前持倉成本（含換股）</span>
              <span className="font-mono tabular-nums">
                {fmtMoney(metrics.totalOpenCostTwd, currency, engine.latestFxRate)}
              </span>
            </div>
          </div>
        </Card>

        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1.5">
              <Coins className="h-3.5 w-3.5" /> 總含息損益（對實投資金）
            </span>
            {metrics.wealthMultiple !== null && (
              <Badge variant={metrics.wealthMultiple >= 1 ? "success" : "danger"}>
                {metrics.wealthMultiple.toFixed(2)}x MOIC
              </Badge>
            )}
          </div>
          <div
            className="font-mono text-2xl font-bold tracking-tight tabular-nums"
            style={{
              color:
                metrics.totalPnlTwd >= 0 ? "var(--success)" : "var(--danger)",
            }}
          >
            {fmtMoney(metrics.totalPnlTwd, currency, engine.latestFxRate, {
              signed: true,
            })}
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[var(--muted-foreground)]">
                對實投含息報酬率
              </span>
              <span
                className="font-mono font-semibold tabular-nums"
                style={{
                  color:
                    (metrics.totalReturnPct ?? 0) >= 0
                      ? "var(--success)"
                      : "var(--danger)",
                }}
              >
                {formatPercent(metrics.totalReturnPct, { signed: true })}
              </span>
            </div>
            <div className="flex items-center justify-between text-[0.72rem] text-[var(--muted-foreground)]">
              <span>
                帳面未實現{" "}
                {fmtMoney(metrics.totalUnrealizedTwd, currency, engine.latestFxRate, {
                  signed: true,
                  compact: true,
                })}
                {metrics.unrealizedPct !== null
                  ? ` (${formatPercent(metrics.unrealizedPct, { signed: true })})`
                  : ""}
              </span>
              <span className="font-mono tabular-nums">
                {Math.abs(metrics.totalRealizedTwd) > 1
                  ? `已實現 ${fmtMoney(metrics.totalRealizedTwd, currency, engine.latestFxRate, { signed: true, compact: true })}`
                  : `息 ${fmtMoney(metrics.totalDividendsTwd, currency, engine.latestFxRate, { compact: true })}`}
              </span>
            </div>
          </div>
        </Card>

        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1.5">
              <Scale className="h-3.5 w-3.5" /> 個人年化報酬 (XIRR)
            </span>
            <Badge variant="default">資金加權</Badge>
          </div>
          <div
            className="font-mono text-2xl font-bold tracking-tight tabular-nums"
            style={{
              color:
                metrics.portfolioXirr === null
                  ? "var(--muted-foreground)"
                  : metrics.portfolioXirr >= 0
                    ? "var(--success)"
                    : "var(--danger)",
            }}
          >
            {formatPercent(metrics.portfolioXirr, { signed: true })}
          </div>
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>全期 TWR 年化 (CAGR)</span>
            <span
              className="font-mono font-semibold tabular-nums"
              style={{
                color:
                  metrics.allTimeCagr === null
                    ? "var(--muted-foreground)"
                    : metrics.allTimeCagr >= 0
                      ? "var(--success)"
                      : "var(--danger)",
              }}
            >
              {formatPercent(metrics.allTimeCagr, { signed: true })}
            </span>
          </div>
        </Card>

        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" /> 長期複利體質
            </span>
            <Badge variant="outline">
              {metrics.allTimeCalmar !== null
                ? `Calmar ${metrics.allTimeCalmar.toFixed(2)}`
                : "全期追蹤"}
            </Badge>
          </div>
          <div
            className="font-mono text-2xl font-bold tracking-tight tabular-nums"
            style={{
              color:
                metrics.allTimeTwr >= 0 ? "var(--success)" : "var(--danger)",
            }}
          >
            {formatPercent(metrics.allTimeTwr, { signed: true })}
          </div>
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>
              波動{" "}
              <span className="font-mono">
                {metrics.allTimeVol !== null
                  ? `${(metrics.allTimeVol * 100).toFixed(1)}%`
                  : "—"}
              </span>{" "}
              · MDD{" "}
              <span className="font-mono text-[var(--danger)]">
                {formatPercent(metrics.allTimeMdd)}
              </span>
            </span>
            <span className="font-mono">
              {metrics.firstDate ? `自 ${metrics.firstDate.slice(0, 7)}` : "—"}
            </span>
          </div>
        </Card>
      </div>

      {/* Main Chart: Portfolio Wealth Growth vs Net Principal / Long-term Compounding Multiple */}
      <Card className="p-4 lg:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold">
              {chartMode === "wealth"
                ? "投入本金 vs. 累積總財富（雪球成長軌跡）"
                : "長期含息複利倍數 vs. 市場指數基準（起點 = 1.00x）"}
            </h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              {chartMode === "wealth"
                ? "虛線為累計淨投入資金（買入 − 賣出，不受換股墊高帳面成本影響），實線為投資組合總財富"
                : "將區間起點標準化為 1.00x，與含息還原市場指數（Adj Close + 歷史匯率）對照複利成長速度"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Chart Mode Toggle */}
            <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5">
              <button
                onClick={() => setChartMode("wealth")}
                className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                  chartMode === "wealth"
                    ? "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                本金 vs 財富
              </button>
              <button
                onClick={() => setChartMode("compounding")}
                className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                  chartMode === "compounding"
                    ? "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                複利倍數 vs 大盤
              </button>
            </div>

            {/* Range Selector (Default ALL for long-term index investing) */}
            <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5">
              {LONG_TERM_RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`rounded-md px-2 py-1 font-mono transition cursor-pointer ${
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
        </div>

        {/* Sub-controls Row */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          {chartMode === "wealth" ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-[var(--muted-foreground)]">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--chart-1)]" />
                {includeDividends ? "含息總財富（市值＋累積現金股息）" : "投資組合市值"}
              </span>
              <span className="inline-flex items-center gap-1.5 text-[var(--muted-foreground)]">
                <span className="h-0.5 w-3 border-t-2 border-dashed border-[var(--muted-foreground)]" />
                淨投入資金（排除換股墊高）
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--success)]/15 px-2.5 py-1 font-medium text-[var(--success)]">
                <span className="h-0.5 w-2.5 bg-[var(--success)]" />
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
          )}

          {chartMode === "wealth" && (
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              <input
                type="checkbox"
                checked={includeDividends}
                onChange={(e) => setIncludeDividends(e.target.checked)}
                className="accent-[var(--primary)] cursor-pointer"
              />
              <span>財富曲線計入累積現金股息</span>
            </label>
          )}
        </div>

        <PortfolioWealthGrowthChart
          mode={chartMode}
          wealthPoints={rangedWealthPoints}
          twrPoints={twrPoints}
          benchmarkCurves={benchmarkCurves}
          activeBenchmarks={activeBenchmarks}
          includeDividends={includeDividends}
          currency={currency}
          fxRate={engine.latestFxRate}
        />
      </Card>

      {/* Bottom 2-Column Index-Investing Panels */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Left (2 cols): Core Holdings Snapshot */}
        <Card className="xl:col-span-2 overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3.5">
              <div>
                <h3 className="text-sm font-bold">核心持倉配置與報酬貢獻</h3>
                <p className="text-xs text-[var(--muted-foreground)]">
                  目前持有 {heldRows.length} 檔標的，依最新市值權重排序（點擊右上前往完整成本、含息兩平與個股鑽取）
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={onNavigateMdd}>
                <span>全部個別標的報酬</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Portfolio Holding Weight Bar */}
            {heldRows.length > 0 && (
              <div className="border-b border-[var(--border)] px-4 py-3 space-y-2">
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--muted)]">
                  {heldRows.map((row, idx) => (
                    <div
                      key={row.symbol}
                      style={{
                        width: `${Math.max(0.6, row.weightPct)}%`,
                        backgroundColor:
                          WEIGHT_COLORS[idx % WEIGHT_COLORS.length],
                      }}
                      title={`${row.symbol}: ${row.weightPct.toFixed(1)}%`}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.72rem]">
                  {heldRows.slice(0, 6).map((row, idx) => (
                    <span
                      key={row.symbol}
                      className="inline-flex items-center gap-1.5 font-mono"
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{
                          backgroundColor:
                            WEIGHT_COLORS[idx % WEIGHT_COLORS.length],
                        }}
                      />
                      <span className="font-semibold">{row.symbol}</span>
                      <span className="text-[var(--muted-foreground)]">
                        {row.weightPct.toFixed(1)}%
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-[var(--muted-foreground)]">
                    <th className="px-4 py-2.5 font-semibold">標的 / 年資</th>
                    <th className="px-3 py-2.5 text-right font-semibold">配置權重</th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      市值 / 成本
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      未實現損益
                    </th>
                    <th className="px-4 py-2.5 text-right font-semibold">
                      個人年化 (XIRR)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {heldRows.map((row, idx) => {
                    const rowXirr =
                      currency === "TWD" ? row.xirrTwd : row.xirrUsd;
                    const unrealPct =
                      currency === "USD" && row.currency === "USD"
                        ? row.unrealizedPnlPctLocal
                        : row.unrealizedPnlPctTwd;

                    return (
                      <tr
                        key={row.symbol}
                        onClick={onNavigateMdd}
                        className="cursor-pointer transition hover:bg-[var(--muted)]/40"
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{
                                backgroundColor:
                                  WEIGHT_COLORS[idx % WEIGHT_COLORS.length],
                              }}
                            />
                            <span className="font-mono font-bold">
                              {row.symbol}
                            </span>
                            <Badge variant="outline">{row.market}</Badge>
                          </div>
                          <div className="mt-0.5 text-[0.72rem] text-[var(--muted-foreground)]">
                            {row.name}
                            {row.holdingDays > 0 && (
                              <span className="ml-1.5 font-mono opacity-80">
                                · {formatTenure(row.holdingDays)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                          <div className="font-semibold">
                            {row.weightPct.toFixed(1)}%
                          </div>
                          <div className="text-[0.72rem] text-[var(--muted-foreground)]">
                            {fmtShares(row.shares, { maxDigits: 2 })} 股
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                          <div className="font-semibold">
                            {fmtMoney(row.marketValueTwd, currency, engine.latestFxRate)}
                          </div>
                          <div className="text-[0.72rem] text-[var(--muted-foreground)]">
                            成本{" "}
                            {fmtMoney(row.costBasisTwd, currency, engine.latestFxRate)}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                          <div
                            className="font-semibold"
                            style={{
                              color:
                                row.unrealizedPnlTwd >= 0
                                  ? "var(--success)"
                                  : "var(--danger)",
                            }}
                          >
                            {fmtMoney(
                              row.unrealizedPnlTwd,
                              currency,
                              engine.latestFxRate,
                              { signed: true }
                            )}
                          </div>
                          <div
                            className="text-[0.72rem]"
                            style={{
                              color:
                                (unrealPct ?? 0) >= 0
                                  ? "var(--success)"
                                  : "var(--danger)",
                            }}
                          >
                            {formatPercent(unrealPct, { signed: true })}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                          <span
                            className="font-bold"
                            style={{
                              color:
                                rowXirr === null
                                  ? "var(--muted-foreground)"
                                  : rowXirr >= 0
                                    ? "var(--success)"
                                    : "var(--danger)",
                            }}
                          >
                            {rowXirr !== null
                              ? formatPercent(rowXirr, { signed: true })
                              : row.holdingDays < 30
                                ? "未滿 30 天"
                                : "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {heldRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-8 text-center text-[var(--muted-foreground)]"
                      >
                        目前篩選條件下尚無持有中標的
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Card>

        {/* Right (1 col): Market Allocation + Annual Compounding Rhythm + Cashflow Summary */}
        <Card className="flex flex-col justify-between p-4 lg:p-5 space-y-4">
          <div className="space-y-4">
            {/* Market Allocation */}
            <div className="space-y-2.5">
              <div>
                <h3 className="text-sm font-bold">市場配置與複利節奏</h3>
                <p className="text-xs text-[var(--muted-foreground)]">
                  台美股權重結構與歷年 TWR 紀律軌跡
                </p>
              </div>
              {allocationItems.map((item) => (
                <div key={item.label} className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="font-medium">{item.label}</span>
                    <span className="font-mono text-[var(--muted-foreground)] tabular-nums">
                      {fmtMoney(item.value, currency, engine.latestFxRate)} (
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

            {/* Annual Compounding Mini Ledger */}
            {recentAnnualRows.length > 0 && (
              <div className="space-y-2 border-t border-[var(--border)] pt-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <CalendarRange className="h-3.5 w-3.5 text-[var(--primary)]" />
                    歷年複利成績單 (TWR)
                  </span>
                  <span className="font-mono text-[0.7rem] text-[var(--muted-foreground)]">
                    vs {recentAnnualRows[0]?.benchmarkSymbol ?? "基準"}
                  </span>
                </div>
                <div className="space-y-1.5 text-xs">
                  {recentAnnualRows.map((yr) => (
                    <div
                      key={yr.year}
                      className="flex items-center justify-between rounded-md bg-[var(--muted)]/40 px-2.5 py-1.5 font-mono tabular-nums"
                    >
                      <span className="font-semibold">{yr.year}</span>
                      <div className="flex items-center gap-3">
                        <span
                          className="font-semibold"
                          style={{
                            color:
                              yr.twr >= 0 ? "var(--success)" : "var(--danger)",
                          }}
                        >
                          {formatPercent(yr.twr, { signed: true })}
                        </span>
                        {yr.alpha !== null && (
                          <span
                            className="text-[0.72rem]"
                            style={{
                              color:
                                yr.alpha >= 0
                                  ? "var(--success)"
                                  : "var(--muted-foreground)",
                            }}
                          >
                            α {formatPercent(yr.alpha, { signed: true })}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Long-term Summary Footer & Navigation */}
          <div className="space-y-2 border-t border-[var(--border)] pt-3 text-xs">
            <div className="flex justify-between">
              <span className="text-[var(--muted-foreground)]">累積已領現金股利</span>
              <span className="font-mono font-semibold text-[var(--success)] tabular-nums">
                {fmtMoney(metrics.totalDividendsTwd, currency, engine.latestFxRate)}
                {metrics.dividendRecoveryPct > 0.001
                  ? ` (${(metrics.dividendRecoveryPct * 100).toFixed(1)}%)`
                  : ""}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted-foreground)]">已實現損益</span>
              <span
                className="font-mono font-semibold tabular-nums"
                style={{
                  color:
                    metrics.totalRealizedTwd >= 0
                      ? "var(--success)"
                      : "var(--danger)",
                }}
              >
                {fmtMoney(metrics.totalRealizedTwd, currency, engine.latestFxRate, {
                  signed: true,
                })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted-foreground)]">歷史拆股 / DRIP 追蹤</span>
              <span className="inline-flex items-center gap-1 font-medium text-[var(--success)]">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {metrics.totalDripSymbols > 0
                  ? `${metrics.totalDripSymbols} 檔 DRIP 複利中`
                  : "已自動對齊"}
              </span>
            </div>

            {fundingFilter === "ALL" && leverage && leverage.facilities.length > 0 && (
              <div className="flex justify-between border-t border-[var(--border)] pt-2">
                <span className="text-[var(--muted-foreground)]">
                  自有淨值（扣剩餘信貸）
                </span>
                <span className="font-mono font-semibold tabular-nums">
                  {fmtMoney(leverage.netWorthTwd, currency, engine.latestFxRate)}
                  {leverage.leverageRatio
                    ? ` (${leverage.leverageRatio.toFixed(2)}x)`
                    : ""}
                </span>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-1">
              {onNavigateAnnual && (
                <Button
                  variant="outline"
                  className="w-full justify-between"
                  onClick={onNavigateAnnual}
                >
                  <span>檢視完整歷年績效與市場 Alpha</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              )}
              {fundingFilter === "ALL" &&
                leverage &&
                leverage.facilities.length > 0 &&
                onNavigateLoans && (
                  <Button
                    variant="outline"
                    className="w-full justify-between"
                    onClick={onNavigateLoans}
                  >
                    <span>檢視信貸槓桿與 84 期攤還總覽</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
