import type { DailyBar, MarketDataBundle } from "@/types/market";

const MS_PER_DAY = 86_400_000;

export function parseIsoDateMs(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

export function diffCalendarDays(startIso: string, endIso: string): number {
  return Math.round((parseIsoDateMs(endIso) - parseIsoDateMs(startIso)) / MS_PER_DAY);
}

export function addDaysIso(iso: string, days: number): string {
  const dt = new Date(parseIsoDateMs(iso) + days * MS_PER_DAY);
  return dt.toISOString().slice(0, 10);
}

/**
 * Builds a sorted union of trading dates across all tickers, FX bars,
 * and optional extra dates (such as transaction dates) within [minDate, maxDate].
 */
export function buildUnionTradingCalendar(
  market: MarketDataBundle,
  minDate?: string,
  maxDate?: string,
  extraDates: string[] = []
): string[] {
  const dateSet = new Set<string>();

  for (const bar of market.fxBars) {
    dateSet.add(bar.date);
  }
  for (const ticker of Object.values(market.tickers)) {
    for (const bar of ticker.bars) {
      dateSet.add(bar.date);
    }
  }
  for (const d of extraDates) {
    if (d) dateSet.add(d.slice(0, 10));
  }

  return Array.from(dateSet)
    .filter((d) => (!minDate || d >= minDate) && (!maxDate || d <= maxDate))
    .sort();
}

/**
 * Forward-fills (LOCF) daily bars across a unified calendar so that market
 * holidays in Taiwan or the US never zero out valuations or create fake drawdowns.
 */
export function buildForwardFilledBarMap(
  bars: DailyBar[],
  calendar: string[]
): Map<string, DailyBar> {
  const sortedBars = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const result = new Map<string, DailyBar>();
  if (sortedBars.length === 0 || calendar.length === 0) return result;

  let barIdx = 0;
  let lastValid: DailyBar | null = null;

  for (const date of calendar) {
    while (barIdx < sortedBars.length && sortedBars[barIdx].date <= date) {
      lastValid = sortedBars[barIdx];
      barIdx++;
    }
    if (lastValid) {
      result.set(date, {
        date,
        close: lastValid.close,
        adjClose: lastValid.adjClose,
      });
    }
  }

  return result;
}

/**
 * Returns the latest available bar on or before `targetDate` (or the earliest bar if fallbackToFirst is true).
 */
export function findBarOnOrBefore(
  bars: DailyBar[],
  targetDate: string,
  fallbackToFirst = false
): DailyBar | null {
  if (bars.length === 0) return null;
  let lo = 0;
  let hi = bars.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date <= targetDate) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best >= 0) return bars[best];
  return fallbackToFirst ? bars[0] : null;
}
