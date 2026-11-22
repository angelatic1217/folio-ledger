"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnnualPerformanceRow } from "@/types/quant";

interface AnnualAlphaBarChartProps {
  rows: AnnualPerformanceRow[];
  benchmarkLabel: string;
}

export function AnnualAlphaBarChart({
  rows,
  benchmarkLabel,
}: AnnualAlphaBarChartProps) {
  const data = rows.map((r) => ({
    year: r.year,
    portfolio: Number((r.twr * 100).toFixed(2)),
    benchmark:
      r.benchmarkReturn !== null
        ? Number((r.benchmarkReturn * 100).toFixed(2))
        : 0,
  }));

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-xs text-[var(--muted-foreground)]">
        尚無年度績效資料
      </div>
    );
  }

  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="year"
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
          />
          <YAxis
            tickFormatter={(v) => `${v}%`}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={46}
          />
          <ReferenceLine y={0} stroke="var(--border)" />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null;
              return (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs shadow-lg">
                  <div className="mb-1 border-b border-[var(--border)] pb-1 font-semibold">
                    {label}
                  </div>
                  {payload.map((entry) => (
                    <div
                      key={String(entry.dataKey)}
                      className="flex justify-between gap-4"
                    >
                      <span style={{ color: entry.color }}>{entry.name}</span>
                      <span className="font-mono font-semibold tabular-nums">
                        {Number(entry.value) > 0 ? "+" : ""}
                        {Number(entry.value).toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              );
            }}
          />
          <Bar
            dataKey="portfolio"
            name="我的投組 (TWR)"
            fill="var(--chart-1)"
            radius={[4, 4, 0, 0]}
            maxBarSize={42}
            isAnimationActive={false}
          />
          <Bar
            dataKey="benchmark"
            name={benchmarkLabel}
            fill="var(--chart-2)"
            radius={[4, 4, 0, 0]}
            maxBarSize={42}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
