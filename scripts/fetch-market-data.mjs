/**
 * Fetches public historical daily prices (close, adjClose), stock splits, and USD/TWD FX
 * from Yahoo Finance v8 chart API and writes `public/data/market-data.json`.
 *
 * Used by GitHub Actions daily schedule (and local `npm run fetch:market`).
 * Contains ZERO personal portfolio data — only public market prices.
 */
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const configPath = path.join(rootDir, "config", "tickers.json");
const outPath = path.join(rootDir, "public", "data", "market-data.json");

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toIsoDate(epochSec) {
  return new Date(epochSec * 1000).toISOString().slice(0, 10);
}

async function fetchYahooChart(yahooTicker, startDateIso) {
  const period1 = Math.floor(new Date(`${startDateIso}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const encoded = encodeURIComponent(yahooTicker);
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

  let lastError = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    const host = hosts[attempt % hosts.length];
    const url = `https://${host}/v8/finance/chart/${encoded}?period1=${period1}&period2=${period2}&interval=1d&events=splits&includeAdjustedClose=true`;

    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429) {
        const waitMs = 1500 * (attempt + 1);
        console.warn(`  [429] Rate limited on ${yahooTicker}, retrying in ${waitMs}ms...`);
        await sleep(waitMs);
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const json = await res.json();
      const chart = json?.chart?.result?.[0];
      if (!chart) {
        throw new Error(json?.chart?.error?.description || "Empty chart result");
      }

      const timestamps = chart.timestamp ?? [];
      const closes = chart.indicators?.quote?.[0]?.close ?? [];
      const adjCloses = chart.indicators?.adjclose?.[0]?.adjclose ?? closes;

      const barMap = new Map();
      for (let i = 0; i < timestamps.length; i++) {
        const ts = timestamps[i];
        const c = closes[i];
        const ac = adjCloses[i];
        if (!ts || typeof c !== "number" || !Number.isFinite(c) || c <= 0) continue;
        const date = toIsoDate(ts);
        const validAdj =
          typeof ac === "number" && Number.isFinite(ac) && ac > 0 ? ac : c;
        barMap.set(date, {
          date,
          close: Number(c.toFixed(4)),
          adjClose: Number(validAdj.toFixed(4)),
        });
      }

      const bars = Array.from(barMap.values()).sort((a, b) =>
        a.date.localeCompare(b.date)
      );

      const rawSplits = chart.events?.splits ?? {};
      const splits = Object.values(rawSplits)
        .map((s) => {
          const ratio =
            s.numerator && s.denominator ? s.numerator / s.denominator : 0;
          if (!s.date || !ratio || ratio <= 0) return null;
          return {
            date: toIsoDate(s.date),
            ratio: Number(ratio.toFixed(6)),
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.date.localeCompare(b.date));

      return { bars, splits };
    } catch (err) {
      lastError = err;
      await sleep(800 * (attempt + 1));
    }
  }

  throw lastError || new Error(`Failed to fetch ${yahooTicker}`);
}

async function main() {
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const startDate = cfg.startDate || "2020-01-01";
  const fxTicker = cfg.fxTicker || "TWD=X";

  let existing = null;
  if (fs.existsSync(outPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(outPath, "utf8"));
    } catch {
      existing = null;
    }
  }

  console.log(`[fetch-market-data] Fetching FX ${fxTicker} since ${startDate}...`);
  let fxBars = existing?.fxBars ?? [];
  try {
    const fxData = await fetchYahooChart(fxTicker, startDate);
    if (fxData.bars.length > 0) {
      fxBars = fxData.bars;
      console.log(
        `  -> ${fxBars.length} FX bars, latest ${fxBars[fxBars.length - 1].date}: ${fxBars[fxBars.length - 1].close}`
      );
    }
  } catch (err) {
    console.error(`[fetch-market-data] FX fetch failed, keeping cached FX:`, err?.message || err);
  }

  const tickers = { ...(existing?.tickers ?? {}) };

  for (const item of cfg.tickers) {
    await sleep(350);
    try {
      console.log(`[fetch-market-data] Fetching ${item.symbol} (${item.yahooTicker})...`);
      const { bars, splits } = await fetchYahooChart(item.yahooTicker, startDate);
      if (bars.length === 0) {
        console.warn(`[fetch-market-data] WARNING: No bars for ${item.symbol}`);
        continue;
      }
      const last = bars[bars.length - 1];
      tickers[item.symbol] = {
        symbol: item.symbol,
        yahooTicker: item.yahooTicker,
        currency: item.currency,
        lastPrice: last.close,
        lastDate: last.date,
        bars,
        splits,
      };
      console.log(
        `  -> ${bars.length} bars, ${splits.length} splits, latest ${last.date}: ${last.close}`
      );
    } catch (err) {
      console.error(
        `[fetch-market-data] Failed ${item.symbol} (${item.yahooTicker}):`,
        err?.message || err
      );
    }
  }

  const bundle = {
    generatedAt: new Date().toISOString(),
    fxTicker,
    fxBars,
    tickers,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(bundle), "utf8");
  console.log(
    `[fetch-market-data] Done! Saved ${Object.keys(tickers).length} tickers & ${fxBars.length} FX bars to ${outPath}`
  );
}

main().catch((err) => {
  console.error("[fetch-market-data] Fatal error:", err);
  process.exit(1);
});
