import type { MarketDataBundle } from "@/types/market";
import type {
  DrawdownSummary,
  MddLookbackPreset,
  MddMatrixRow,
  MddSignalLevel,
  MddThresholds,
  SymbolUnderwaterPoint,
} from "@/types/quant";
import type { Asset } from "@/types/sheet";
import { addDaysIso, diffCalendarDays } from "./calendar";
import type { HoldingPosition } from "./holdings";

export const DEFAULT_MDD_THRESHOLDS: MddThresholds = {
  mild: -0.05,
  moderate: -0.1,
  deep: -0.15,
};

export interface ValuePoint {
  date: string;
  value: number;
}

export interface ComputedDrawdownPoint {
  date: string;
  value: number;
  peak: number;
  peakDate: string;
  drawdown: number; // <= 0
  daysUnderwater: number;
}

/**
 * Pure drawdown series calculator.
 * Works identically on Portfolio TWR Wealth Index (immune to cash flows)
 * or Individual Symbol Adjusted Close prices.
 */
export function computeDrawdownSeries(points: ValuePoint[]): {
  series: ComputedDrawdownPoint[];
  summary: DrawdownSummary;
} {
  if (points.length === 0) {
    return {
      series: [],
      summary: {
        maxDrawdown: 0,
        maxDrawdownDate: "",
        maxDrawdownPeakDate: "",
        recoveryDays: null,
        currentDrawdown: 0,
        currentPeakDate: "",
        currentDaysUnderwater: 0,
      },
    };
  }

  let peak = points[0].value;
  let peakDate = points[0].date;
  let daysUnderwater = 0;

  let maxDrawdown = 0;
  let maxDrawdownDate = points[0].date;
  let maxDrawdownPeakDate = points[0].date;
  let maxDdIndex = 0;

  const series: ComputedDrawdownPoint[] = [];

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (pt.value >= peak) {
      peak = pt.value;
      peakDate = pt.date;
      daysUnderwater = 0;
    } else {
      daysUnderwater++;
    }

    const drawdown = peak > 0 ? (pt.value - peak) / peak : 0;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownDate = pt.date;
      maxDrawdownPeakDate = peakDate;
      maxDdIndex = i;
    }

    series.push({
      date: pt.date,
      value: pt.value,
      peak,
      peakDate,
      drawdown,
      daysUnderwater,
    });
  }

  // Calculate recovery days from MDD trough until reaching a new peak (drawdown === 0)
  let recoveryDays: number | null = null;
  if (maxDrawdown < 0) {
    for (let i = maxDdIndex + 1; i < series.length; i++) {
      if (series[i].drawdown === 0) {
        recoveryDays = Math.max(
          1,
          diffCalendarDays(maxDrawdownDate, series[i].date)
        );
        break;
      }
    }
  } else {
    recoveryDays = 0;
  }

  const last = series[series.length - 1];

  return {
    series,
    summary: {
      maxDrawdown,
      maxDrawdownDate,
      maxDrawdownPeakDate,
      recoveryDays,
      currentDrawdown: last.drawdown,
      currentPeakDate: last.peakDate,
      currentDaysUnderwater: last.daysUnderwater,
    },
  };
}

export function classifyMddSignal(
  currentDrawdown: number,
  thresholds: MddThresholds = DEFAULT_MDD_THRESHOLDS
): MddSignalLevel {
  if (currentDrawdown <= thresholds.deep) return "deep";
  if (currentDrawdown <= thresholds.moderate) return "moderate";
  if (currentDrawdown <= thresholds.mild) return "mild";
  return "near-high";
}

/**
 * Builds the individual asset real-time MDD Monitoring Matrix based on each ticker's
 * dividend + split adjusted close (`adjClose`) so left-side dip buying signals reflect
 * true total-return drawdown from historical high.
 */
export function buildMddMatrix(params: {
  assets: Asset[];
  market: MarketDataBundle;
  holdings: Map<string, HoldingPosition>;
  latestFxRate: number;
  totalInvestedTwd: number;
  thresholds?: MddThresholds;
}): MddMatrixRow[] {
  const {
    assets,
    market,
    holdings,
    latestFxRate,
    totalInvestedTwd,
    thresholds = DEFAULT_MDD_THRESHOLDS,
  } = params;

  const rows: MddMatrixRow[] = [];

  for (const asset of assets) {
    const pos = holdings.get(asset.symbol);
    const heldShares = pos?.splitAdjustedShares ?? 0;
    const isHeld = heldShares > 1e-6;

    if (!asset.monitorMdd && !isHeld) continue;

    const tickerData = market.tickers[asset.symbol];
    if (!tickerData || tickerData.bars.length === 0) continue;

    const { series, summary } = computeDrawdownSeries(
      tickerData.bars.map((b) => ({ date: b.date, value: b.adjClose }))
    );

    const lastBar = tickerData.bars[tickerData.bars.length - 1];
    const lastDd = series[series.length - 1];
    const fx = asset.currency === "TWD" ? 1 : latestFxRate;
    const marketValueTwd = isHeld ? heldShares * lastBar.close * fx : 0;
    const costBasisTwd = isHeld ? pos?.costBasisTwd ?? 0 : 0;
    const unrealizedPnlPct =
      isHeld && costBasisTwd > 0
        ? (marketValueTwd - costBasisTwd) / costBasisTwd
        : null;
    const weightPct =
      isHeld && totalInvestedTwd > 0
        ? (marketValueTwd / totalInvestedTwd) * 100
        : 0;

    const mddRatioPct =
      summary.maxDrawdown < -1e-6
        ? Math.min(
            100,
            Math.round((summary.currentDrawdown / summary.maxDrawdown) * 100)
          )
        : 0;

    const underwaterSeries: SymbolUnderwaterPoint[] = series.map((pt) => ({
      date: pt.date,
      drawdown: pt.drawdown,
      adjClose: pt.value,
    }));

    rows.push({
      symbol: asset.symbol,
      name:
        asset.name && asset.name !== asset.symbol
          ? asset.name
          : tickerData.name ?? asset.symbol,
      market: asset.market,
      currency: asset.currency,
      yahooTicker: tickerData.yahooTicker || asset.yahooTicker,
      held: isHeld,
      shares: heldShares,
      firstDate: tickerData.bars[0].date,
      latestPrice: lastBar.close,
      latestDate: lastBar.date,
      peakAdjPrice: lastDd.peak,
      peakDate: lastDd.peakDate,
      currentDrawdown: summary.currentDrawdown,
      historicalMdd: summary.maxDrawdown,
      mddDate: summary.maxDrawdownDate,
      mddRatioPct,
      daysUnderwater: summary.currentDaysUnderwater,
      weightPct,
      marketValueTwd,
      costBasisTwd,
      unrealizedPnlPct,
      signal: classifyMddSignal(summary.currentDrawdown, thresholds),
      underwaterSeries,
    });
  }

  return rows.sort((a, b) => a.currentDrawdown - b.currentDrawdown);
}

/**
 * Recomputes MDD matrix metrics over a selected lookback window ("5Y" | "10Y" | "MAX")
 * without re-running the full portfolio engine.
 */
export function applyMddLookback(
  rows: MddMatrixRow[],
  lookback: MddLookbackPreset,
  thresholds: MddThresholds = DEFAULT_MDD_THRESHOLDS
): MddMatrixRow[] {
  if (lookback === "MAX") return rows;

  const lookbackDays = lookback === "5Y" ? 365 * 5 : 365 * 10;

  return rows.map((row) => {
    if (row.underwaterSeries.length === 0) return row;
    const cutoff = addDaysIso(row.latestDate, -lookbackDays);
    const sliced = row.underwaterSeries.filter((pt) => pt.date >= cutoff);
    const effective = sliced.length >= 2 ? sliced : row.underwaterSeries;

    const { series, summary } = computeDrawdownSeries(
      effective.map((pt) => ({ date: pt.date, value: pt.adjClose }))
    );

    const lastDd = series[series.length - 1];
    const mddRatioPct =
      summary.maxDrawdown < -1e-6
        ? Math.min(
            100,
            Math.round((summary.currentDrawdown / summary.maxDrawdown) * 100)
          )
        : 0;

    return {
      ...row,
      peakAdjPrice: lastDd.peak,
      peakDate: lastDd.peakDate,
      currentDrawdown: summary.currentDrawdown,
      historicalMdd: summary.maxDrawdown,
      mddDate: summary.maxDrawdownDate,
      mddRatioPct,
      daysUnderwater: summary.currentDaysUnderwater,
      signal: classifyMddSignal(summary.currentDrawdown, thresholds),
      underwaterSeries: series.map((pt) => ({
        date: pt.date,
        drawdown: pt.drawdown,
        adjClose: pt.value,
      })),
    };
  });
}
