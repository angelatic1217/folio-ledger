"use client";

import { Coins, Percent, Scale, TrendingUp } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { usePrivacy } from "@/lib/privacy/context";
import { formatPercent } from "@/lib/utils";
import type { PortfolioLeverageSummary } from "@/types/quant";
import type { CurrencyCode } from "@/types/sheet";

interface LoanOverviewTabProps {
  leverage: PortfolioLeverageSummary;
  interestBasis: "full" | "accrued";
  currency: CurrencyCode;
  onInspectHoldings: (loanId: string) => void;
  onInspectAmortization: (loanId: string) => void;
  onSelectFundingFilter: (tag: string) => void;
}

export function LoanOverviewTab({
  leverage,
  interestBasis,
  currency,
  onInspectHoldings,
  onInspectAmortization,
  onSelectFundingFilter,
}: LoanOverviewTabProps) {
  const { fmtMoney } = usePrivacy();
  const fx = leverage.latestFxRate;
  const activeNetPnl =
    interestBasis === "full"
      ? leverage.totalLoanNetPnlFullInterestTwd
      : leverage.totalLoanNetPnlAccruedInterestTwd;
  const activeNetReturn =
    interestBasis === "full"
      ? leverage.totalLoanNetReturnFullInterest
      : leverage.totalLoanNetReturnAccruedInterest;
  const activeInterestDeducted =
    interestBasis === "full"
      ? leverage.totalFullTermInterestTwd
      : leverage.totalAccruedInterestTwd;

  return (
    <div className="space-y-5">
      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1">
              <Scale className="h-3.5 w-3.5" /> 自有淨值（扣剩餘負債）
            </span>
            <Badge
              variant={
                leverage.debtToAssetRatio > 0.6
                  ? "danger"
                  : leverage.debtToAssetRatio > 0.35
                    ? "warning"
                    : "success"
              }
            >
              {leverage.leverageRatio
                ? `${leverage.leverageRatio.toFixed(2)}x 槓桿`
                : "—"}
            </Badge>
          </div>
          <div className="font-mono text-2xl font-bold tracking-tight tabular-nums">
            {fmtMoney(leverage.netWorthTwd, currency, fx)}
          </div>
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>
              剩餘本金 {fmtMoney(leverage.totalRemainingDebtTwd, currency, fx)}
            </span>
            <span className="font-mono">
              負債比 {(leverage.debtToAssetRatio * 100).toFixed(1)}%
            </span>
          </div>
        </Card>

        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5" /> 信貸部位總估值（扣息前）
            </span>
            <Badge variant={leverage.totalLoanGrossPnlTwd >= 0 ? "success" : "danger"}>
              {formatPercent(leverage.totalLoanGrossReturn, { signed: true })}
            </Badge>
          </div>
          <div className="font-mono text-2xl font-bold tracking-tight tabular-nums">
            {fmtMoney(leverage.totalLoanAssetValueTwd, currency, fx)}
          </div>
          <div className="flex items-center justify-between text-xs">
            <span
              className="font-mono font-semibold tabular-nums"
              style={{
                color:
                  leverage.totalLoanGrossPnlTwd >= 0
                    ? "var(--success)"
                    : "var(--danger)",
              }}
            >
              {fmtMoney(leverage.totalLoanGrossPnlTwd, currency, fx, {
                signed: true,
              })}
            </span>
            <span className="text-[var(--muted-foreground)] font-mono">
              股{" "}
              {fmtMoney(leverage.totalLoanEquityPnlTwd, currency, fx, {
                signed: true,
                compact: true,
              })}{" "}
              · 匯{" "}
              {fmtMoney(leverage.totalLoanFxPnlTwd, currency, fx, {
                signed: true,
                compact: true,
              })}
            </span>
          </div>
        </Card>

        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1">
              <Coins className="h-3.5 w-3.5" /> 扣息後淨獲利
            </span>
            <Badge variant={activeNetPnl >= 0 ? "success" : "danger"}>
              {formatPercent(activeNetReturn, { signed: true })}
            </Badge>
          </div>
          <div
            className="font-mono text-2xl font-bold tracking-tight tabular-nums"
            style={{
              color: activeNetPnl >= 0 ? "var(--success)" : "var(--danger)",
            }}
          >
            {fmtMoney(activeNetPnl, currency, fx, { signed: true })}
          </div>
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>
              {interestBasis === "full" ? "扣除全期總利息" : "扣除截至今日已繳利息"}
            </span>
            <span className="font-mono text-[var(--warning)] tabular-nums">
              -{fmtMoney(activeInterestDeducted, currency, fx)}
            </span>
          </div>
        </Card>

        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1">
              <Percent className="h-3.5 w-3.5" /> 每月本息現金流出
            </span>
            <Badge variant="outline">
              現行 APR {(leverage.weightedApr * 100).toFixed(2)}%
            </Badge>
          </div>
          <div className="font-mono text-2xl font-bold tracking-tight tabular-nums">
            {fmtMoney(leverage.totalMonthlyPaymentTwd, currency, fx)}
          </div>
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>
              投入股市成本 {fmtMoney(leverage.totalCostTwd, currency, fx)}
            </span>
            {leverage.weightedAvgEntryFxRate && (
              <span className="font-mono">
                均匯 {leverage.weightedAvgEntryFxRate.toFixed(2)}
              </span>
            )}
          </div>
        </Card>
      </div>

      {/* Multi-Loan Comparison Table */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
          <div>
            <h3 className="text-sm font-bold">各期信貸方案績效與股差/匯差對比</h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              已結清／借新還舊方案不重複計入現行負債與月繳，但完整保留歷史投入成本與投資部位追蹤
            </p>
          </div>
          <span className="font-mono text-xs text-[var(--muted-foreground)]">
            目前口徑：
            {interestBasis === "full" ? "扣除全期總利息" : "扣除截至基準日已繳利息"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-right font-mono text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-[var(--muted-foreground)]">
                <th className="px-3 py-2.5 text-left font-sans font-semibold">資金方案</th>
                <th className="px-3 py-2.5 font-sans font-semibold">利率 / 期數</th>
                <th className="px-3 py-2.5 font-sans font-semibold">投入成本</th>
                <th className="px-3 py-2.5 font-sans font-semibold">目前估值</th>
                <th className="px-3 py-2.5 font-sans font-semibold">扣息前損益</th>
                <th className="px-3 py-2.5 font-sans font-semibold">股差獲利</th>
                <th className="px-3 py-2.5 font-sans font-semibold">匯差效益</th>
                <th className="px-3 py-2.5 font-sans font-semibold">
                  {interestBasis === "full" ? "全期總息" : "已繳利息"}
                </th>
                <th className="px-3 py-2.5 font-sans font-semibold">扣息後淨利</th>
                <th className="px-3 py-2.5 font-sans font-semibold">年化(前)</th>
                <th className="px-3 py-2.5 text-center font-sans font-semibold">
                  快速切換
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {leverage.facilities.map((f) => {
                const interestCost =
                  interestBasis === "full"
                    ? f.fullTermInterestTwd
                    : f.accruedInterestToDateTwd;
                const netPnl =
                  interestBasis === "full"
                    ? f.netPnlFullInterestTwd
                    : f.netPnlAccruedInterestTwd;
                const netRet =
                  interestBasis === "full"
                    ? f.netReturnFullInterest
                    : f.netReturnAccruedInterest;

                return (
                  <tr key={f.id} className="hover:bg-[var(--muted)]/40 transition">
                    <td className="px-3 py-2.5 text-left font-sans">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-[var(--foreground)]">
                          {f.name}
                        </span>
                        {f.status === "refinanced" ? (
                          <Badge variant="muted">已借新還舊結清</Badge>
                        ) : f.status === "closed" ? (
                          <Badge variant="muted">已結清</Badge>
                        ) : f.refinancedPayoffTwd > 0 ? (
                          <Badge variant="default">借新還舊進行中</Badge>
                        ) : (
                          <Badge variant="success">還款中</Badge>
                        )}
                      </div>
                      <div className="text-[0.7rem] text-[var(--muted-foreground)] font-mono">
                        #{f.fundingTag} · {f.startDate}
                        {f.closedDate
                          ? ` → ${f.closedDate} 結清`
                          : ` (${f.holdingDays}天)`}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      <div>{(f.apr * 100).toFixed(2)}%</div>
                      <div className="text-[0.7rem] text-[var(--muted-foreground)]">
                        {f.status === "active"
                          ? `已繳 ${f.monthsElapsed}/${f.termMonths} 期`
                          : `已繳 ${f.monthsElapsed} 期後結清`}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {fmtMoney(f.totalCostTwd, currency, fx)}
                    </td>
                    <td className="px-3 py-2.5 font-semibold tabular-nums">
                      {fmtMoney(f.totalValueTwd, currency, fx)}
                    </td>
                    <td
                      className="px-3 py-2.5 font-semibold tabular-nums"
                      style={{
                        color:
                          f.grossPnlTwd >= 0 ? "var(--success)" : "var(--danger)",
                      }}
                    >
                      <div>
                        {fmtMoney(f.grossPnlTwd, currency, fx, { signed: true })}
                      </div>
                      <div className="text-[0.7rem]">
                        {formatPercent(f.grossReturn, { signed: true })}
                      </div>
                    </td>
                    <td
                      className="px-3 py-2.5 tabular-nums"
                      style={{
                        color:
                          f.equityPnlTwd >= 0 ? "var(--success)" : "var(--danger)",
                      }}
                    >
                      {fmtMoney(f.equityPnlTwd, currency, fx, { signed: true })}
                    </td>
                    <td
                      className="px-3 py-2.5 tabular-nums"
                      style={{
                        color:
                          (f.fxPnlTwd ?? 0) >= 0
                            ? "var(--success)"
                            : "var(--danger)",
                      }}
                    >
                      {f.fxPnlTwd !== null
                        ? fmtMoney(f.fxPnlTwd, currency, fx, { signed: true })
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--warning)] tabular-nums">
                      -{fmtMoney(interestCost, currency, fx)}
                    </td>
                    <td
                      className="px-3 py-2.5 font-bold tabular-nums"
                      style={{
                        color: netPnl >= 0 ? "var(--success)" : "var(--danger)",
                      }}
                    >
                      <div>{fmtMoney(netPnl, currency, fx, { signed: true })}</div>
                      <div className="text-[0.7rem]">
                        {formatPercent(netRet, { signed: true })}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {f.annualizedGrossReturn !== null
                        ? formatPercent(f.annualizedGrossReturn, { signed: true })
                        : "<30天"}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onInspectHoldings(f.id)}
                        >
                          持股
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onInspectAmortization(f.id)}
                        >
                          攤還
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onSelectFundingFilter(f.fundingTag)}
                        >
                          獨立TWR
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {leverage.facilities.length > 1 && (
                <tr className="border-t-2 border-[var(--border)] bg-[var(--muted)]/40 font-bold">
                  <td className="px-3 py-2.5 text-left font-sans">全體信貸合併總計</td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {(leverage.weightedApr * 100).toFixed(2)}%
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {fmtMoney(leverage.totalCostTwd, currency, fx)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {fmtMoney(leverage.totalLoanAssetValueTwd, currency, fx)}
                  </td>
                  <td
                    className="px-3 py-2.5 tabular-nums"
                    style={{
                      color:
                        leverage.totalLoanGrossPnlTwd >= 0
                          ? "var(--success)"
                          : "var(--danger)",
                    }}
                  >
                    <div>
                      {fmtMoney(leverage.totalLoanGrossPnlTwd, currency, fx, {
                        signed: true,
                      })}
                    </div>
                    <div className="text-[0.7rem]">
                      {formatPercent(leverage.totalLoanGrossReturn, { signed: true })}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {fmtMoney(leverage.totalLoanEquityPnlTwd, currency, fx, {
                      signed: true,
                    })}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {fmtMoney(leverage.totalLoanFxPnlTwd, currency, fx, {
                      signed: true,
                    })}
                  </td>
                  <td className="px-3 py-2.5 text-[var(--warning)] tabular-nums">
                    -{fmtMoney(activeInterestDeducted, currency, fx)}
                  </td>
                  <td
                    className="px-3 py-2.5 tabular-nums"
                    style={{
                      color: activeNetPnl >= 0 ? "var(--success)" : "var(--danger)",
                    }}
                  >
                    <div>
                      {fmtMoney(activeNetPnl, currency, fx, { signed: true })}
                    </div>
                    <div className="text-[0.7rem]">
                      {formatPercent(activeNetReturn, { signed: true })}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">—</td>
                  <td className="px-3 py-2.5" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
