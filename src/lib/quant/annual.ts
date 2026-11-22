import type { MarketDataBundle } from "@/types/market";
import type { AnnualPerformanceRow, DailyPortfolioPoint } from "@/types/quant";
import type { Asset, BenchmarkConfig, BenchmarkScope, Transaction } from "@/types/sheet";
import { findBarOnOrBefore } from "./calendar";
import {
  computeDailySubperiodReturn,
  computeModifiedDietz,
  computeTransactionFlow,
  type DatedCashFlow,
} from "./returns";

/**
 * Computes benchmark TWD-equivalent total return (using `adjClose` + USD/TWD FX if USD)
 * over [startDate, endDate].
 */
export function computeBenchmarkReturnTwd(
  benchmark: BenchmarkConfig | undefined,
  market: MarketDataBundle,
  startDate: string,
  endDate: string
): number | null {
  if (!benchmark) return null;
  const ticker = market.tickers[benchmark.symbol];
  if (!ticker || ticker.bars.length === 0) return null;

  const startBar = findBarOnOrBefore(ticker.bars, startDate, true);
  const endBar = findBarOnOrBefore(ticker.bars, endDate, false);
  if (!startBar || !endBar || startBar.adjClose <= 0) return null;

  const localRet = endBar.adjClose / startBar.adjClose - 1;
  if (benchmark.currency === "TWD") return localRet;

  const startFx = findBarOnOrBefore(market.fxBars, startDate, true)?.close ?? 32;
  const endFx = findBarOnOrBefore(market.fxBars, endDate, true)?.close ?? startFx;
  const fxRet = startFx > 0 ? endFx / startFx - 1 : 0;

  return (1 + localRet) * (1 + fxRet) - 1;
}

/**
 * Computes yearly Modified Dietz, Daily TWR, Benchmark Return (TWD-equivalent), and Alpha
 * for ALL, TW, and US scopes.
 */
export function computeAnnualPerformanceByScope(params: {
  transactions: Transaction[];
  assets: Asset[];
  benchmarks: BenchmarkConfig[];
  market: MarketDataBundle;
  investedSeries: DailyPortfolioPoint[];
}): Record<BenchmarkScope, AnnualPerformanceRow[]> {
  const { transactions, assets, benchmarks, market, investedSeries } = params;

  const result: Record<BenchmarkScope, AnnualPerformanceRow[]> = {
    ALL: [],
    TW: [],
    US: [],
  };

  if (investedSeries.length === 0) return result;

  const assetMap = new Map(assets.map((a) => [a.symbol, a]));
  const latestYear = investedSeries[investedSeries.length - 1].date.slice(0, 4);
  const years = Array.from(
    new Set(investedSeries.map((pt) => pt.date.slice(0, 4)))
  ).sort();

  const pickBenchmark = (scope: BenchmarkScope): BenchmarkConfig | undefined => {
    const exact = benchmarks.find((b) => b.scope === scope);
    if (exact) return exact;
    if (scope === "TW") return benchmarks.find((b) => b.symbol === "0050");
    if (scope === "US") return benchmarks.find((b) => b.symbol === "VOO" || b.symbol === "QQQ");
    return benchmarks.find((b) => b.symbol === "VT") ?? benchmarks[0];
  };

  for (const scope of ["ALL", "TW", "US"] as BenchmarkScope[]) {
    const bench = pickBenchmark(scope);

    for (const year of years) {
      const prevYearEnd = `${Number(year) - 1}-12-31`;
      const yearEndCap = `${year}-12-31`;
      const yearPoints = investedSeries.filter((pt) => pt.date.startsWith(year));
      if (yearPoints.length === 0) continue;

      const prevPt =
        [...investedSeries].reverse().find((pt) => pt.date <= prevYearEnd) ?? null;
      const lastPt = yearPoints[yearPoints.length - 1];

      const getScopeVal = (pt: DailyPortfolioPoint | null) => {
        if (!pt) return 0;
        if (scope === "TW") return pt.twValueTwd;
        if (scope === "US") return pt.usValueTwd;
        return pt.investedValueTwd;
      };

      const startValueTwd = getScopeVal(prevPt);
      const endValueTwd = getScopeVal(lastPt);

      const scopeTxs = transactions.filter((tx) => {
        if (!tx.date.startsWith(year)) return false;
        if (scope === "ALL") return true;
        const mkt = assetMap.get(tx.symbol)?.market ?? "TW";
        return mkt === scope;
      });

      const txByDate = new Map<string, { inflow: number; outflow: number }>();
      const cashFlows: DatedCashFlow[] = [];
      let netInflowTwd = 0;

      for (const tx of scopeTxs) {
        const ccy = assetMap.get(tx.symbol)?.currency ?? "TWD";
        const fx =
          ccy === "TWD"
            ? 1
            : tx.fxRate && tx.fxRate > 0
              ? tx.fxRate
              : findBarOnOrBefore(market.fxBars, tx.date, true)?.close ?? 32;
        const flow = computeTransactionFlow(tx, ccy, fx);

        netInflowTwd += flow.netCashFlowTwd;
        if (Math.abs(flow.netCashFlowTwd) > 1e-6) {
          cashFlows.push({ date: tx.date, amount: flow.netCashFlowTwd });
        }

        const existing = txByDate.get(tx.date) ?? { inflow: 0, outflow: 0 };
        existing.inflow += flow.inflowTwd;
        existing.outflow += flow.outflowTwd;
        txByDate.set(tx.date, existing);
      }

      // Skip years where this market had no activity and no holdings
      if (startValueTwd <= 1e-6 && endValueTwd <= 1e-6 && cashFlows.length === 0) {
        continue;
      }

      const periodStartDate = prevPt ? prevPt.date : `${year}-01-01`;
      const periodEndDate = lastPt.date <= yearEndCap ? lastPt.date : yearEndCap;

      const modifiedDietz = computeModifiedDietz({
        startDate: periodStartDate,
        endDate: periodEndDate,
        startValue: startValueTwd,
        endValue: endValueTwd,
        cashFlows,
      });

      // Exact daily TWR chained across every trading day of this year for this scope
      let twrWealth = 1;
      let prevVal = startValueTwd;
      for (const pt of yearPoints) {
        const curVal = getScopeVal(pt);
        const dayFlow = txByDate.get(pt.date) ?? { inflow: 0, outflow: 0 };
        const r = computeDailySubperiodReturn({
          prevValue: prevVal,
          endValue: curVal,
          inflow: dayFlow.inflow,
          outflow: dayFlow.outflow,
        });
        twrWealth *= 1 + r;
        prevVal = curVal;
      }
      const twr = twrWealth - 1;

      const benchmarkReturn = computeBenchmarkReturnTwd(
        bench,
        market,
        periodStartDate,
        periodEndDate
      );
      const alpha = benchmarkReturn !== null ? twr - benchmarkReturn : null;
      const netPnlTwd = endValueTwd - startValueTwd - netInflowTwd;

      result[scope].push({
        year: year === latestYear ? `${year} (YTD)` : year,
        scope,
        startValueTwd,
        netInflowTwd,
        endValueTwd,
        netPnlTwd,
        modifiedDietz,
        twr,
        benchmarkSymbol: bench?.symbol ?? "-",
        benchmarkName: bench?.name ?? "未設定基準",
        benchmarkReturn,
        alpha,
      });
    }
  }

  return result;
}
