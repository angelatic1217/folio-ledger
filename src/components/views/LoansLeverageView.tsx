"use client";

import {
  Briefcase,
  Calculator,
  CalendarClock,
  Database,
  Landmark,
  LayoutGrid,
} from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { LoanAmortizationTab } from "@/components/views/loans/LoanAmortizationTab";
import { LoanHoldingsTab } from "@/components/views/loans/LoanHoldingsTab";
import { LoanOverviewTab } from "@/components/views/loans/LoanOverviewTab";
import { LoanSimulatorTab } from "@/components/views/loans/LoanSimulatorTab";
import type { PortfolioLeverageSummary } from "@/types/quant";
import type { CurrencyCode } from "@/types/sheet";

type LoanSubTab = "overview" | "holdings" | "amortization" | "simulator";

interface LoansLeverageViewProps {
  leverage: PortfolioLeverageSummary;
  currency: CurrencyCode;
  onNavigateLedger: () => void;
  onSelectFundingFilter: (tag: string) => void;
}

const SUB_TABS: Array<{
  key: LoanSubTab;
  label: string;
  icon: typeof LayoutGrid;
}> = [
  { key: "overview", label: "績效總覽與對比", icon: LayoutGrid },
  { key: "holdings", label: "方案持股明細", icon: Briefcase },
  { key: "amortization", label: "本息攤還進度", icon: CalendarClock },
  { key: "simulator", label: "借貸決策試算", icon: Calculator },
];

export function LoansLeverageView({
  leverage,
  currency,
  onNavigateLedger,
  onSelectFundingFilter,
}: LoansLeverageViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<LoanSubTab>("overview");
  const [interestBasis, setInterestBasis] = useState<"full" | "accrued">("full");
  const defaultLoanId =
    leverage.facilities.find((f) => f.status === "active")?.id ??
    leverage.facilities[0]?.id ??
    "";
  const [selectedLoanId, setSelectedLoanId] = useState<string>(defaultLoanId);

  const selectedFacility =
    leverage.facilities.find((f) => f.id === selectedLoanId) ??
    leverage.facilities.find((f) => f.status === "active") ??
    leverage.facilities[0] ??
    null;

  const activeLoanCount = leverage.facilities.filter(
    (f) => f.status === "active"
  ).length;

  return (
    <div className="space-y-5">
      {/* Shared Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold">信貸槓桿、負債風控與攤還總覽</h2>
            <Badge variant="default">
              {activeLoanCount} 筆進行中 · 共 {leverage.facilities.length} 筆方案
            </Badge>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            依 `loans` 分頁 + `funding_tag` 自動對應庫存、股差/匯差與本息攤還 · 基準日 {leverage.asOfDate}
          </p>
        </div>

        {activeSubTab === "overview" && leverage.facilities.length > 0 && (
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
        )}
      </div>

      {/* 4 Sub-Tab Bar */}
      <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-1 text-xs">
        {SUB_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeSubTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveSubTab(tab.key)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 transition cursor-pointer ${
                active
                  ? "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)] shadow-xs"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Sub-Tab Body */}
      {activeSubTab === "simulator" ? (
        <LoanSimulatorTab fxRate={leverage.latestFxRate} />
      ) : leverage.facilities.length === 0 || !selectedFacility ? (
        <Card className="p-6 text-center space-y-3">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary)]/15 text-[var(--primary)]">
            <Landmark className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold">尚未載入任何信貸方案（loans 分頁）</h3>
            <p className="mx-auto max-w-lg text-xs text-[var(--muted-foreground)]">
              請在私人 Google Sheet 新增 `loans` 分頁（或前往「試算表資料與匯入」下載 `loans.csv` 空白範本並匯入），並在 `transactions` 的 `funding_tag` 填入對應方案標籤即可啟動分析；你也可以直接切換至「借貸決策試算」試算新方案。
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={onNavigateLedger}>
              <Database className="h-3.5 w-3.5" /> 前往試算表資料匯入 loans.csv
            </Button>
            <Button
              variant="outline"
              onClick={() => setActiveSubTab("simulator")}
            >
              <Calculator className="h-3.5 w-3.5" /> 先使用借貸決策試算
            </Button>
          </div>
        </Card>
      ) : (
        <>
          {activeSubTab === "overview" && (
            <LoanOverviewTab
              leverage={leverage}
              interestBasis={interestBasis}
              currency={currency}
              onInspectHoldings={(loanId) => {
                setSelectedLoanId(loanId);
                setActiveSubTab("holdings");
              }}
              onInspectAmortization={(loanId) => {
                setSelectedLoanId(loanId);
                setActiveSubTab("amortization");
              }}
              onSelectFundingFilter={onSelectFundingFilter}
            />
          )}

          {activeSubTab === "holdings" && (
            <LoanHoldingsTab
              facilities={leverage.facilities}
              selectedFacility={selectedFacility}
              currency={currency}
              fxRate={leverage.latestFxRate}
              onSelectLoan={setSelectedLoanId}
              onSelectFundingFilter={onSelectFundingFilter}
            />
          )}

          {activeSubTab === "amortization" && (
            <LoanAmortizationTab
              facilities={leverage.facilities}
              selectedFacility={selectedFacility}
              currency={currency}
              fxRate={leverage.latestFxRate}
              onSelectLoan={setSelectedLoanId}
            />
          )}
        </>
      )}
    </div>
  );
}
