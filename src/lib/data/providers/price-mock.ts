import type { CandleInput, FetchCandlesParams, PriceProvider } from "../types";
import { fnv1a, unitNoise } from "../hash";
import { PAIR_DECIMALS, TIMEFRAME_MS, type Pair, type Timeframe } from "../universe";

// Deterministic mock price feed: every (symbol, timeframe, openTime) always maps
// to the same OHLC, so re-ingesting never changes existing rows.

const BASE_PRICE: Record<Pair, number> = {
  EURUSD: 1.085,
  GBPUSD: 1.27,
  USDJPY: 155.2,
  XAUUSD: 2350,
};

// Multi-scale random-walk amplitudes (fractions of base price) per timeframe.
const WALK_AMPLITUDE: Record<Timeframe, [number, number, number, number]> = {
  M15: [0.0006, 0.001, 0.002, 0.004],
  H1: [0.001, 0.002, 0.004, 0.008],
  H4: [0.0016, 0.003, 0.006, 0.012],
  D1: [0.003, 0.006, 0.012, 0.024],
};
const WALK_STRIDE = [1, 8, 64, 512];
const WICK_FRACTION: Record<Timeframe, number> = {
  M15: 0.0004,
  H1: 0.0007,
  H4: 0.0012,
  D1: 0.0022,
};

function walkFraction(symbol: Pair, timeframe: Timeframe, boundaryIndex: number): number {
  const amplitudes = WALK_AMPLITUDE[timeframe];
  let sum = 0;
  for (let k = 0; k < amplitudes.length; k++) {
    const stride = WALK_STRIDE[k];
    sum += amplitudes[k] * unitNoise(symbol, timeframe, k, Math.floor(boundaryIndex / stride));
  }
  return sum;
}

export function generateMockCandles(params: FetchCandlesParams): CandleInput[] {
  const { symbol, timeframe, limit } = params;
  const periodMs = TIMEFRAME_MS[timeframe];
  const decimals = PAIR_DECIMALS[symbol];
  const base = BASE_PRICE[symbol];
  const wickFraction = WICK_FRACTION[timeframe];
  const currentBoundary = Math.floor(Date.now() / periodMs);

  const out: CandleInput[] = [];
  for (let idx = currentBoundary - (limit - 1); idx <= currentBoundary; idx++) {
    const open = Number((base * (1 + walkFraction(symbol, timeframe, idx))).toFixed(decimals));
    const close = Number((base * (1 + walkFraction(symbol, timeframe, idx + 1))).toFixed(decimals));
    const upWick = Math.abs(unitNoise(symbol, timeframe, "hi", idx)) * base * wickFraction;
    const downWick = Math.abs(unitNoise(symbol, timeframe, "lo", idx)) * base * wickFraction;
    const high = Math.max(Number((Math.max(open, close) + upWick).toFixed(decimals)), open, close);
    const low = Math.min(Number((Math.min(open, close) - downWick).toFixed(decimals)), open, close);
    const volume = String(50 + (fnv1a(symbol, timeframe, "vol", idx) % 950));
    out.push({
      symbol,
      timeframe,
      openTime: new Date(idx * periodMs),
      open: open.toFixed(decimals),
      high: high.toFixed(decimals),
      low: low.toFixed(decimals),
      close: close.toFixed(decimals),
      volume,
    });
  }
  return out;
}

export function createMockPriceProvider(): PriceProvider {
  return {
    name: "mock",
    isMock: true,
    fetchCandles: async (params) => generateMockCandles(params),
  };
}
