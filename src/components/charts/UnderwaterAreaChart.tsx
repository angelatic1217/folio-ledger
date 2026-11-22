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
import type { DailyPortfolioPoint, DrawdownSummary } from "@/types/quant";

interface UnderwaterAreaChartProps {
  points: DailyPortfolioPoint[];
  summary: DrawdownSummary;
}

export function UnderwaterAreaChart({
  points,
  summary,
}: UnderwaterAreaChartProps) {
  const chartData = useMemo(() => {
    if (points.length === 0) return [];
    const step = points.length > 500 ? Math.ceil(points.length / 500) : 1;

    return points
      .filter(
        (pt, idx) =>
          step === 1 ||
          idx === 0 ||
          idx === points.length - 1 ||
          pt.date === summary.maxDrawdownDate ||
          idx % step === 0
      )
      .map((pt) => ({
        date: pt.date,
        drawdownPct: Number((pt.drawdown * 100).toFixed(2)),
        peakDate: pt.peakDate,
        daysUnderwater: pt.daysUnderwater,
      }));
  }, [points, summary.maxDrawdownDate]);

  if (chartData.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-xs text-[var(--muted-foreground)]">
        尚無水下深度時間序列資料
      </div>
    );
  }

  const mddPct = Number((summary.maxDrawdown * 100).toFixed(2));
  const minAxis = Math.min(-5, Math.floor((mddPct - 2) / 5) * 5);

  return (
    <div className="h-[276px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 18, left: 2, bottom: 5 }}>
          <defs>
            <linearGradient id="underwaterCrimson" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--danger)" stopOpacity={0.1} />
              <stop offset="100%" stopColor="var(--danger)" stopOpacity={0.45} />
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
            minTickGap={60}
          />
          <YAxis
            domain={[minAxis, 0]}
            tickFormatter={(v) => `${v}%`}
            tick={{ fill: "var(--muted-foreground)", fontSize: 14 }}
            tickLine={false}
            axisLine={false}
            width={58}
          />
          <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.2} />
          {mddPct < 0 && (
            <ReferenceLine
              y={mddPct}
              stroke="var(--danger)"
              strokeDasharray="4 3"
              strokeOpacity={0.65}
            />
          )}
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const d = payload[0].payload as {
                date: string;
                drawdownPct: number;
                peakDate: string;
                daysUnderwater: number;
              };
              return (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs shadow-lg">
                  <div className="mb-1 border-b border-[var(--border)] pb-1 font-mono font-semibold">
                    {d.date}
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex justify-between gap-4">
                      <span className="text-[var(--muted-foreground)]">水下深度</span>
                      <span className="font-mono font-bold text-[var(--danger)] tabular-nums">
                        {d.drawdownPct.toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-[var(--muted-foreground)]">波峰起點</span>
                      <span className="font-mono">{d.peakDate}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-[var(--muted-foreground)]">水下天數</span>
                      <span className="font-mono">{d.daysUnderwater} 交易日</span>
                    </div>
                  </div>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="drawdownPct"
            stroke="var(--danger)"
            strokeWidth={1.8}
            fill="url(#underwaterCrimson)"
            baseValue={0}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
