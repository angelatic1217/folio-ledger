"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePrivacy } from "@/lib/privacy/context";
import type { DailyPortfolioPoint } from "@/types/quant";
import type { CurrencyCode } from "@/types/sheet";

export interface PortfolioWealthPoint {
  date: string;
  netPrincipalTwd: number;
  displayPrincipalTwd: number;
  marketValueTwd: number;
  cumulativeDividendsTwd: number;
  totalWealthInclDivTwd: number;
}

interface BenchmarkStyle {
  symbol: string;
  label: string;
  color: string;
}

interface PortfolioWealthGrowthChartProps {
  mode: "wealth" | "compounding";
  wealthPoints: PortfolioWealthPoint[];
  twrPoints: DailyPortfolioPoint[];
  benchmarkCurves: Record<string, Map<string, number>>;
  activeBenchmarks: BenchmarkStyle[];
  includeDividends: boolean;
  currency: CurrencyCode;
  fxRate: number;
}

export function PortfolioWealthGrowthChart({
  mode,
  wealthPoints,
  twrPoints,
  benchmarkCurves,
  activeBenchmarks,
  includeDividends,
  currency,
  fxRate,
}: PortfolioWealthGrowthChartProps) {
  const { privacyMode, fmtMoney } = usePrivacy();
  const divisor = currency === "USD" ? fxRate || 32 : 1;

  const wealthData = useMemo(() => {
    if (wealthPoints.length === 0) return [];
    const step =
      wealthPoints.length > 360 ? Math.ceil(wealthPoints.length / 360) : 1;
    return wealthPoints
      .filter(
        (_, i) =>
          step === 1 || i === 0 || i === wealthPoints.length - 1 || i % step === 0
      )
      .map((pt) => {
        const valueTwd = includeDividends
          ? pt.totalWealthInclDivTwd
          : pt.marketValueTwd;
        return {
          date: pt.date,
          principalDisplay: Number((pt.displayPrincipalTwd / divisor).toFixed(2)),
          valueDisplay: Number((valueTwd / divisor).toFixed(2)),
          principalTwd: pt.netPrincipalTwd,
          valueTwd,
          dividendsTwd: pt.cumulativeDividendsTwd,
        };
      });
  }, [wealthPoints, includeDividends, divisor]);

  const compoundingData = useMemo(() => {
    if (twrPoints.length === 0) return [];
    const step = twrPoints.length > 360 ? Math.ceil(twrPoints.length / 360) : 1;
    return twrPoints
      .filter(
        (_, i) =>
          step === 1 || i === 0 || i === twrPoints.length - 1 || i % step === 0
      )
      .map((pt) => {
        const row: Record<string, string | number> = {
          date: pt.date,
          portfolio: Number((pt.twrIndex / 100).toFixed(4)),
        };
        for (const b of activeBenchmarks) {
          const v = benchmarkCurves[b.symbol]?.get(pt.date);
          if (v !== undefined) {
            row[b.symbol] = Number((v / 100).toFixed(4));
          }
        }
        return row;
      });
  }, [twrPoints, activeBenchmarks, benchmarkCurves]);

  if (mode === "wealth") {
    if (wealthData.length === 0) {
      return (
        <div className="flex h-[280px] items-center justify-center text-xs text-[var(--muted-foreground)]">
          尚無足夠的交易與行情資料可繪製財富成長曲線
        </div>
      );
    }

    return (
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={wealthData}
            margin={{ top: 10, right: 18, left: 6, bottom: 4 }}
          >
            <defs>
              <linearGradient id="portfolioWealthGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.32} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              minTickGap={64}
            />
            <YAxis
              tickFormatter={(v: number) => {
                if (privacyMode) return "•••";
                const prefix = currency === "TWD" ? "NT$" : "$";
                if (Math.abs(v) >= 1_000_000) {
                  return `${prefix}${(v / 1_000_000).toFixed(1)}M`;
                }
                if (Math.abs(v) >= 1_000) {
                  return `${prefix}${Math.round(v / 1_000)}k`;
                }
                return `${prefix}${Math.round(v)}`;
              }}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={70}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const d = payload[0].payload as {
                  date: string;
                  principalTwd: number;
                  valueTwd: number;
                  dividendsTwd: number;
                };
                const gainTwd = d.valueTwd - d.principalTwd;
                const pct =
                  d.principalTwd > 1e-6 ? (gainTwd / d.principalTwd) * 100 : null;
                return (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs shadow-lg space-y-1">
                    <div className="font-mono font-semibold">{d.date}</div>
                    <div className="flex justify-between gap-4">
                      <span className="text-[var(--muted-foreground)]">
                        {includeDividends ? "含息總財富" : "投資組合市值"}
                      </span>
                      <span className="font-mono font-semibold tabular-nums">
                        {fmtMoney(d.valueTwd, currency, fxRate)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-[var(--muted-foreground)]">
                        淨投入資金（實投）
                      </span>
                      <span className="font-mono tabular-nums text-[var(--muted-foreground)]">
                        {d.principalTwd >= 0
                          ? fmtMoney(d.principalTwd, currency, fxRate)
                          : `已回本 (${fmtMoney(d.principalTwd, currency, fxRate, { signed: true })})`}
                      </span>
                    </div>
                    {includeDividends && d.dividendsTwd > 1 && (
                      <div className="flex justify-between gap-4">
                        <span className="text-[var(--muted-foreground)]">
                          其中累積現金股息
                        </span>
                        <span className="font-mono tabular-nums text-[var(--success)]">
                          +{fmtMoney(d.dividendsTwd, currency, fxRate)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between gap-4 border-t border-[var(--border)] pt-1">
                      <span className="text-[var(--muted-foreground)]">
                        {includeDividends ? "累積總獲利" : "帳面價差"}
                      </span>
                      <span
                        className="font-mono font-bold tabular-nums"
                        style={{
                          color:
                            gainTwd >= 0 ? "var(--success)" : "var(--danger)",
                        }}
                      >
                        {fmtMoney(gainTwd, currency, fxRate, { signed: true })}
                        {pct !== null
                          ? ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`
                          : ""}
                      </span>
                    </div>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="valueDisplay"
              name={includeDividends ? "含息總財富" : "投資組合市值"}
              stroke="var(--chart-1)"
              strokeWidth={2.2}
              fill="url(#portfolioWealthGrad)"
              isAnimationActive={false}
            />
            <Line
              type="stepAfter"
              dataKey="principalDisplay"
              name="淨投入本金"
              stroke="var(--muted-foreground)"
              strokeWidth={1.7}
              strokeDasharray="5 3"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Compounding Multiple Mode (1.00x = start of selected window)
  if (compoundingData.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center text-xs text-[var(--muted-foreground)]">
        尚無足夠的淨值資料可繪製複利倍數曲線
      </div>
    );
  }

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={compoundingData}
          margin={{ top: 10, right: 18, left: 6, bottom: 4 }}
        >
          <defs>
            <linearGradient id="portfolioCompGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--success)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--success)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={64}
          />
          <YAxis
            tickFormatter={(v: number) => `${v.toFixed(2)}x`}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <ReferenceLine y={1} stroke="var(--border)" strokeDasharray="4 3" />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null;
              return (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs shadow-lg space-y-1">
                  <div className="font-mono font-semibold">{String(label)}</div>
                  {payload.map((entry) => {
                    const mult = Number(entry.value ?? 1);
                    const pct = (mult - 1) * 100;
                    return (
                      <div
                        key={String(entry.dataKey)}
                        className="flex items-center justify-between gap-4"
                      >
                        <span className="inline-flex items-center gap-1.5 text-[var(--muted-foreground)]">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: entry.color }}
                          />
                          {entry.name}
                        </span>
                        <span className="font-mono font-semibold tabular-nums">
                          {mult.toFixed(2)}x ({pct >= 0 ? "+" : ""}
                          {pct.toFixed(1)}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="portfolio"
            name="我的投組 (TWR)"
            stroke="var(--success)"
            strokeWidth={2.2}
            fill="url(#portfolioCompGrad)"
            isAnimationActive={false}
          />
          {activeBenchmarks.map((b) => (
            <Line
              key={b.symbol}
              type="monotone"
              dataKey={b.symbol}
              name={b.label}
              stroke={b.color}
              strokeWidth={1.6}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
