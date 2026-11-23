"use client";

import { useState } from "react";
import { AnnualAlphaBarChart } from "@/components/charts/AnnualAlphaBarChart";
import { Card } from "@/components/ui/primitives";
import { usePrivacy } from "@/lib/privacy/context";
import { formatPercent } from "@/lib/utils";
import type { QuantEngineOutput } from "@/types/quant";
import type { BenchmarkScope, CurrencyCode } from "@/types/sheet";

interface AnnualAlphaViewProps {
  engine: QuantEngineOutput;
  currency: CurrencyCode;
}

const SCOPE_OPTIONS: Array<{ key: BenchmarkScope; label: string }> = [
  { key: "ALL", label: "全資產 vs 全球基準" },
  { key: "TW", label: "台股部位 vs 0050" },
  { key: "US", label: "美股部位 vs VOO" },
];

export function AnnualAlphaView({ engine, currency }: AnnualAlphaViewProps) {
  const { fmtMoney } = usePrivacy();
  const [group, setGroup] = useState<BenchmarkScope>("ALL");
  const rows = engine.annualByScope[group] ?? [];
  const benchName = rows[0]?.benchmarkName ?? "市場基準";

  const cumulativeTwr = rows.reduce((acc, r) => acc * (1 + r.twr), 1) - 1;
  const cumulativeBench =
    rows.length > 0 && rows.every((r) => r.benchmarkReturn !== null)
      ? rows.reduce((acc, r) => acc * (1 + (r.benchmarkReturn ?? 0)), 1) - 1
      : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">歷年績效彙總與市場基準 Alpha 對比</h2>
          <p className="text-xs text-[var(--muted-foreground)]">
            全自動計算歷年精確 Modified Dietz、Daily TWR 與含息 TWD 換算基準報酬率，不再需要手動查詢填表
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 text-xs">
          {SCOPE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setGroup(opt.key)}
              className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                group === opt.key
                  ? "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grouped Bar Chart */}
      <Card className="p-4 lg:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold">
            歷年 TWR 報酬率對比：我的投組 vs {benchName}
          </h3>
          <div className="flex items-center gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[var(--chart-1)]" />
              我的投組 (TWR)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[var(--chart-2)]" />
              {benchName}
            </span>
          </div>
        </div>
        <AnnualAlphaBarChart rows={rows} benchmarkLabel={benchName} />
      </Card>

      {/* Annual Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]/60 text-[var(--muted-foreground)]">
                <th className="px-4 py-3">年份</th>
                <th className="px-3 py-3 text-right">期初市值</th>
                <th className="px-3 py-3 text-right">當年淨投入</th>
                <th className="px-3 py-3 text-right">期末市值</th>
                <th className="px-3 py-3 text-right">當年淨損益</th>
                <th className="px-3 py-3 text-right">Modified Dietz</th>
                <th className="px-3 py-3 text-right">精確 TWR</th>
                <th className="px-3 py-3 text-right">基準 ({benchName})</th>
                <th className="px-4 py-3 text-right">超額 Alpha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((r) => (
                <tr key={r.year} className="hover:bg-[var(--muted)]/40">
                  <td className="px-4 py-3 font-semibold">{r.year}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">
                    {fmtMoney(r.startValueTwd, currency, engine.latestFxRate)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">
                    {fmtMoney(r.netInflowTwd, currency, engine.latestFxRate)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono font-semibold tabular-nums">
                    {fmtMoney(r.endValueTwd, currency, engine.latestFxRate)}
                  </td>
                  <td
                    className="px-3 py-3 text-right font-mono tabular-nums"
                    style={{
                      color: r.netPnlTwd >= 0 ? "var(--success)" : "var(--danger)",
                    }}
                  >
                    {fmtMoney(r.netPnlTwd, currency, engine.latestFxRate, {
                      signed: true,
                    })}
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">
                    {formatPercent(r.modifiedDietz, { signed: true })}
                  </td>
                  <td
                    className="px-3 py-3 text-right font-mono font-bold tabular-nums"
                    style={{
                      color: r.twr >= 0 ? "var(--success)" : "var(--danger)",
                    }}
                  >
                    {formatPercent(r.twr, { signed: true })}
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-[var(--muted-foreground)]">
                    {formatPercent(r.benchmarkReturn, { signed: true })}
                  </td>
                  <td
                    className="px-4 py-3 text-right font-mono font-bold tabular-nums"
                    style={{
                      color:
                        r.alpha === null
                          ? "var(--muted-foreground)"
                          : r.alpha >= 0
                            ? "var(--success)"
                            : "var(--danger)",
                    }}
                  >
                    {formatPercent(r.alpha, { signed: true })}
                  </td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr className="bg-[var(--muted)]/40 font-semibold">
                  <td className="px-4 py-3">歷年複合累積報酬</td>
                  <td colSpan={5} className="px-3 py-3 text-right text-[var(--muted-foreground)]">
                    依歷年 TWR 幾何連乘
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-[var(--success)] tabular-nums">
                    {formatPercent(cumulativeTwr, { signed: true })}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-[var(--muted-foreground)] tabular-nums">
                    {formatPercent(cumulativeBench, { signed: true })}
                  </td>
                  <td
                    className="px-4 py-3 text-right font-mono tabular-nums"
                    style={{
                      color:
                        cumulativeBench === null
                          ? "var(--muted-foreground)"
                          : cumulativeTwr - cumulativeBench >= 0
                            ? "var(--success)"
                            : "var(--danger)",
                    }}
                  >
                    {cumulativeBench !== null
                      ? formatPercent(cumulativeTwr - cumulativeBench, { signed: true })
                      : "—"}
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
