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
import { addDaysIso } from "@/lib/quant/calendar";
import type { MddLookbackPreset, SymbolWealthPoint } from "@/types/quant";
import type { CurrencyCode } from "@/types/sheet";

interface SymbolWealthGrowthChartProps {
  mode: "wealth" | "compounding";
  wealthSeries: SymbolWealthPoint[];
  marketSeries: Array<{ date: string; adjClose: number }>;
  lookback: MddLookbackPreset;
  includeDividends: boolean;
  currency: CurrencyCode;
  fxRate: number;
}

export function SymbolWealthGrowthChart({
  mode,
  wealthSeries,
  marketSeries,
  lookback,
  includeDividends,
  currency,
  fxRate,
}: SymbolWealthGrowthChartProps) {
  const { privacyMode, fmtMoney } = usePrivacy();
  const divisor = currency === "USD" ? fxRate || 32 : 1;

  const wealthData = useMemo(() => {
    if (wealthSeries.length === 0) return [];
    const step =
      wealthSeries.length > 360 ? Math.ceil(wealthSeries.length / 360) : 1;
    return wealthSeries
      .filter(
        (_, i) =>
          step === 1 || i === 0 || i === wealthSeries.length - 1 || i % step === 0
      )
      .map((pt) => {
        const valueTwd = includeDividends
          ? pt.totalValueInclDivTwd
          : pt.marketValueTwd;
        return {
          date: pt.date,
          costDisplay: Number((pt.costBasisTwd / divisor).toFixed(2)),
          valueDisplay: Number((valueTwd / divisor).toFixed(2)),
          costTwd: pt.costBasisTwd,
          valueTwd,
          dividendsTwd: pt.cumulativeDividendsTwd,
        };
      });
  }, [wealthSeries, includeDividends, divisor]);

  const compoundingData = useMemo(() => {
    if (marketSeries.length < 2) return [];
    let effective = marketSeries;
    if (lookback !== "MAX") {
      const lookbackDays = lookback === "5Y" ? 365 * 5 : 365 * 10;
      const latestDate = marketSeries[marketSeries.length - 1].date;
      const cutoff = addDaysIso(latestDate, -lookbackDays);
      const sliced = marketSeries.filter((pt) => pt.date >= cutoff);
      effective = sliced.length >= 2 ? sliced : marketSeries;
    }

    const base = effective[0].adjClose || 1;
    const step = effective.length > 400 ? Math.ceil(effective.length / 400) : 1;
    return effective
      .filter(
        (_, i) =>
          step === 1 || i === 0 || i === effective.length - 1 || i % step === 0
      )
      .map((pt) => ({
        date: pt.date,
        index: Number(((pt.adjClose / base) * 100).toFixed(2)),
        multiple: Number((pt.adjClose / base).toFixed(2)),
      }));
  }, [marketSeries, lookback]);

  if (mode === "wealth") {
    if (wealthData.length === 0) {
      return (
        <div className="flex h-[240px] items-center justify-center text-xs text-[var(--muted-foreground)]">
          尚無該標的之歷史買進紀錄
        </div>
      );
    }

    return (
      <div className="h-[248px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={wealthData}
            margin={{ top: 10, right: 18, left: 4, bottom: 4 }}
          >
            <defs>
              <linearGradient id="symbolWealthGrad" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--chart-1)"
                  stopOpacity={0.32}
                />
                <stop
                  offset="100%"
                  stopColor="var(--chart-1)"
                  stopOpacity={0.03}
                />
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
              width={66}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const d = payload[0].payload as {
                  date: string;
                  costTwd: number;
                  valueTwd: number;
                  dividendsTwd: number;
                };
                const diffTwd = d.valueTwd - d.costTwd;
                const pct = d.costTwd > 1e-6 ? (diffTwd / d.costTwd) * 100 : null;
                return (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs shadow-lg space-y-1">
                    <div className="font-mono font-semibold">{d.date}</div>
                    <div className="flex justify-between gap-4">
                      <span className="text-[var(--muted-foreground)]">
                        {includeDividends ? "含息總價值" : "持倉市值"}
                      </span>
                      <span className="font-mono font-semibold tabular-nums">
                        {fmtMoney(d.valueTwd, currency, fxRate)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-[var(--muted-foreground)]">
                        投入成本
                      </span>
                      <span className="font-mono tabular-nums text-[var(--muted-foreground)]">
                        {fmtMoney(d.costTwd, currency, fxRate)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4 border-t border-[var(--border)] pt-1">
                      <span className="text-[var(--muted-foreground)]">
                        {includeDividends ? "含息淨損益" : "未實現損益"}
                      </span>
                      <span
                        className="font-mono font-bold tabular-nums"
                        style={{
                          color:
                            diffTwd >= 0 ? "var(--success)" : "var(--danger)",
                        }}
                      >
                        {fmtMoney(diffTwd, currency, fxRate, { signed: true })}
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
              name={includeDividends ? "含息總價值" : "持倉市值"}
              stroke="var(--chart-1)"
              strokeWidth={2}
              fill="url(#symbolWealthGrad)"
              isAnimationActive={false}
            />
            <Line
              type="stepAfter"
              dataKey="costDisplay"
              name="投入成本"
              stroke="var(--muted-foreground)"
              strokeWidth={1.6}
              strokeDasharray="5 3"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Compounding Mode (Normalized Adj Close = 100)
  if (compoundingData.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center text-xs text-[var(--muted-foreground)]">
        歷史行情資料不足
      </div>
    );
  }

  return (
    <div className="h-[248px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={compoundingData}
          margin={{ top: 10, right: 18, left: 4, bottom: 4 }}
        >
          <defs>
            <linearGradient id="symbolCompoundGrad" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--success)"
                stopOpacity={0.28}
              />
              <stop
                offset="100%"
                stopColor="var(--success)"
                stopOpacity={0.02}
              />
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
            tickFormatter={(v: number) => `${v}`}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <ReferenceLine
            y={100}
            stroke="var(--border)"
            strokeDasharray="4 3"
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const d = payload[0].payload as {
                date: string;
                index: number;
                multiple: number;
              };
              const cumPct = d.index - 100;
              return (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs shadow-lg space-y-1">
                  <div className="font-mono font-semibold">{d.date}</div>
                  <div className="flex justify-between gap-4">
                    <span className="text-[var(--muted-foreground)]">
                      含息複利指數
                    </span>
                    <span className="font-mono font-bold tabular-nums">
                      {d.index.toFixed(1)} ({d.multiple.toFixed(2)}x)
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-[var(--muted-foreground)]">
                      區間累積含息報酬
                    </span>
                    <span
                      className="font-mono font-semibold tabular-nums"
                      style={{
                        color: cumPct >= 0 ? "var(--success)" : "var(--danger)",
                      }}
                    >
                      {cumPct >= 0 ? "+" : ""}
                      {cumPct.toFixed(2)}%
                    </span>
                  </div>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="index"
            name="含息複利指數"
            stroke="var(--success)"
            strokeWidth={2}
            fill="url(#symbolCompoundGrad)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
