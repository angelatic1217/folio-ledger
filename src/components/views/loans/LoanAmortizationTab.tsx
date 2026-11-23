"use client";

import { useMemo, useState } from "react";
import { LoanAmortizationChart } from "@/components/charts/LoanAmortizationChart";
import { Badge, Card } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/utils";
import type { LoanFacilitySummary } from "@/types/quant";
import type { CurrencyCode } from "@/types/sheet";

type ScheduleFilter = "all" | "paid" | "unpaid";

interface LoanAmortizationTabProps {
  facilities: LoanFacilitySummary[];
  selectedFacility: LoanFacilitySummary;
  currency: CurrencyCode;
  fxRate: number;
  onSelectLoan: (loanId: string) => void;
}

export function LoanAmortizationTab({
  facilities,
  selectedFacility,
  currency,
  fxRate,
  onSelectLoan,
}: LoanAmortizationTabProps) {
  const [filter, setFilter] = useState<ScheduleFilter>("all");
  const f = selectedFacility;

  const paidCount = useMemo(
    () => f.schedule.filter((r) => r.paid).length,
    [f.schedule]
  );
  const unpaidCount = f.schedule.length - paidCount;

  const filteredSchedule = useMemo(() => {
    if (filter === "paid") return f.schedule.filter((r) => r.paid);
    if (filter === "unpaid") return f.schedule.filter((r) => !r.paid);
    return f.schedule;
  }, [f.schedule, filter]);

  const repaidPct =
    f.principalTwd > 0
      ? Math.min(100, (f.repaidPrincipalToDateTwd / f.principalTwd) * 100)
      : 0;
  const remainingInterestTwd = Math.max(
    0,
    f.fullTermInterestTwd - f.accruedInterestToDateTwd
  );

  return (
    <div className="space-y-5">
      {/* Facility Selector */}
      <div className="flex flex-wrap items-center gap-2">
        {facilities.map((item) => {
          const active = item.id === f.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                onSelectLoan(item.id);
                setFilter("all");
              }}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition cursor-pointer ${
                active
                  ? "border-[var(--primary)] bg-[var(--primary)]/15 font-semibold text-[var(--primary)]"
                  : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              <span>{item.name}</span>
              <Badge variant={item.status === "active" ? "success" : "muted"}>
                {item.status === "active" ? "還款中" : "已結清"}
              </Badge>
            </button>
          );
        })}
      </div>

      {/* 4 Repayment Progress Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>還款進度</span>
            <span className="font-mono font-semibold text-[var(--primary)]">
              {repaidPct.toFixed(1)}%
            </span>
          </div>
          <div className="font-mono text-xl font-bold tabular-nums">
            {f.status === "active"
              ? `${f.monthsElapsed} / ${f.termMonths} 期`
              : `已繳 ${f.monthsElapsed} 期結清`}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--muted)]">
            <div
              className="h-full rounded-full bg-[var(--primary)] transition-all"
              style={{ width: `${repaidPct}%` }}
            />
          </div>
        </Card>

        <Card className="p-4 space-y-1.5">
          <div className="text-xs text-[var(--muted-foreground)]">剩餘未還本金</div>
          <div className="font-mono text-xl font-bold tabular-nums">
            {formatMoney(f.remainingPrincipalTwd, currency, fxRate)}
          </div>
          <div className="text-xs text-[var(--muted-foreground)] font-mono">
            原核貸 {formatMoney(f.principalTwd, currency, fxRate)}
          </div>
        </Card>

        <Card className="p-4 space-y-1.5">
          <div className="text-xs text-[var(--muted-foreground)]">
            {f.status === "active" ? "截至今日已繳利息" : "結清前實付總息（含差額）"}
          </div>
          <div className="font-mono text-xl font-bold text-[var(--warning)] tabular-nums">
            {formatMoney(f.accruedInterestToDateTwd, currency, fxRate)}
          </div>
          <div className="text-xs text-[var(--muted-foreground)] font-mono">
            {f.status === "active"
              ? `全期預估總息 ${formatMoney(f.fullTermInterestTwd, currency, fxRate)}`
              : `結清金額 ${f.payoffTwd ? formatMoney(f.payoffTwd, "TWD", fxRate) : "—"}`}
          </div>
        </Card>

        <Card className="p-4 space-y-1.5">
          <div className="text-xs text-[var(--muted-foreground)]">
            {f.status === "active" ? "未來待繳利息" : "目前每月還款"}
          </div>
          <div className="font-mono text-xl font-bold tabular-nums">
            {f.status === "active"
              ? formatMoney(remainingInterestTwd, currency, fxRate)
              : formatMoney(0, currency, fxRate)}
          </div>
          <div className="text-xs text-[var(--muted-foreground)] font-mono">
            每期合約月付 {formatMoney(f.monthlyPaymentTwd, currency, fxRate)} · APR{" "}
            {(f.apr * 100).toFixed(2)}%
          </div>
        </Card>
      </div>

      {/* Full-Width Amortization Chart */}
      <Card className="p-4 lg:p-5 space-y-3">
        <div>
          <h3 className="text-sm font-bold">
            {f.status === "active"
              ? `${f.name} · 本息攤還走勢圖（${f.termMonths} 期）`
              : `${f.name} · 歷史還款走勢（已繳 ${f.monthsElapsed} 期後於 ${f.closedDate ?? "—"} 結清）`}
          </h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            藍區：剩餘本金遞減 · 橘區：累積利息支出 · 綠虛線：目前進度（第 {f.monthsElapsed} 期）
          </p>
        </div>
        <LoanAmortizationChart
          schedule={f.schedule}
          monthsElapsed={f.monthsElapsed}
          currency={currency}
          fxRate={fxRate}
          height={320}
        />
      </Card>

      {/* Filterable Full Amortization Schedule Table */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div>
            <h3 className="text-sm font-bold">逐期本息均攤明細表（PPMT / IPMT）</h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              顯示 {filteredSchedule.length} 期紀錄
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5 text-xs">
            {(
              [
                { key: "all", label: `全部 (${f.schedule.length})` },
                { key: "paid", label: `已繳 (${paidCount})` },
                { key: "unpaid", label: `待繳 (${unpaidCount})` },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                onClick={() => setFilter(opt.key)}
                className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                  filter === opt.key
                    ? "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[520px] overflow-y-auto">
          <table className="w-full border-collapse text-right font-mono text-xs">
            <thead className="sticky top-0 z-10 bg-[var(--card)]">
              <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                <th className="px-4 py-2.5 text-left font-sans">期數</th>
                <th className="px-4 py-2.5 text-left font-sans">扣款日</th>
                <th className="px-4 py-2.5 font-sans">償還本金</th>
                <th className="px-4 py-2.5 font-sans">償還利息</th>
                <th className="px-4 py-2.5 font-sans">每期應繳</th>
                <th className="px-4 py-2.5 font-sans">累積已繳息</th>
                <th className="px-4 py-2.5 font-sans">剩餘本金</th>
                <th className="px-4 py-2.5 text-center font-sans">狀態</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filteredSchedule.map((r) => (
                <tr
                  key={r.period}
                  className={
                    r.period === f.monthsElapsed
                      ? "bg-[var(--success)]/10 font-semibold"
                      : "hover:bg-[var(--muted)]/40"
                  }
                >
                  <td className="px-4 py-2 text-left">#{r.period}</td>
                  <td className="px-4 py-2 text-left text-[var(--muted-foreground)]">
                    {r.paymentDate}
                  </td>
                  <td className="px-4 py-2 tabular-nums">
                    {formatMoney(r.principalTwd, currency, fxRate)}
                  </td>
                  <td className="px-4 py-2 text-[var(--warning)] tabular-nums">
                    {formatMoney(r.interestTwd, currency, fxRate)}
                  </td>
                  <td className="px-4 py-2 tabular-nums">
                    {formatMoney(r.paymentTwd, currency, fxRate)}
                  </td>
                  <td className="px-4 py-2 text-[var(--muted-foreground)] tabular-nums">
                    {formatMoney(r.cumulativeInterestTwd, currency, fxRate)}
                  </td>
                  <td className="px-4 py-2 font-semibold tabular-nums">
                    {formatMoney(r.remainingPrincipalTwd, currency, fxRate)}
                  </td>
                  <td className="px-4 py-2 text-center font-sans">
                    <Badge variant={r.paid ? "success" : "muted"}>
                      {r.paid ? "已繳" : "待繳"}
                    </Badge>
                  </td>
                </tr>
              ))}
              {filteredSchedule.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="py-8 text-center font-sans text-[var(--muted-foreground)]"
                  >
                    此篩選條件下無期數資料
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
