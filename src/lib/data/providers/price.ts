import { z } from "zod";
import { getEnv, resolvePriceProvider, type PriceProviderName } from "../config";
import type { CandleInput, FetchCandlesParams, PriceProvider } from "../types";
import { PAIR_DECIMALS, TIMEFRAME_MS, type Pair, type Timeframe } from "../universe";
import { fetchJsonWithRetry, parseUtcDateTime } from "./http";
import { createMockPriceProvider } from "./price-mock";

/** Minimum gap between provider calls per feed (free-tier rate limits). */
export const PRICE_PROVIDER_DELAY_MS: Record<PriceProviderName, number> = {
  twelvedata: 7_500, // free tier: 8 requests/min
  polygon: 13_000, // free currencies tier: ~4-5 requests/min
  oanda: 1_100, // 60 requests/min
  mock: 0,
};

// --- Twelve Data -----------------------------------------------------------
// Internal symbols are "EURUSD"; Twelve Data forex wants "EUR/USD".
// XAU/USD is a metals pair — same slash format.

const TD_SYMBOL: Record<Pair, string> = {
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  XAUUSD: "XAU/USD",
};

const TD_INTERVAL: Record<Timeframe, string> = {
  M15: "15min",
  H1: "1h",
  H4: "4h",
  D1: "1day",
};

const tdResponseSchema = z.object({
  status: z.string().optional(),
  message: z.string().optional(),
  values: z
    .array(
      z.object({
        datetime: z.string(),
        open: z.string(),
        high: z.string(),
        low: z.string(),
        close: z.string(),
        volume: z.string().nullable().optional(),
      }),
    )
    .optional(),
});

async function fetchTwelveData(params: FetchCandlesParams, apiKey: string): Promise<CandleInput[]> {
  const url =
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(TD_SYMBOL[params.symbol])}` +
    `&interval=${TD_INTERVAL[params.timeframe]}&outputsize=${params.limit}` +
    `&timezone=UTC&format=JSON&apikey=${apiKey}`;
  const json = await fetchJsonWithRetry(url, { label: "twelvedata" });
  const parsed = tdResponseSchema.safeParse(json);
  if (!parsed.success) throw new Error("twelvedata: unexpected response shape");
  const body = parsed.data;
  if (body.status === "error" || (!body.values && body.message)) {
    throw new Error(`twelvedata: ${body.message ?? "error response"}`);
  }
  const candles: CandleInput[] = [];
  for (const row of body.values ?? []) {
    const openTime = parseUtcDateTime(row.datetime);
    if (!openTime) continue;
    candles.push({
      symbol: params.symbol,
      timeframe: params.timeframe,
      openTime,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume && row.volume !== "" ? row.volume : null,
    });
  }
  candles.sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
  return candles;
}

// --- Polygon (now "Massive") ----------------------------------------------

const POLYGON_TICKER: Record<Pair, string> = {
  EURUSD: "C:EURUSD",
  GBPUSD: "C:GBPUSD",
  USDJPY: "C:JPY", // Polygon quotes USD/JPY as C:JPY
  XAUUSD: "C:XAUUSD",
};

const POLYGON_RANGE: Record<Timeframe, { multiplier: number; timespan: string }> = {
  M15: { multiplier: 15, timespan: "minute" },
  H1: { multiplier: 1, timespan: "hour" },
  H4: { multiplier: 4, timespan: "hour" },
  D1: { multiplier: 1, timespan: "day" },
};

const polygonResponseSchema = z.object({
  status: z.string().optional(),
  results: z
    .array(
      z.object({
        t: z.number(),
        o: z.number(),
        h: z.number(),
        l: z.number(),
        c: z.number(),
        v: z.number().nullable().optional(),
      }),
    )
    .optional(),
});

async function fetchPolygon(params: FetchCandlesParams, apiKey: string): Promise<CandleInput[]> {
  const { multiplier, timespan } = POLYGON_RANGE[params.timeframe];
  const periodMs = TIMEFRAME_MS[params.timeframe];
  const now = Date.now();
  const from = now - Math.ceil(params.limit * periodMs * 1.4);
  const ticker = POLYGON_TICKER[params.symbol];
  const url =
    `https://api.massive.com/v2/aggs/ticker/${ticker}/range/${multiplier}/${timespan}` +
    `/${from}/${now}?adjusted=true&sort=asc&limit=${params.limit}&apiKey=${apiKey}`;
  const json = await fetchJsonWithRetry(url, { label: "polygon" });
  const parsed = polygonResponseSchema.safeParse(json);
  if (!parsed.success) throw new Error("polygon: unexpected response shape");
  const decimals = PAIR_DECIMALS[params.symbol];
  const candles: CandleInput[] = (parsed.data.results ?? []).map((row) => ({
    symbol: params.symbol,
    timeframe: params.timeframe,
    openTime: new Date(row.t),
    open: row.o.toFixed(decimals),
    high: row.h.toFixed(decimals),
    low: row.l.toFixed(decimals),
    close: row.c.toFixed(decimals),
    volume: row.v == null ? null : String(row.v),
  }));
  return candles;
}

// --- OANDA -----------------------------------------------------------------

const OANDA_INSTRUMENT: Record<Pair, string> = {
  EURUSD: "EUR_USD",
  GBPUSD: "GBP_USD",
  USDJPY: "USD_JPY",
  XAUUSD: "XAU_USD",
};

const oandaResponseSchema = z.object({
  candles: z.array(
    z.object({
      time: z.string(),
      volume: z.number(),
      mid: z.object({ o: z.string(), h: z.string(), l: z.string(), c: z.string() }),
    }),
  ),
});

async function fetchOanda(params: FetchCandlesParams, apiKey: string): Promise<CandleInput[]> {
  // Default host is the practice (demo) API; live accounts use api-fxtrade.oanda.com.
  const instrument = OANDA_INSTRUMENT[params.symbol];
  const url =
    `https://api-fxpractice.oanda.com/v3/candles?instrument=${instrument}` +
    `&granularity=${params.timeframe}&count=${params.limit}&price=MID`;
  const json = await fetchJsonWithRetry(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    label: "oanda",
  });
  const parsed = oandaResponseSchema.safeParse(json);
  if (!parsed.success) throw new Error("oanda: unexpected response shape");
  const candles: CandleInput[] = [];
  for (const row of parsed.data.candles) {
    const openTime = new Date(row.time);
    if (Number.isNaN(openTime.getTime())) continue;
    candles.push({
      symbol: params.symbol,
      timeframe: params.timeframe,
      openTime,
      open: row.mid.o,
      high: row.mid.h,
      low: row.mid.l,
      close: row.mid.c,
      volume: String(row.volume),
    });
  }
  candles.sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
  return candles;
}

// --- Factory --------------------------------------------------------------

export function getPriceProvider(): PriceProvider {
  const selection = resolvePriceProvider();
  const env = getEnv();
  switch (selection.name) {
    case "twelvedata": {
      const key = env.TWELVEDATA_API_KEY ?? "";
      return { name: "twelvedata", isMock: false, fetchCandles: (p) => fetchTwelveData(p, key) };
    }
    case "polygon": {
      const key = env.POLYGON_API_KEY ?? "";
      return { name: "polygon", isMock: false, fetchCandles: (p) => fetchPolygon(p, key) };
    }
    case "oanda": {
      const key = env.OANDA_API_KEY ?? "";
      return { name: "oanda", isMock: false, fetchCandles: (p) => fetchOanda(p, key) };
    }
    default:
      // Unknown / unset provider name resolves to mock (config logs the reason).
      return createMockPriceProvider();
  }
}
