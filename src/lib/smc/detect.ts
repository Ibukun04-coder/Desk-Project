import type { Pair, Timeframe } from "@/lib/data/universe";
import type { SmcCandleInput, SmcSnapshot } from "./types";
import { atr, findSwings, toNumericCandles } from "./swings";
import { computeRange, detectLiquidity } from "./liquidity";
import { detectStructure } from "./structure";
import { detectFvgs, detectOrderBlocks } from "./structure-zones";
import { detectAsiaLiquidity } from "./asia";

// Orchestrator: candles (oldest → newest) → SmcSnapshot. Pure + total.

export const MIN_CANDLES_FOR_SMC = 10;
export const MAX_SWINGS = 60;
export const MAX_STRUCTURE_EVENTS = 12;
export const MAX_ORDER_BLOCKS = 8;
export const MAX_FVGS = 12;
export const MAX_LIQUIDITY = 6;

export function emptySnapshot(symbol: Pair, timeframe: Timeframe, candleCount: number): SmcSnapshot {
  return {
    symbol, timeframe,
    asOf: new Date().toISOString(),
    candleCount,
    swings: [], bos: [], choch: [],
    fvgs: [], orderBlocks: [], liquidity: [],
    sweeps: [], runs: [], asia: [],
    range: null, htfBias: "range",
  };
}

/**
 * Deterministic SMC snapshot from candles. Short/empty series return empty
 * arrays (never a crash). Caps keep the chart readable: last 60 swings,
 * 12 BOS / 12 CHOCH, 8 order blocks, 12 FVGs, 6 liquidity levels.
 */
export function detectSmc(symbol: Pair, timeframe: Timeframe, input: SmcCandleInput[]): SmcSnapshot {
  const candles = toNumericCandles(input);
  if (candles.length < MIN_CANDLES_FOR_SMC) return emptySnapshot(symbol, timeframe, candles.length);

  const allSwings = findSwings(candles);
  const { bos, choch, htfBias } = detectStructure(candles, allSwings);
  const atrValue = atr(candles);
  const fvgs = detectFvgs(candles).slice(-MAX_FVGS);
  const liquidity = detectLiquidity(candles, allSwings, atrValue);
  const asia = (timeframe === "M15" || timeframe === "H1" || timeframe === "H4")
    ? detectAsiaLiquidity(candles)
    : [];
  return {
    symbol, timeframe,
    asOf: new Date().toISOString(),
    candleCount: candles.length,
    swings: allSwings.slice(-MAX_SWINGS),
    bos: bos.slice(-MAX_STRUCTURE_EVENTS),
    choch: choch.slice(-MAX_STRUCTURE_EVENTS),
    fvgs,
    orderBlocks: detectOrderBlocks(candles, bos, fvgs, htfBias).slice(-MAX_ORDER_BLOCKS),
    liquidity: liquidity.levels.slice(0, MAX_LIQUIDITY),
    sweeps: liquidity.sweeps.slice(0, MAX_LIQUIDITY),
    runs: liquidity.runs.slice(0, MAX_LIQUIDITY),
    asia,
    range: computeRange(allSwings),
    htfBias,
  };
}
