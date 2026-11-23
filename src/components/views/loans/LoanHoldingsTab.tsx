"use client";

import { ArrowUpRight } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { usePrivacy } from "@/lib/privacy/context";
import { formatPercent, formatPrice } from "@/lib/utils";
import type { LoanFacilitySummary } from "@/types/quant";
import type { CurrencyCode } from "@/types/sheet";

const WEIGHT_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

interface LoanHoldingsTabProps {
  facilities: LoanFacilitySummary[];
  selectedFacility: LoanFacilitySummary;
  currency: CurrencyCode;
  fxRate: number;
  onSelectLoan: (loanId: string) => void;
  onSelectFundingFilter: (tag: string) => void;
}

export function LoanHoldingsTab({
  facilities,
  selectedFacility,
  currency,
  fxRate,
  onSelectLoan,
  onSelectFundingFilter,
}: LoanHoldingsTabProps) {
  const { fmtMoney, fmtUsd, fmtShares } = usePrivacy();
  const f = selectedFacility;
  const totalVal = Math.max(1, f.totalValueTwd);

  const weightItems = [
    ...f.holdings.map((h, idx) => ({
      key: h.symbol,
      label: h.symbol,
      valueTwd: h.marketValueTwd,
      pct: (h.marketValueTwd / totalVal) * 100,
      color: WEIGHT_COLORS[idx % WEIGHT_COLORS.length],
    })),
    ...(f.residualCashUsd > 0.01
      ? [
          {
            key: "USD_CASH",
            label: "USD 現金餘額",
            valueTwd: f.residualCashUsd * fxRate,
            pct: ((f.residualCashUsd * fxRate) / totalVal) * 100,
            color: "var(--muted-foreground)",
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-5">
      {/* Facility Selector Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {facilities.map((item) => {
            const active = item.id === f.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectLoan(item.id)}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition cursor-pointer ${
                  active
                    ? "border-[var(--primary)] bg-[var(--primary)]/15 font-semibold text-[var(--primary)]"
                    : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                <span>{item.name}</span>
                <span className="font-mono text-[0.7rem] opacity-80">
                  #{item.fundingTag}
                </span>
              </button>
            );
          })}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => onSelectFundingFilter(f.fundingTag)}
        >
          檢視 #{f.fundingTag} 獨立 TWR 與水下圖
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* 4 Financing Parameter Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>
              {f.refinancedPayoffTwd > 0 ? "核貸總本金（含代償）" : "核貸 / 實撥本金"}
            </span>
            {f.status === "refinanced" ? (
              <Badge variant="muted">已轉貸結清</Badge>
            ) : f.status === "closed" ? (
              <Badge variant="muted">已結清</Badge>
            ) : (
              <Badge variant="success">還款中</Badge>
            )}
          </div>
          <div className="font-mono text-xl font-bold tabular-nums">
            {fmtMoney(f.principalTwd, "TWD", fxRate)}
          </div>
          <div className="text-xs text-[var(--muted-foreground)] font-mono">
            {f.refinancedPayoffTwd > 0
              ? `代償 ${fmtMoney(f.refinancedPayoffTwd, "TWD", fxRate)} + 新撥 ${fmtMoney(f.disbursedTwd, "TWD", fxRate)}`
              : `實撥 ${fmtMoney(f.disbursedTwd, "TWD", fxRate)} · 匯費 ${fmtMoney(f.wireFeeTwd, "TWD", fxRate)}`}
          </div>
        </Card>

        <Card className="p-4 space-y-1.5">
          <div className="text-xs text-[var(--muted-foreground)]">
            {f.status === "active" ? "目前月繳 / 剩餘本金" : "結清金額 / 目前負債"}
          </div>
          <div className="font-mono text-xl font-bold tabular-nums">
            {f.status === "active"
              ? fmtMoney(f.activeMonthlyPaymentTwd, "TWD", fxRate)
              : f.payoffTwd
                ? fmtMoney(f.payoffTwd, "TWD", fxRate)
                : "已結清"}
          </div>
          <div className="text-xs text-[var(--muted-foreground)] font-mono">
            {f.status === "active"
              ? `剩餘本金 ${fmtMoney(f.remainingPrincipalTwd, "TWD", fxRate)}`
              : `已於 ${f.closedDate ?? "—"} 結清 · 剩餘負債 NT$ 0`}
          </div>
        </Card>

        <Card className="p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>真實含費 APR / 套利利差</span>
            <Badge variant="outline">標榜 {(f.apr * 100).toFixed(2)}%</Badge>
          </div>
          <div className="font-mono text-xl font-bold tabular-nums">
            {(f.effectiveApr * 100).toFixed(2)}%
          </div>
          <div
            className="text-xs font-mono font-medium"
            style={{
              color:
                f.carrySpread === null
                  ? "var(--muted-foreground)"
                  : f.carrySpread >= 0
                    ? "var(--success)"
                    : "var(--danger)",
            }}
          >
            {f.carrySpread !== null
              ? `套利利差 ${formatPercent(f.carrySpread, { signed: true })} (年化 − APR)`
              : "持有未滿 30 天（不外推年化）"}
          </div>
        </Card>

        <Card className="p-4 space-y-1.5">
          <div className="text-xs text-[var(--muted-foreground)]">
            入金均匯 → 現行匯率 · 股/匯拆解
          </div>
          <div className="font-mono text-xl font-bold tabular-nums">
            {f.avgEntryFxRate
              ? `${f.avgEntryFxRate.toFixed(2)} → ${fxRate.toFixed(2)}`
              : "台幣計價"}
          </div>
          <div className="text-xs font-mono text-[var(--muted-foreground)]">
            股{" "}
            <span
              style={{
                color: f.equityPnlTwd >= 0 ? "var(--success)" : "var(--danger)",
              }}
            >
              {fmtMoney(f.equityPnlTwd, currency, fxRate, {
                signed: true,
                compact: true,
              })}
            </span>{" "}
            · 匯{" "}
            <span
              style={{
                color:
                  (f.fxPnlTwd ?? 0) >= 0 ? "var(--success)" : "var(--danger)",
              }}
            >
              {f.fxPnlTwd !== null
                ? fmtMoney(f.fxPnlTwd, currency, fxRate, {
                    signed: true,
                    compact: true,
                  })
                : "—"}
            </span>
          </div>
        </Card>
      </div>

      {/* Portfolio Weight Allocation Bar */}
      {weightItems.length > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold">
                {f.name} · 資金配置權重分佈
              </h3>
              <p className="text-xs text-[var(--muted-foreground)]">
                依最新收盤市值計算（含殘留未投入美元活存）
              </p>
            </div>
            <span className="font-mono text-xs font-semibold tabular-nums">
              總估值 {fmtMoney(f.totalValueTwd, currency, fxRate)}
              {f.receivedUsd ? ` (${fmtUsd(f.totalValueUsd)} USD)` : ""}
            </span>
          </div>

          <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--muted)]">
            {weightItems.map((w) => (
              <div
                key={w.key}
                style={{
                  width: `${Math.max(0.5, w.pct)}%`,
                  backgroundColor: w.color,
                }}
                title={`${w.label}: ${w.pct.toFixed(1)}%`}
              />
            ))}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
            {weightItems.map((w) => (
              <div key={w.key} className="inline-flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: w.color }}
                />
                <span className="font-mono font-semibold">{w.label}</span>
                <span className="font-mono text-[var(--muted-foreground)] tabular-nums">
                  {w.pct.toFixed(1)}% ({fmtMoney(w.valueTwd, currency, fxRate)})
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Full-Width Holdings Detail Table */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
          <div>
            <h3 className="text-sm font-bold">
              持股庫存明細（標籤 <code className="font-mono">#{f.fundingTag}</code>）
            </h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              已自動涵蓋拆股調整、DRIP 股息再投入與換股後之最新股數與平均成本
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-right font-mono text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-[var(--muted-foreground)]">
                <th className="px-4 py-2.5 text-left font-sans font-semibold">標的</th>
                <th className="px-4 py-2.5 font-sans font-semibold">持有股數</th>
                <th className="px-4 py-2.5 font-sans font-semibold">最新收盤價</th>
                <th className="px-4 py-2.5 font-sans font-semibold">原幣市值 (USD)</th>
                <th className="px-4 py-2.5 font-sans font-semibold">目前市值</th>
                <th className="px-4 py-2.5 font-sans font-semibold">投入成本</th>
                <th className="px-4 py-2.5 font-sans font-semibold">佔比</th>
                <th className="px-4 py-2.5 font-sans font-semibold">未實現損益</th>
                <th className="px-4 py-2.5 font-sans font-semibold">未實現報酬率</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {f.holdings.map((h) => {
                const pnlPct =
                  h.costBasisTwd > 0 ? h.unrealizedPnlTwd / h.costBasisTwd : null;
                const weightPct = (h.marketValueTwd / totalVal) * 100;
                return (
                  <tr key={h.symbol} className="hover:bg-[var(--muted)]/40">
                    <td className="px-4 py-2.5 text-left font-sans">
                      <div className="font-mono font-semibold">{h.symbol}</div>
                      <div className="text-[0.7rem] text-[var(--muted-foreground)]">
                        {h.name}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {fmtShares(h.shares, { maxDigits: 4 })}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {formatPrice(h.latestPrice, h.currency)}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {fmtUsd(h.marketValueUsd)}
                    </td>
                    <td className="px-4 py-2.5 font-semibold tabular-nums">
                      {fmtMoney(h.marketValueTwd, currency, fxRate)}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--muted-foreground)] tabular-nums">
                      {fmtMoney(h.costBasisTwd, currency, fxRate)}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {weightPct.toFixed(1)}%
                    </td>
                    <td
                      className="px-4 py-2.5 font-semibold tabular-nums"
                      style={{
                        color:
                          h.unrealizedPnlTwd >= 0
                            ? "var(--success)"
                            : "var(--danger)",
                      }}
                    >
                      {fmtMoney(h.unrealizedPnlTwd, currency, fxRate, {
                        signed: true,
                      })}
                    </td>
                    <td
                      className="px-4 py-2.5 font-semibold tabular-nums"
                      style={{
                        color:
                          (pnlPct ?? 0) >= 0 ? "var(--success)" : "var(--danger)",
                      }}
                    >
                      {formatPercent(pnlPct, { signed: true })}
                    </td>
                  </tr>
                );
              })}

              {f.residualCashUsd > 0.01 && (
                <tr className="hover:bg-[var(--muted)]/40">
                  <td className="px-4 py-2.5 text-left font-sans">
                    <div className="font-mono font-semibold">USD 現金餘額</div>
                    <div className="text-[0.7rem] text-[var(--muted-foreground)]">
                      未投入／平倉殘留美元活存
                    </div>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {fmtShares(f.residualCashUsd, { maxDigits: 2 })}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">$1.00</td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {fmtUsd(f.residualCashUsd)}
                  </td>
                  <td className="px-4 py-2.5 font-semibold tabular-nums">
                    {fmtMoney(f.residualCashUsd * fxRate, currency, fxRate)}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--muted-foreground)]">—</td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {(((f.residualCashUsd * fxRate) / totalVal) * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-2.5 text-[var(--muted-foreground)]">—</td>
                  <td className="px-4 py-2.5 text-[var(--muted-foreground)]">—</td>
                </tr>
              )}

              {f.holdings.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="py-8 text-center font-sans text-[var(--muted-foreground)]"
                  >
                    找不到對應標籤 #{f.fundingTag} 的持股紀錄
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
