"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatPercent } from "@/lib/utils";
import type { DailyPortfolioPoint } from "@/types/quant";

interface BenchmarkMeta {
  symbol: string;
  label: string;
  color: string;
}

interface TwrBenchmarkChartProps {
  points: DailyPortfolioPoint[];
  benchmarkCurves: Record<string, Map<string, number>>;
  activeBenchmarks: BenchmarkMeta[];
}

export function TwrBenchmarkChart({
  points,
  benchmarkCurves,
  activeBenchmarks,
}: TwrBenchmarkChartProps) {
  const chartData = useMemo(() => {
    // Visual downsampling for very long series (> 450 points) while keeping first & last
    const step = points.length > 450 ? Math.ceil(points.length / 450) : 1;
    const rows: Array<Record<string, string | number>> = [];

    for (let i = 0; i < points.length; i++) {
      if (step > 1 && i !== 0 && i !== points.length - 1 && i % step !== 0) {
        continue;
      }
      const pt = points[i];
      const row: Record<string, string | number> = {
        date: pt.date,
        portfolio: Number(pt.twrIndex.toFixed(2)),
      };
      for (const b of activeBenchmarks) {
        const val = benchmarkCurves[b.symbol]?.get(pt.date);
        if (typeof val === "number") {
          row[b.symbol] = Number(val.toFixed(2));
        }
      }
      rows.push(row);
    }
    return rows;
  }, [points, benchmarkCurves, activeBenchmarks]);

  if (chartData.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-xs text-[var(--muted-foreground)]">
        尚無足夠交易日資料可供繪圖
      </div>
    );
  }

  return (
    <div className="h-[310px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 10, right: 18, left: 2, bottom: 5 }}>
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
            minTickGap={60}
          />
          <YAxis
            domain={["auto", "auto"]}
            tick={{ fill: "var(--muted-foreground)", fontSize: 14 }}
            tickLine={false}
            axisLine={false}
            width={58}
          />
          <ReferenceLine
            y={100}
            stroke="var(--muted-foreground)"
            strokeOpacity={0.45}
            strokeDasharray="2 2"
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null;
              return (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs shadow-lg">
                  <div className="mb-1.5 border-b border-[var(--border)] pb-1 font-mono font-semibold">
                    {label}
                  </div>
                  <div className="space-y-1">
                    {payload.map((entry) => {
                      const val = Number(entry.value ?? 100);
                      const ret = val / 100 - 1;
                      return (
                        <div
                          key={String(entry.dataKey)}
                          className="flex items-center justify-between gap-5"
                        >
                          <span className="flex items-center gap-1.5">
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ backgroundColor: entry.color }}
                            />
                            {entry.name}
                          </span>
                          <span className="font-mono tabular-nums font-semibold">
                            {val.toFixed(2)} ({formatPercent(ret, { signed: true })})
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="portfolio"
            name="我的投組 (TWR)"
            stroke="var(--chart-1)"
            strokeWidth={2.4}
            dot={false}
            activeDot={{ r: 4 }}
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
              activeDot={{ r: 3.5 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
