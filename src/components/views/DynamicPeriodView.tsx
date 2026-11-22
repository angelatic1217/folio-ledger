"use client";

import { useMemo, useState } from "react";
import { Badge, Card, Input } from "@/components/ui/primitives";
import { computePeriodPerformance } from "@/lib/quant/attribution";
import { addDaysIso } from "@/lib/quant/calendar";
import { formatMoney, formatPercent } from "@/lib/utils";
import type { MarketDataBundle } from "@/types/market";
import type { PortfolioScope, QuantEngineOutput } from "@/types/quant";
import type { CurrencyCode, PortfolioSheetsData } from "@/types/sheet";

interface DynamicPeriodViewProps {
  engine: QuantEngineOutput;
  sheets: PortfolioSheetsData;
  market: MarketDataBundle;
  scope: PortfolioScope;
  currency: CurrencyCode;
}

type PresetKey = "1M" | "3M" | "6M" | "YTD" | "1Y" | "CUSTOM";

export function DynamicPeriodView({
  engine,
  sheets,
  market,
  scope,
  currency,
}: DynamicPeriodViewProps) {
  const defaultEnd = engine.asOfDate;
  const defaultStart = `${defaultEnd.slice(0, 4)}-01-01`;

  const [preset, setPreset] = useState<PresetKey>("YTD");
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);

  const activeSeries =
    scope === "total" ? engine.totalSeries : engine.investedSeries;

  const applyPreset = (p: Exclude<PresetKey, "CUSTOM">) => {
    setPreset(p);
    setEndDate(engine.asOfDate);
    if (p === "1M") setStartDate(addDaysIso(engine.asOfDate, -31));
    else if (p === "3M") setStartDate(addDaysIso(engine.asOfDate, -92));
    else if (p === "6M") setStartDate(addDaysIso(engine.asOfDate, -183));
    else if (p === "YTD") setStartDate(`${engine.asOfDate.slice(0, 4)}-01-01`);
    else if (p === "1Y") setStartDate(addDaysIso(engine.asOfDate, -365));
  };

  const summary = useMemo(
    () =>
      computePeriodPerformance({
        startDate,
        endDate,
        transactions: sheets.transactions,
        assets: sheets.assets,
        market,
        dailySeries: activeSeries,
        scope,
      }),
    [startDate, endDate, sheets, market, activeSeries, scope]
  );

  const summaryCards = [
    { label: "期初總估值", value: formatMoney(summary.startValueTwd, currency, engine.latestFxRate) },
    { label: "區間買入投入", value: formatMoney(summary.buyInflowTwd, currency, engine.latestFxRate) },
    { label: "區間賣出/股利收回", value: formatMoney(summary.sellAndDividendOutflowTwd, currency, engine.latestFxRate) },
    { label: "期末總估值", value: formatMoney(summary.endValueTwd, currency, engine.latestFxRate) },
    {
      label: "區間淨損益",
      value: formatMoney(summary.netPnlTwd, currency, engine.latestFxRate, { signed: true }),
      color: summary.netPnlTwd >= 0 ? "var(--success)" : "var(--danger)",
    },
    {
      label: "精確 Modified Dietz / TWR",
      value: `${formatPercent(summary.modifiedDietz, { signed: true })} / ${formatPercent(summary.twr, { signed: true })}`,
      color: summary.twr >= 0 ? "var(--success)" : "var(--danger)",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold">動態區間績效與美股匯率歸因</h2>
        <p className="text-xs text-[var(--muted-foreground)]">
          任意起訖日查詢：自動計算精確日加權 Modified Dietz、Daily TWR 與美股原幣/台幣/匯率影響拆解
        </p>
      </div>

      {/* Query Console */}
      <Card className="grid grid-cols-1 items-end gap-4 p-4 lg:grid-cols-12">
        <div className="space-y-1.5 lg:col-span-5">
          <div className="text-xs font-medium text-[var(--muted-foreground)]">
            快捷區間預設
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {(["1M", "3M", "6M", "YTD", "1Y"] as const).map((p) => (
              <button
                key={p}
                onClick={() => applyPreset(p)}
                className={`rounded-lg border px-2.5 py-1.5 font-mono transition cursor-pointer ${
                  preset === p
                    ? "border-transparent bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                    : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:col-span-4">
          <div>
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
              起始日期
            </label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => {
                setPreset("CUSTOM");
                setStartDate(e.target.value);
              }}
              className="font-mono"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
              結束日期
            </label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => {
                setPreset("CUSTOM");
                setEndDate(e.target.value);
              }}
              className="font-mono"
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--muted)]/50 p-2.5 text-xs lg:col-span-3">
          <div>
            <div className="text-[var(--muted-foreground)]">
              USD/TWD（{summary.calendarDays} 天）
            </div>
            <div className="font-mono font-semibold tabular-nums">
              {summary.startFx.toFixed(2)} → {summary.endFx.toFixed(2)}
            </div>
          </div>
          <Badge variant={summary.fxReturn >= 0 ? "success" : "danger"}>
            {formatPercent(summary.fxReturn, { signed: true })}
          </Badge>
        </div>
      </Card>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {summaryCards.map((c) => (
          <Card key={c.label} className="p-3 space-y-1">
            <div className="text-xs text-[var(--muted-foreground)]">{c.label}</div>
            <div
              className="font-mono text-sm font-bold tabular-nums"
              style={{ color: c.color }}
            >
              {c.value}
            </div>
          </Card>
        ))}
      </div>

      {/* Holdings & FX Attribution Table */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-sm font-bold">區間持倉動態與匯率歸因明細</h3>
          <span className="font-mono text-xs text-[var(--muted-foreground)]">
            台幣報酬 = (1 + 原幣報酬) × (1 + 匯率變動) - 1
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]/60 text-[var(--muted-foreground)]">
                <th className="px-4 py-2.5">標的</th>
                <th className="px-3 py-2.5 text-right">期初股數 (還原)</th>
                <th className="px-3 py-2.5 text-right">區間淨增減</th>
                <th className="px-3 py-2.5 text-right">期末股數</th>
                <th className="px-3 py-2.5 text-right">區間淨投入</th>
                <th className="px-3 py-2.5 text-right">原幣漲跌幅</th>
                <th className="px-3 py-2.5 text-right">台幣換算漲跌幅</th>
                <th className="px-4 py-2.5 text-right">匯率影響 (FX)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {summary.holdings.map((h) => (
                <tr key={h.symbol} className="hover:bg-[var(--muted)]/40">
                  <td className="px-4 py-2.5">
                    <span className="font-mono font-bold">{h.symbol}</span>
                    <span className="ml-1.5 text-[var(--muted-foreground)]">
                      {h.name}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                    {h.startShares.toLocaleString("en-US", { maximumFractionDigits: 3 })}
                  </td>
                  <td
                    className="px-3 py-2.5 text-right font-mono tabular-nums"
                    style={{
                      color:
                        h.deltaShares > 0
                          ? "var(--success)"
                          : h.deltaShares < 0
                            ? "var(--danger)"
                            : "var(--muted-foreground)",
                    }}
                  >
                    {h.deltaShares > 0 ? "+" : ""}
                    {h.deltaShares.toLocaleString("en-US", { maximumFractionDigits: 3 })}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums">
                    {h.endShares.toLocaleString("en-US", { maximumFractionDigits: 3 })}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                    {formatMoney(h.netCashFlowTwd, currency, engine.latestFxRate)}
                  </td>
                  <td
                    className="px-3 py-2.5 text-right font-mono font-medium tabular-nums"
                    style={{
                      color:
                        h.localReturn === null
                          ? "var(--muted-foreground)"
                          : h.localReturn >= 0
                            ? "var(--success)"
                            : "var(--danger)",
                    }}
                  >
                    {formatPercent(h.localReturn, { signed: true })}
                  </td>
                  <td
                    className="px-3 py-2.5 text-right font-mono font-bold tabular-nums"
                    style={{
                      color:
                        h.twdReturn === null
                          ? "var(--muted-foreground)"
                          : h.twdReturn >= 0
                            ? "var(--success)"
                            : "var(--danger)",
                    }}
                  >
                    {formatPercent(h.twdReturn, { signed: true })}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    {h.currency === "TWD" ? (
                      <span className="text-[var(--muted-foreground)]">0.00% (本幣)</span>
                    ) : (
                      <span
                        style={{
                          color:
                            (h.fxImpact ?? 0) >= 0 ? "var(--primary)" : "var(--warning)",
                        }}
                      >
                        {formatPercent(h.fxImpact, { signed: true })}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {summary.holdings.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="py-8 text-center text-[var(--muted-foreground)]"
                  >
                    所選區間內無持股或交易紀錄
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
