"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SymbolUnderwaterPoint } from "@/types/quant";

interface SymbolUnderwaterChartProps {
  series: SymbolUnderwaterPoint[];
  historicalMdd: number;
}

export function SymbolUnderwaterChart({
  series,
  historicalMdd,
}: SymbolUnderwaterChartProps) {
  const data = useMemo(() => {
    const step = series.length > 420 ? Math.ceil(series.length / 420) : 1;
    return series
      .filter(
        (_, i) => step === 1 || i === 0 || i === series.length - 1 || i % step === 0
      )
      .map((pt) => ({
        date: pt.date,
        drawdownPct: Number((pt.drawdown * 100).toFixed(2)),
        adjClose: pt.adjClose,
      }));
  }, [series]);

  const mddPct = Number((historicalMdd * 100).toFixed(2));
  const minAxis = Math.min(-10, Math.floor((mddPct - 2) / 5) * 5);

  return (
    <div className="h-[218px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 18, left: 2, bottom: 4 }}>
          <defs>
            <linearGradient id="symbolUnderwaterGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--warning)" stopOpacity={0.14} />
              <stop offset="100%" stopColor="var(--danger)" stopOpacity={0.42} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--muted-foreground)", fontSize: 14 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={68}
          />
          <YAxis
            domain={[minAxis, 0]}
            tickFormatter={(v) => `${v}%`}
            tick={{ fill: "var(--muted-foreground)", fontSize: 14 }}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <ReferenceLine y={0} stroke="var(--border)" />
          <ReferenceLine
            y={mddPct}
            stroke="var(--danger)"
            strokeDasharray="4 3"
            strokeOpacity={0.55}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const d = payload[0].payload as {
                date: string;
                drawdownPct: number;
                adjClose: number;
              };
              return (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs shadow-lg">
                  <div className="font-mono font-semibold">{d.date}</div>
                  <div className="mt-1 flex justify-between gap-4">
                    <span className="text-[var(--muted-foreground)]">含息水下深度</span>
                    <span className="font-mono font-bold text-[var(--danger)]">
                      {d.drawdownPct.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-[var(--muted-foreground)]">Adj Close</span>
                    <span className="font-mono">{d.adjClose.toFixed(2)}</span>
                  </div>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="drawdownPct"
            stroke="var(--danger)"
            strokeWidth={1.7}
            fill="url(#symbolUnderwaterGrad)"
            baseValue={0}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
