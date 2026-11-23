"use client";

import { Calculator } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge, Card, Input } from "@/components/ui/primitives";
import { simulateLumpSumVsDca } from "@/lib/quant/loan";
import { formatMoney } from "@/lib/utils";

interface LoanSimulatorTabProps {
  fxRate: number;
}

export function LoanSimulatorTab({ fxRate }: LoanSimulatorTabProps) {
  const [simPrincipal, setSimPrincipal] = useState("2980000");
  const [simOrigFee, setSimOrigFee] = useState("2000");
  const [simAprPct, setSimAprPct] = useState("2.99");
  const [simMonths, setSimMonths] = useState("84");
  const [simGrowthPct, setSimGrowthPct] = useState("8.0");
  const [simYieldPct, setSimYieldPct] = useState("1.29");

  const simResult = useMemo(
    () =>
      simulateLumpSumVsDca({
        principalTwd: Math.max(0, Number(simPrincipal) || 0),
        originationFeeTwd: Math.max(0, Number(simOrigFee) || 0),
        apr: Math.max(0, (Number(simAprPct) || 0) / 100),
        termMonths: Math.max(
          12,
          Math.min(360, Math.round(Number(simMonths) || 84))
        ),
        expectedAnnualGrowth: (Number(simGrowthPct) || 0) / 100,
        dividendYield: Math.max(0, (Number(simYieldPct) || 0) / 100),
      }),
    [simPrincipal, simOrigFee, simAprPct, simMonths, simGrowthPct, simYieldPct]
  );

  const chartData = useMemo(() => {
    const netStart = Math.max(
      0,
      (Number(simPrincipal) || 0) - (Number(simOrigFee) || 0)
    );
    return [
      {
        yearLabel: "第 0 年",
        lumpSum: Math.round(netStart),
        dca: 0,
        advantage: Math.round(netStart),
      },
      ...simResult.yearlyPoints.map((pt) => ({
        yearLabel: `第 ${pt.year} 年`,
        lumpSum: Math.round(pt.lumpSumValueTwd),
        dca: Math.round(pt.dcaValueTwd),
        advantage: Math.round(pt.advantageTwd),
      })),
    ];
  }, [simResult.yearlyPoints, simPrincipal, simOrigFee]);

  const formatAxis = (v: number) => {
    if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}k`;
    return String(Math.round(v));
  };

  return (
    <div className="space-y-5">
      {/* Parameter Input Card */}
      <Card className="p-4 lg:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <Calculator className="h-4 w-4 text-[var(--primary)]" />
              信貸條件試算 &amp; 一次投入 vs 定期定額對比
            </h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              取代原試算表 `信貸條件` 與 `定期定額與一次投入比較`：比較「借入一次投入」vs「將每月應繳金額定期定額」之期末資產差距
            </p>
          </div>
          <Badge variant={simResult.finalAdvantageTwd >= 0 ? "success" : "danger"}>
            期滿超額優勢：
            {formatMoney(simResult.finalAdvantageTwd, "TWD", fxRate, {
              signed: true,
            })}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 text-xs">
          <div>
            <label className="mb-1 block text-[var(--muted-foreground)]">
              核貸本金 (NTD)
            </label>
            <Input
              type="number"
              value={simPrincipal}
              onChange={(e) => setSimPrincipal(e.target.value)}
              className="font-mono"
            />
          </div>
          <div>
            <label className="mb-1 block text-[var(--muted-foreground)]">
              開辦手續費 (NTD)
            </label>
            <Input
              type="number"
              value={simOrigFee}
              onChange={(e) => setSimOrigFee(e.target.value)}
              className="font-mono"
            />
          </div>
          <div>
            <label className="mb-1 block text-[var(--muted-foreground)]">
              標榜年利率 (%)
            </label>
            <Input
              type="number"
              step="0.05"
              value={simAprPct}
              onChange={(e) => setSimAprPct(e.target.value)}
              className="font-mono"
            />
          </div>
          <div>
            <label className="mb-1 block text-[var(--muted-foreground)]">
              貸款期數 (月)
            </label>
            <Input
              type="number"
              value={simMonths}
              onChange={(e) => setSimMonths(e.target.value)}
              className="font-mono"
            />
          </div>
          <div>
            <label className="mb-1 block text-[var(--muted-foreground)]">
              預期年化資本成長 (%)
            </label>
            <Input
              type="number"
              step="0.5"
              value={simGrowthPct}
              onChange={(e) => setSimGrowthPct(e.target.value)}
              className="font-mono"
            />
          </div>
          <div>
            <label className="mb-1 block text-[var(--muted-foreground)]">
              假設股息殖利率 (%)
            </label>
            <Input
              type="number"
              step="0.1"
              value={simYieldPct}
              onChange={(e) => setSimYieldPct(e.target.value)}
              className="font-mono"
            />
          </div>
        </div>

        {/* 4 Summary Metrics */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 p-3.5 text-xs">
          <div>
            <div className="text-[var(--muted-foreground)]">每期應繳月付金 (PMT)</div>
            <div className="mt-0.5 font-mono text-base font-bold tabular-nums">
              {formatMoney(simResult.monthlyPaymentTwd, "TWD", fxRate)}
            </div>
          </div>
          <div>
            <div className="text-[var(--muted-foreground)]">全期總利息支出</div>
            <div className="mt-0.5 font-mono text-base font-bold text-[var(--warning)] tabular-nums">
              {formatMoney(simResult.totalInterestTwd, "TWD", fxRate)}
            </div>
          </div>
          <div>
            <div className="text-[var(--muted-foreground)]">
              含開辦費真實總費用年百分率 (APR)
            </div>
            <div className="mt-0.5 font-mono text-base font-bold text-[var(--primary)] tabular-nums">
              {(simResult.effectiveApr * 100).toFixed(3)}%
            </div>
          </div>
          <div>
            <div className="text-[var(--muted-foreground)]">
              期滿信貸一次投入優勢
            </div>
            <div
              className="mt-0.5 font-mono text-base font-bold tabular-nums"
              style={{
                color:
                  simResult.finalAdvantageTwd >= 0
                    ? "var(--success)"
                    : "var(--danger)",
              }}
            >
              {formatMoney(simResult.finalAdvantageTwd, "TWD", fxRate, {
                signed: true,
              })}
            </div>
          </div>
        </div>
      </Card>

      {/* Dual Line Growth Comparison Chart */}
      <Card className="p-4 lg:p-5 space-y-3">
        <div>
          <h3 className="text-sm font-bold">
            逐年資產成長曲線對比（信貸一次投入 vs 等額月繳定期定額）
          </h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            兩方案每月現金流支出完全一致（均為 {formatMoney(simResult.monthlyPaymentTwd, "TWD", fxRate)} / 月），純比較資金提早進場的複利差距
          </p>
        </div>

        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 10, right: 20, left: 6, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                vertical={false}
              />
              <XAxis
                dataKey="yearLabel"
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
              />
              <YAxis
                tickFormatter={formatAxis}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={58}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const d = payload[0].payload as (typeof chartData)[number];
                  return (
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs shadow-lg space-y-1">
                      <div className="border-b border-[var(--border)] pb-1 font-semibold">
                        {d.yearLabel}
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-[var(--muted-foreground)]">
                          信貸一次投入
                        </span>
                        <span className="font-mono font-semibold text-[var(--chart-1)] tabular-nums">
                          {formatMoney(d.lumpSum, "TWD", fxRate)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-[var(--muted-foreground)]">
                          等額定期定額
                        </span>
                        <span className="font-mono font-semibold text-[var(--chart-2)] tabular-nums">
                          {formatMoney(d.dca, "TWD", fxRate)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-4 border-t border-[var(--border)] pt-1">
                        <span className="text-[var(--muted-foreground)]">
                          一次投入優勢
                        </span>
                        <span
                          className="font-mono font-bold tabular-nums"
                          style={{
                            color:
                              d.advantage >= 0
                                ? "var(--success)"
                                : "var(--danger)",
                          }}
                        >
                          {formatMoney(d.advantage, "TWD", fxRate, {
                            signed: true,
                          })}
                        </span>
                      </div>
                    </div>
                  );
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="lumpSum"
                name="信貸一次投入資產"
                stroke="var(--chart-1)"
                strokeWidth={2.4}
                dot={{ r: 3.5 }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="dca"
                name="等額月繳定期定額資產"
                stroke="var(--chart-2)"
                strokeWidth={2.2}
                strokeDasharray="5 4"
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Yearly Table */}
      <Card className="overflow-hidden">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-sm font-bold">逐年終值與超額優勢明細</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-right font-mono text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-[var(--muted-foreground)]">
                <th className="px-4 py-2.5 text-left font-sans">第 N 年</th>
                <th className="px-4 py-2.5 font-sans">信貸一次投入資產</th>
                <th className="px-4 py-2.5 font-sans">等額月繳定期定額資產</th>
                <th className="px-4 py-2.5 font-sans">信貸一次投入超額優勢</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {simResult.yearlyPoints.map((pt) => (
                <tr key={pt.year} className="hover:bg-[var(--muted)]/40">
                  <td className="px-4 py-2.5 text-left">第 {pt.year} 年</td>
                  <td className="px-4 py-2.5 font-semibold tabular-nums">
                    {formatMoney(pt.lumpSumValueTwd, "TWD", fxRate)}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {formatMoney(pt.dcaValueTwd, "TWD", fxRate)}
                  </td>
                  <td
                    className="px-4 py-2.5 font-bold tabular-nums"
                    style={{
                      color:
                        pt.advantageTwd >= 0
                          ? "var(--success)"
                          : "var(--danger)",
                    }}
                  >
                    {formatMoney(pt.advantageTwd, "TWD", fxRate, {
                      signed: true,
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
