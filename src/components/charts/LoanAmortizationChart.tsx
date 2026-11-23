"use client";

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
import { formatMoney } from "@/lib/utils";
import type { AmortizationRow } from "@/types/quant";
import type { CurrencyCode } from "@/types/sheet";

interface LoanAmortizationChartProps {
  schedule: AmortizationRow[];
  monthsElapsed: number;
  currency: CurrencyCode;
  fxRate: number;
  height?: number;
}

export function LoanAmortizationChart({
  schedule,
  monthsElapsed,
  currency,
  fxRate,
  height = 260,
}: LoanAmortizationChartProps) {
  if (schedule.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-xs text-[var(--muted-foreground)]">
        尚無攤還期數資料
      </div>
    );
  }

  const data = schedule.map((r) => ({
    period: r.period,
    label: `第${r.period}期`,
    paymentDate: r.paymentDate,
    remainingPrincipalTwd: Math.round(r.remainingPrincipalTwd),
    cumulativeInterestTwd: Math.round(r.cumulativeInterestTwd),
    principalTwd: Math.round(r.principalTwd),
    interestTwd: Math.round(r.interestTwd),
    paid: r.paid,
  }));

  const formatAxis = (v: number) => {
    const val = currency === "TWD" ? v : v / (fxRate || 32);
    if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (Math.abs(val) >= 1_000) return `${Math.round(val / 1_000)}k`;
    return String(Math.round(val));
  };

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 18, left: 6, bottom: 5 }}>
          <defs>
            <linearGradient id="loanRemainingGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="loanInterestGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--warning)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--warning)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="period"
            tickFormatter={(p) => `M${p}`}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={formatAxis}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={58}
          />
          {monthsElapsed > 0 && monthsElapsed <= schedule.length && (
            <ReferenceLine
              x={monthsElapsed}
              stroke="var(--success)"
              strokeDasharray="4 3"
              strokeWidth={1.5}
            />
          )}
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const d = payload[0].payload as (typeof data)[number];
              return (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs shadow-lg space-y-1">
                  <div className="border-b border-[var(--border)] pb-1 font-mono font-semibold flex items-center justify-between gap-4">
                    <span>
                      第 {d.period} 期 ({d.paymentDate})
                    </span>
                    <span
                      className={
                        d.paid
                          ? "text-[var(--success)]"
                          : "text-[var(--muted-foreground)]"
                      }
                    >
                      {d.paid ? "已繳" : "待繳"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-[var(--muted-foreground)]">剩餘本金</span>
                    <span className="font-mono font-semibold tabular-nums">
                      {formatMoney(d.remainingPrincipalTwd, currency, fxRate)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-[var(--muted-foreground)]">當期本金 / 利息</span>
                    <span className="font-mono tabular-nums">
                      {formatMoney(d.principalTwd, currency, fxRate)} /{" "}
                      {formatMoney(d.interestTwd, currency, fxRate)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-[var(--muted-foreground)]">累積利息</span>
                    <span className="font-mono font-semibold text-[var(--warning)] tabular-nums">
                      {formatMoney(d.cumulativeInterestTwd, currency, fxRate)}
                    </span>
                  </div>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="remainingPrincipalTwd"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#loanRemainingGrad)"
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="cumulativeInterestTwd"
            stroke="var(--warning)"
            strokeWidth={1.8}
            fill="url(#loanInterestGrad)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
