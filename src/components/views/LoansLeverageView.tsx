"use client";

import {
  Calculator,
  ChevronDown,
  ChevronUp,
  Coins,
  Database,
  Landmark,
  Percent,
  Scale,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState } from "react";
import { LoanAmortizationChart } from "@/components/charts/LoanAmortizationChart";
import { Badge, Button, Card, Input } from "@/components/ui/primitives";
import { simulateLumpSumVsDca } from "@/lib/quant/loan";
import { formatMoney, formatPercent, formatPrice } from "@/lib/utils";
import type { PortfolioLeverageSummary } from "@/types/quant";
import type { CurrencyCode } from "@/types/sheet";

interface LoansLeverageViewProps {
  leverage: PortfolioLeverageSummary;
  currency: CurrencyCode;
  onNavigateLedger: () => void;
  onSelectFundingFilter: (tag: string) => void;
}

export function LoansLeverageView({
  leverage,
  currency,
  onNavigateLedger,
  onSelectFundingFilter,
}: LoansLeverageViewProps) {
  const [interestBasis, setInterestBasis] = useState<"full" | "accrued">("full");
  const [selectedLoanId, setSelectedLoanId] = useState<string>(
    leverage.facilities[0]?.id ?? ""
  );
  const [showFullSchedule, setShowFullSchedule] = useState(false);

  // Interactive simulator state (replaces 信貸條件 + 定期定額與一次投入比較)
  const [simPrincipal, setSimPrincipal] = useState("2100000");
  const [simOrigFee, setSimOrigFee] = useState("9000");
  const [simAprPct, setSimAprPct] = useState("2.46");
  const [simMonths, setSimMonths] = useState("84");
  const [simGrowthPct, setSimGrowthPct] = useState("8.0");
  const [simYieldPct, setSimYieldPct] = useState("1.29");

  const simResult = useMemo(
    () =>
      simulateLumpSumVsDca({
        principalTwd: Math.max(0, Number(simPrincipal) || 0),
        originationFeeTwd: Math.max(0, Number(simOrigFee) || 0),
        apr: Math.max(0, (Number(simAprPct) || 0) / 100),
        termMonths: Math.max(12, Math.min(360, Math.round(Number(simMonths) || 84))),
        expectedAnnualGrowth: (Number(simGrowthPct) || 0) / 100,
        dividendYield: Math.max(0, (Number(simYieldPct) || 0) / 100),
      }),
    [simPrincipal, simOrigFee, simAprPct, simMonths, simGrowthPct, simYieldPct]
  );

  const selectedFacility =
    leverage.facilities.find((f) => f.id === selectedLoanId) ??
    leverage.facilities[0] ??
    null;

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

  const visibleSchedule = useMemo(() => {
    if (!selectedFacility) return [];
    if (showFullSchedule || selectedFacility.schedule.length <= 14) {
      return selectedFacility.schedule;
    }
    const startIdx = Math.max(0, selectedFacility.monthsElapsed - 3);
    const slice = selectedFacility.schedule.slice(startIdx, startIdx + 12);
    const last = selectedFacility.schedule[selectedFacility.schedule.length - 1];
    if (slice[slice.length - 1]?.period !== last.period) {
      return [...slice, last];
    }
    return slice;
  }, [selectedFacility, showFullSchedule]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold">信貸槓桿、負債風控與攤還總覽</h2>
            <Badge variant="default">
              {leverage.facilities.length} 筆信貸方案
            </Badge>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            以 `loans` 分頁 + `funding_tag` 自動對應庫存、股差/匯差拆解與 84 期本息攤還，取代手動每週複製快照 · 基準日 {leverage.asOfDate}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5 text-xs">
            <button
              onClick={() => setInterestBasis("full")}
              className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                interestBasis === "full"
                  ? "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                  : "text-[var(--muted-foreground)]"
              }`}
            >
              扣全期總息
            </button>
            <button
              onClick={() => setInterestBasis("accrued")}
              className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                interestBasis === "accrued"
                  ? "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                  : "text-[var(--muted-foreground)]"
              }`}
            >
              扣截至今日已繳息
            </button>
          </div>
        </div>
      </div>

      {/* Empty State if no loans configured */}
      {leverage.facilities.length === 0 ? (
        <Card className="p-6 text-center space-y-3">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary)]/15 text-[var(--primary)]">
            <Landmark className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold">尚未載入任何信貸方案（loans 分頁）</h3>
            <p className="mx-auto max-w-lg text-xs text-[var(--muted-foreground)]">
              請在私人 Google Sheet 新增 `loans` 分頁（或前往「試算表資料與匯入」下載 `loans.csv` 空白範本並匯入），並在 `transactions` 的 `funding_tag` 填入對應方案標籤即可自動啟動槓桿分析。
            </p>
          </div>
          <div>
            <Button onClick={onNavigateLedger}>
              <Database className="h-3.5 w-3.5" /> 前往試算表資料匯入 loans.csv
            </Button>
          </div>
        </Card>
      ) : (
        <>
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
                {formatMoney(leverage.netWorthTwd, currency, fx)}
              </div>
              <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                <span>
                  剩餘本金 {formatMoney(leverage.totalRemainingDebtTwd, currency, fx)}
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
                {formatMoney(leverage.totalLoanAssetValueTwd, currency, fx)}
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
                  {formatMoney(leverage.totalLoanGrossPnlTwd, currency, fx, {
                    signed: true,
                  })}
                </span>
                <span className="text-[var(--muted-foreground)] font-mono">
                  股 {formatMoney(leverage.totalLoanEquityPnlTwd, currency, fx, { signed: true, compact: true })} · 匯{" "}
                  {formatMoney(leverage.totalLoanFxPnlTwd, currency, fx, { signed: true, compact: true })}
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
                {formatMoney(activeNetPnl, currency, fx, { signed: true })}
              </div>
              <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                <span>
                  {interestBasis === "full" ? "扣除全期總利息" : "扣除截至今日已繳利息"}
                </span>
                <span className="font-mono text-[var(--warning)] tabular-nums">
                  -{formatMoney(activeInterestDeducted, currency, fx)}
                </span>
              </div>
            </Card>

            <Card className="p-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                <span className="flex items-center gap-1">
                  <Percent className="h-3.5 w-3.5" /> 每月本息現金流出
                </span>
                <Badge variant="outline">
                  加權 APR {(leverage.weightedApr * 100).toFixed(2)}%
                </Badge>
              </div>
              <div className="font-mono text-2xl font-bold tracking-tight tabular-nums">
                {formatMoney(leverage.totalMonthlyPaymentTwd, currency, fx)}
              </div>
              <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                <span>
                  實質成本 {formatMoney(leverage.totalCostTwd, currency, fx)}
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
                <h3 className="text-sm font-bold">各期信貸方案績效與股差/匯差拆解</h3>
                <p className="text-xs text-[var(--muted-foreground)]">
                  點選任一方案檢視該方案持股庫存與 84 期本息攤還明細；亦可點「篩選分析」檢視該期獨立 TWR 與水下圖
                </p>
              </div>
              <span className="font-mono text-xs text-[var(--muted-foreground)]">
                目前口徑：{interestBasis === "full" ? "扣除全期預估總利息" : "扣除截至基準日已繳利息"}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-right font-mono text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-[var(--muted-foreground)]">
                    <th className="px-3 py-2.5 text-left font-sans font-semibold">資金方案</th>
                    <th className="px-3 py-2.5 font-sans font-semibold">利率 / 期數</th>
                    <th className="px-3 py-2.5 font-sans font-semibold">實質台幣成本</th>
                    <th className="px-3 py-2.5 font-sans font-semibold">目前估值</th>
                    <th className="px-3 py-2.5 font-sans font-semibold">扣息前損益</th>
                    <th className="px-3 py-2.5 font-sans font-semibold">股差獲利</th>
                    <th className="px-3 py-2.5 font-sans font-semibold">匯差效益</th>
                    <th className="px-3 py-2.5 font-sans font-semibold">
                      {interestBasis === "full" ? "全期總息" : "已繳利息"}
                    </th>
                    <th className="px-3 py-2.5 font-sans font-semibold">扣息後淨利</th>
                    <th className="px-3 py-2.5 font-sans font-semibold">年化(前)</th>
                    <th className="px-3 py-2.5 text-center font-sans font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {leverage.facilities.map((f) => {
                    const isSelected = selectedFacility?.id === f.id;
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
                      <tr
                        key={f.id}
                        onClick={() => setSelectedLoanId(f.id)}
                        className={`cursor-pointer transition ${
                          isSelected
                            ? "bg-[var(--primary)]/10"
                            : "hover:bg-[var(--muted)]/40"
                        }`}
                      >
                        <td className="px-3 py-2.5 text-left font-sans">
                          <div className="font-semibold text-[var(--foreground)]">
                            {f.name}
                          </div>
                          <div className="text-[0.7rem] text-[var(--muted-foreground)] font-mono">
                            #{f.fundingTag} · {f.startDate} ({f.holdingDays}天)
                          </div>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">
                          <div>{(f.apr * 100).toFixed(2)}%</div>
                          <div className="text-[0.7rem] text-[var(--muted-foreground)]">
                            已繳 {f.monthsElapsed}/{f.termMonths} 期
                          </div>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {formatMoney(f.totalCostTwd, currency, fx)}
                        </td>
                        <td className="px-3 py-2.5 font-semibold tabular-nums">
                          {formatMoney(f.totalValueTwd, currency, fx)}
                        </td>
                        <td
                          className="px-3 py-2.5 font-semibold tabular-nums"
                          style={{
                            color:
                              f.grossPnlTwd >= 0 ? "var(--success)" : "var(--danger)",
                          }}
                        >
                          <div>{formatMoney(f.grossPnlTwd, currency, fx, { signed: true })}</div>
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
                          {formatMoney(f.equityPnlTwd, currency, fx, { signed: true })}
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
                            ? formatMoney(f.fxPnlTwd, currency, fx, { signed: true })
                            : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-[var(--warning)] tabular-nums">
                          -{formatMoney(interestCost, currency, fx)}
                        </td>
                        <td
                          className="px-3 py-2.5 font-bold tabular-nums"
                          style={{
                            color: netPnl >= 0 ? "var(--success)" : "var(--danger)",
                          }}
                        >
                          <div>{formatMoney(netPnl, currency, fx, { signed: true })}</div>
                          <div className="text-[0.7rem]">
                            {formatPercent(netRet, { signed: true })}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {f.annualizedGrossReturn !== null
                            ? formatPercent(f.annualizedGrossReturn, { signed: true })
                            : "<30天"}
                        </td>
                        <td
                          className="px-3 py-2.5 text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onSelectFundingFilter(f.fundingTag)}
                          >
                            獨立檢視
                          </Button>
                        </td>
                      </tr>
                    );
                  })}

                  {/* Combined Total Row */}
                  {leverage.facilities.length > 1 && (
                    <tr className="border-t-2 border-[var(--border)] bg-[var(--muted)]/40 font-bold">
                      <td className="px-3 py-2.5 text-left font-sans">全體信貸合併總計</td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {(leverage.weightedApr * 100).toFixed(2)}%
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {formatMoney(leverage.totalCostTwd, currency, fx)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {formatMoney(leverage.totalLoanAssetValueTwd, currency, fx)}
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
                          {formatMoney(leverage.totalLoanGrossPnlTwd, currency, fx, {
                            signed: true,
                          })}
                        </div>
                        <div className="text-[0.7rem]">
                          {formatPercent(leverage.totalLoanGrossReturn, { signed: true })}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {formatMoney(leverage.totalLoanEquityPnlTwd, currency, fx, {
                          signed: true,
                        })}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {formatMoney(leverage.totalLoanFxPnlTwd, currency, fx, {
                          signed: true,
                        })}
                      </td>
                      <td className="px-3 py-2.5 text-[var(--warning)] tabular-nums">
                        -{formatMoney(activeInterestDeducted, currency, fx)}
                      </td>
                      <td
                        className="px-3 py-2.5 tabular-nums"
                        style={{
                          color: activeNetPnl >= 0 ? "var(--success)" : "var(--danger)",
                        }}
                      >
                        <div>{formatMoney(activeNetPnl, currency, fx, { signed: true })}</div>
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

          {/* Selected Facility Drill-down: Holdings + Amortization Curve */}
          {selectedFacility && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
              {/* Left 2 cols: Tagged Holdings Breakdown */}
              <Card className="xl:col-span-2 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold">
                      {selectedFacility.name} · 持股庫存與資金參數
                    </h3>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      自動彙總標籤 <code className="font-mono">#{selectedFacility.fundingTag}</code> 之所有交易
                    </p>
                  </div>
                  <Badge variant="outline">
                    真實 APR {(selectedFacility.effectiveApr * 100).toFixed(2)}%
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-3 text-xs">
                  <div>
                    <div className="text-[var(--muted-foreground)]">核貸 / 實撥本金</div>
                    <div className="font-mono font-semibold tabular-nums">
                      {formatMoney(selectedFacility.principalTwd, "TWD", fx)} /{" "}
                      {formatMoney(selectedFacility.disbursedTwd, "TWD", fx)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--muted-foreground)]">月繳 / 已還本金</div>
                    <div className="font-mono font-semibold tabular-nums">
                      {formatMoney(selectedFacility.monthlyPaymentTwd, "TWD", fx)} /{" "}
                      {formatMoney(selectedFacility.repaidPrincipalToDateTwd, "TWD", fx)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--muted-foreground)]">套利利差 (年化-APR)</div>
                    <div
                      className="font-mono font-semibold tabular-nums"
                      style={{
                        color:
                          selectedFacility.carrySpread === null
                            ? "var(--muted-foreground)"
                            : selectedFacility.carrySpread >= 0
                              ? "var(--success)"
                              : "var(--danger)",
                      }}
                    >
                      {selectedFacility.carrySpread !== null
                        ? formatPercent(selectedFacility.carrySpread, { signed: true })
                        : "持有未滿 30 天"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--muted-foreground)]">入金均匯 / 現匯</div>
                    <div className="font-mono font-semibold tabular-nums">
                      {selectedFacility.avgEntryFxRate
                        ? `${selectedFacility.avgEntryFxRate.toFixed(2)} → ${fx.toFixed(2)}`
                        : "台幣計價"}
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right font-mono text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                        <th className="py-2 text-left font-sans">標的</th>
                        <th className="py-2 font-sans">股數</th>
                        <th className="py-2 font-sans">最新價</th>
                        <th className="py-2 font-sans">市值</th>
                        <th className="py-2 font-sans">未實現損益</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {selectedFacility.holdings.map((h) => (
                        <tr key={h.symbol}>
                          <td className="py-2 text-left font-sans">
                            <div className="font-semibold font-mono">{h.symbol}</div>
                            <div className="text-[0.7rem] text-[var(--muted-foreground)] truncate max-w-[140px]">
                              {h.name}
                            </div>
                          </td>
                          <td className="py-2 tabular-nums">
                            {h.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                          </td>
                          <td className="py-2 tabular-nums">
                            {formatPrice(h.latestPrice, h.currency)}
                          </td>
                          <td className="py-2 font-semibold tabular-nums">
                            {formatMoney(h.marketValueTwd, currency, fx)}
                          </td>
                          <td
                            className="py-2 tabular-nums"
                            style={{
                              color:
                                h.unrealizedPnlTwd >= 0
                                  ? "var(--success)"
                                  : "var(--danger)",
                            }}
                          >
                            {formatMoney(h.unrealizedPnlTwd, currency, fx, { signed: true })}
                          </td>
                        </tr>
                      ))}
                      {selectedFacility.residualCashUsd > 0.01 && (
                        <tr>
                          <td className="py-2 text-left font-sans">
                            <div className="font-semibold font-mono">USD 餘額</div>
                            <div className="text-[0.7rem] text-[var(--muted-foreground)]">
                              未投入/平倉殘留美元
                            </div>
                          </td>
                          <td className="py-2 tabular-nums">
                            {selectedFacility.residualCashUsd.toFixed(2)}
                          </td>
                          <td className="py-2 tabular-nums">$1.00</td>
                          <td className="py-2 font-semibold tabular-nums">
                            {formatMoney(
                              selectedFacility.residualCashUsd * fx,
                              currency,
                              fx
                            )}
                          </td>
                          <td className="py-2 text-[var(--muted-foreground)]">—</td>
                        </tr>
                      )}
                      {selectedFacility.holdings.length === 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            className="py-6 text-center font-sans text-[var(--muted-foreground)]"
                          >
                            找不到對應標籤 #{selectedFacility.fundingTag} 的交易紀錄
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Right 3 cols: Amortization Curve + Table */}
              <Card className="xl:col-span-3 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold">
                      本息攤還進度圖（{selectedFacility.termMonths} 期）
                    </h3>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      藍區：剩餘本金遞減 · 橘區：累積利息支出 · 綠虛線：目前進度（第 {selectedFacility.monthsElapsed} 期）
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowFullSchedule((v) => !v)}
                  >
                    {showFullSchedule ? (
                      <>
                        <ChevronUp className="h-3.5 w-3.5" /> 收合明細
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3.5 w-3.5" /> 展開全部 {selectedFacility.termMonths} 期
                      </>
                    )}
                  </Button>
                </div>

                <LoanAmortizationChart
                  schedule={selectedFacility.schedule}
                  monthsElapsed={selectedFacility.monthsElapsed}
                  currency={currency}
                  fxRate={fx}
                />

                <div className="max-h-64 overflow-y-auto rounded-lg border border-[var(--border)]">
                  <table className="w-full border-collapse text-right font-mono text-xs">
                    <thead className="sticky top-0 bg-[var(--card)]">
                      <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                        <th className="px-3 py-2 text-left font-sans">期數</th>
                        <th className="px-3 py-2 text-left font-sans">扣款日</th>
                        <th className="px-3 py-2 font-sans">償還本金</th>
                        <th className="px-3 py-2 font-sans">償還利息</th>
                        <th className="px-3 py-2 font-sans">每期應繳</th>
                        <th className="px-3 py-2 font-sans">剩餘本金</th>
                        <th className="px-3 py-2 text-center font-sans">狀態</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {visibleSchedule.map((r) => (
                        <tr
                          key={r.period}
                          className={
                            r.period === selectedFacility.monthsElapsed
                              ? "bg-[var(--success)]/10 font-semibold"
                              : ""
                          }
                        >
                          <td className="px-3 py-1.5 text-left">#{r.period}</td>
                          <td className="px-3 py-1.5 text-left text-[var(--muted-foreground)]">
                            {r.paymentDate}
                          </td>
                          <td className="px-3 py-1.5 tabular-nums">
                            {formatMoney(r.principalTwd, currency, fx)}
                          </td>
                          <td className="px-3 py-1.5 text-[var(--warning)] tabular-nums">
                            {formatMoney(r.interestTwd, currency, fx)}
                          </td>
                          <td className="px-3 py-1.5 tabular-nums">
                            {formatMoney(r.paymentTwd, currency, fx)}
                          </td>
                          <td className="px-3 py-1.5 tabular-nums">
                            {formatMoney(r.remainingPrincipalTwd, currency, fx)}
                          </td>
                          <td className="px-3 py-1.5 text-center font-sans">
                            <Badge variant={r.paid ? "success" : "muted"}>
                              {r.paid ? "已繳" : "待繳"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}
        </>
      )}

      {/* Interactive Calculator: Loan Terms & Lump-Sum vs DCA */}
      <Card className="p-4 lg:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <Calculator className="h-4 w-4 text-[var(--primary)]" />
              互動式信貸條件試算 &amp; 一次投入 vs 定期定額對比
            </h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              取代原試算表 `信貸條件` 與 `定期定額與一次投入比較`：比較「一次借入並投入」vs「將每月還款金額定期定額投資」之期末資產差距
            </p>
          </div>
          <Badge variant={simResult.finalAdvantageTwd >= 0 ? "success" : "danger"}>
            期滿優勢：{formatMoney(simResult.finalAdvantageTwd, "TWD", fx, { signed: true })}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 text-xs">
          <div>
            <label className="mb-1 block text-[var(--muted-foreground)]">核貸本金 (NTD)</label>
            <Input
              type="number"
              value={simPrincipal}
              onChange={(e) => setSimPrincipal(e.target.value)}
              className="font-mono"
            />
          </div>
          <div>
            <label className="mb-1 block text-[var(--muted-foreground)]">開辦手續費 (NTD)</label>
            <Input
              type="number"
              value={simOrigFee}
              onChange={(e) => setSimOrigFee(e.target.value)}
              className="font-mono"
            />
          </div>
          <div>
            <label className="mb-1 block text-[var(--muted-foreground)]">標榜年利率 (%)</label>
            <Input
              type="number"
              step="0.05"
              value={simAprPct}
              onChange={(e) => setSimAprPct(e.target.value)}
              className="font-mono"
            />
          </div>
          <div>
            <label className="mb-1 block text-[var(--muted-foreground)]">貸款期數 (月)</label>
            <Input
              type="number"
              value={simMonths}
              onChange={(e) => setSimMonths(e.target.value)}
              className="font-mono"
            />
          </div>
          <div>
            <label className="mb-1 block text-[var(--muted-foreground)]">預期年化資本成長 (%)</label>
            <Input
              type="number"
              step="0.5"
              value={simGrowthPct}
              onChange={(e) => setSimGrowthPct(e.target.value)}
              className="font-mono"
            />
          </div>
          <div>
            <label className="mb-1 block text-[var(--muted-foreground)]">假設股息殖利率 (%)</label>
            <Input
              type="number"
              step="0.1"
              value={simYieldPct}
              onChange={(e) => setSimYieldPct(e.target.value)}
              className="font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-3 text-xs">
          <div className="flex justify-between sm:block">
            <span className="text-[var(--muted-foreground)]">每期應繳月付金 (PMT)</span>
            <div className="font-mono text-sm font-bold tabular-nums">
              {formatMoney(simResult.monthlyPaymentTwd, "TWD", fx)}
            </div>
          </div>
          <div className="flex justify-between sm:block">
            <span className="text-[var(--muted-foreground)]">全期總利息支出</span>
            <div className="font-mono text-sm font-bold text-[var(--warning)] tabular-nums">
              {formatMoney(simResult.totalInterestTwd, "TWD", fx)}
            </div>
          </div>
          <div className="flex justify-between sm:block">
            <span className="text-[var(--muted-foreground)]">含開辦費真實總費用年百分率 (APR)</span>
            <div className="font-mono text-sm font-bold text-[var(--primary)] tabular-nums">
              {(simResult.effectiveApr * 100).toFixed(3)}%
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-right font-mono text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                <th className="px-3 py-2 text-left font-sans">第 N 年</th>
                <th className="px-3 py-2 font-sans">信貸一次投入資產</th>
                <th className="px-3 py-2 font-sans">等額月繳定期定額資產</th>
                <th className="px-3 py-2 font-sans">信貸一次投入超額優勢</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {simResult.yearlyPoints.map((pt) => (
                <tr key={pt.year} className="hover:bg-[var(--muted)]/40">
                  <td className="px-3 py-2 text-left">第 {pt.year} 年</td>
                  <td className="px-3 py-2 font-semibold tabular-nums">
                    {formatMoney(pt.lumpSumValueTwd, "TWD", fx)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatMoney(pt.dcaValueTwd, "TWD", fx)}
                  </td>
                  <td
                    className="px-3 py-2 font-bold tabular-nums"
                    style={{
                      color:
                        pt.advantageTwd >= 0 ? "var(--success)" : "var(--danger)",
                    }}
                  >
                    {formatMoney(pt.advantageTwd, "TWD", fx, { signed: true })}
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
