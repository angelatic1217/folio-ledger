import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDemoSheetsData } from "@/lib/demo/fixtures";
import { runQuantEngine, sliceSeriesByRange } from "@/lib/quant/engine";
import type { MarketDataBundle } from "@/types/market";

describe("Real Yahoo Finance market-data.json Integration", () => {
  it("runs Demo portfolio against real 2020-2026 Yahoo Finance bars without NaN or 0050 split spikes", () => {
    const marketPath = path.resolve(process.cwd(), "public/data/market-data.json");
    const market = JSON.parse(fs.readFileSync(marketPath, "utf8")) as MarketDataBundle;
    const sheets = createDemoSheetsData();

    const output = runQuantEngine(sheets, market);

    expect(output.investedSeries.length).toBeGreaterThan(500);
    expect(output.totalInvestedValueTwd).toBeGreaterThan(0);
    expect(output.mddMatrix.length).toBe(6);

    // Ensure zero NaN values and no single-day fake crash around 0050's 2025-06-11 1-for-4 split
    for (const pt of output.investedSeries) {
      expect(Number.isFinite(pt.investedValueTwd)).toBe(true);
      expect(Number.isFinite(pt.twrIndex)).toBe(true);
      expect(Number.isFinite(pt.drawdown)).toBe(true);
      expect(pt.drawdown).toBeLessThanOrEqual(0);
      expect(Math.abs(pt.dailyReturn)).toBeLessThan(0.25);
    }

    const { drawdownSummary, rangeTwr } = sliceSeriesByRange(output.investedSeries, "ALL");
    expect(drawdownSummary.maxDrawdown).toBeLessThan(0);
    expect(drawdownSummary.maxDrawdown).toBeGreaterThan(-0.6);
    expect(Number.isFinite(rangeTwr)).toBe(true);

    expect(output.annualByScope.ALL.length).toBeGreaterThanOrEqual(3);
    expect(output.annualByScope.TW.length).toBeGreaterThanOrEqual(3);
    expect(output.annualByScope.US.length).toBeGreaterThanOrEqual(2);
  });
});
