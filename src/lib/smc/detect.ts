import type { Pair, Timeframe } from "@/lib/data/universe";
import type { SmcCandleInput, SmcSnapshot, NumericCandle, StructureDirection } from "./types";
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

function detectAbsorption(
  candles: NumericCandle[],
  obIndex: number | null,
  fvgIndex: number | null,
  direction: StructureDirection
): [boolean, number] {
  // No zone detected → no absorption
  if (obIndex === null && fvgIndex === null) return [false, 0];

  // We need at least some candles after the zone formed
  const zoneIndex = obIndex ?? fvgIndex!;
  if (candles.length <= zoneIndex + 5) return [false, 0]; // not enough data

  // Look at the candles after the zone formed
  const afterCandles = candles.slice(zoneIndex, candles.length);
  if (afterCandles.length < 3) return [false, 0];

  // Determine the initial move that created the zone
  let initialBodySize = 0;
  let initialHigh = 0;
  let initialLow = 0;

  if (obIndex !== null) {
    // Order block: use the origin candle's body
    const obCandle = candles[obIndex];
    initialBodySize = Math.abs(obCandle.open - obCandle.close);
    initialHigh = obCandle.high;
    initialLow = obCandle.low;
  } else {
    // FVG: use the first candle of the FVG gap
    if (fvgIndex === null) return [false, 0];
    const fvgCandle = candles[fvgIndex];
    initialBodySize = Math.abs(fvgCandle.open - fvgCandle.close);
    initialHigh = fvgCandle.high;
    initialLow = fvgCandle.low;
  }

  // If initial move was very small, no absorption to detect
  if (initialBodySize < 0.001) return [false, 0];

  // Analyze the next 5 candles for absorption signs
  const analysisCandles = afterCandles.slice(0, Math.min(5, afterCandles.length));
  let stagnationCount = 0; // count of candles showing stagnation signs

  for (let i = 1; i < analysisCandles.length; i++) {
    const prev = analysisCandles[i - 1];
    const curr = analysisCandles[i];

    // Body size comparison: is current body smaller than initial?
    const currBodySize = Math.abs(curr.open - curr.close);
    const bodyRatio = initialBodySize > 0 ? currBodySize / initialBodySize : 1;

    // Check if price is making new extremes vs the initial zone
    const makesNewHigh = curr.high > initialHigh;
    const makesNewLow = curr.low < initialLow;

    // Stagnation signs:
    // 1. Body is smaller than initial move (bodyRatio < 0.5 = much smaller)
    // 2. Price is NOT making new extremes (price consolidating / stalling)
    // 3. OR wick is large relative to body (rejection)
    const bodySmall = bodyRatio < 0.5;
    const noNewExtreme = !makesNewHigh && !makesNewLow;
    const largeWick = (curr.high - curr.low) > Math.max(initialBodySize * 2, (curr.high - curr.low) * 0.5);

    if (bodySmall && noNewExtreme) {
      stagnationCount++;
    }

    // Also count large wicks as stagnation (rejection = absorbing side)
    if (largeWick) stagnationCount++;
  }

  // Calculate score: 0-100 based on how many stagnation signs we see
  const maxPossible = analysisCandles.length - 1; // number of transitions
  const rawScore = stagnationCount / Math.max(1, maxPossible) * 100;

  // A score > 40 indicates clear absorption/stagnation
  const absorption = rawScore > 40;
  const absorptionScore = Math.round(rawScore);

  return [absorption, absorptionScore];
}

export function emptySnapshot(symbol: Pair, timeframe: Timeframe, candleCount: number): SmcSnapshot {
  return {
    symbol, timeframe,
    asOf: new Date().toISOString(),
    candleCount,
    swings: [], bos: [], choch: [],
    fvgs: [], orderBlocks: [], liquidity: [],
    sweeps: [], runs: [], asia: [],
    range: null, htfBias: "range",
    absorption: false, absorptionScore: 0,
  };
}

/**
 * Deterministic SMC snapshot from candles. Short/empty series return empty
 * arrays (never a crash). Caps keep the chart readable: last 60 swings,
 * 12 BOS / 12 CHOCH, 8 order blocks, 12 FVGs, 6 liquidity levels.
 */
// Original detectSmc removed - see corrected version below
// (removed broken return object)

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

  // Detect order blocks
  const orderBlocks = detectOrderBlocks(candles, bos, fvgs, htfBias, liquidity.sweeps, liquidity.runs).slice(-MAX_ORDER_BLOCKS);

  // --- Absorption/stagnation detection ---
  // Detect absorption for the most recent order block
  const recentOb = orderBlocks.length > 0 ? orderBlocks[orderBlocks.length - 1] : null;
  const obIndex = recentOb?.index ?? null;
  const obDirection = recentOb?.direction ?? htfBias;
  // Cast to StructureDirection - "range" is not a valid direction but we handle it
  const obDir = (obDirection === "range" ? "bullish" : obDirection) as StructureDirection;

  const [obAbsorption, obScore] = detectAbsorption(candles, obIndex, null, obDir);

  // Detect absorption for the most recent FVG
  const recentFvg = fvgs.length > 0 ? fvgs[fvgs.length - 1] : null;
  const fvgIndex = recentFvg?.index ?? null;

  const [fvgAbsorption, fvgScore] = detectAbsorption(candles, null, fvgIndex, htfBias === "range" ? "bullish" : htfBias as StructureDirection);

  const absorption = obAbsorption || fvgAbsorption;
  const absorptionScore = Math.max(obScore, fvgScore);

  return {
    symbol, timeframe,
    asOf: new Date().toISOString(),
    candleCount: candles.length,
    swings: allSwings.slice(-MAX_SWINGS),
    bos: bos.slice(-MAX_STRUCTURE_EVENTS),
    choch: choch.slice(-MAX_STRUCTURE_EVENTS),
    fvgs,
    orderBlocks: orderBlocks,
    liquidity: liquidity.levels.slice(0, MAX_LIQUIDITY),
    sweeps: liquidity.sweeps.slice(0, MAX_LIQUIDITY),
    runs: liquidity.runs.slice(0, MAX_LIQUIDITY),
    asia,
    range: computeRange(allSwings),
    htfBias,
    absorption,
    absorptionScore,
  };
}
