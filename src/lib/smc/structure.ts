import type {
  BreakEvent, HtfBias, NumericCandle,
  StructureDirection, Swing,
} from "./types";
import { SWING_ORDER } from "./swings";

// Market-structure walk (BOS / CHOCH / HTF bias). FVG/OB/liquidity/range live
// in structure-zones.ts. All deterministic; only what the candles justify.

export type StructureResult = {
  bos: BreakEvent[];
  choch: BreakEvent[];
  htfBias: HtfBias;
};

function breakOf(
  candles: NumericCandle[], index: number, direction: StructureDirection, brokenLevel: number,
): BreakEvent {
  const c = candles[index];
  return { index, time: c.time, epoch: c.epoch, direction, brokenLevel };
}

/**
 * Walk candles oldest → newest tracking the current trend.
 * - A swing only participates once confirmed (center index + SWING_ORDER).
 * - BOS: close beyond the last opposite swing in the current trend
 *   (or the first break that establishes a trend from neutral).
 * - CHOCH: first close against the trend that breaks the last counter-swing;
 *   labelled CHOCH, then the trend flips.
 */
export function detectStructure(candles: NumericCandle[], swings: Swing[]): StructureResult {
  const bos: BreakEvent[] = [];
  const choch: BreakEvent[] = [];
  let trend: StructureDirection | null = null;
  let lastHigh: Swing | null = null;
  let lastLow: Swing | null = null;
  let swingPtr = 0;
  const ordered = [...swings].sort((a, b) => a.index - b.index);

  for (let i = 0; i < candles.length; i++) {
    while (swingPtr < ordered.length && ordered[swingPtr].index + SWING_ORDER <= i) {
      const s = ordered[swingPtr];
      if (s.type === "high") lastHigh = s;
      else lastLow = s;
      swingPtr++;
    }
    if (!lastHigh || !lastLow) continue;
    const close = candles[i].close;
    if (trend === null) {
      if (close > lastHigh.price) { bos.push(breakOf(candles, i, "bullish", lastHigh.price)); trend = "bullish"; }
      else if (close < lastLow.price) { bos.push(breakOf(candles, i, "bearish", lastLow.price)); trend = "bearish"; }
    } else if (trend === "bullish") {
      if (close > lastHigh.price) bos.push(breakOf(candles, i, "bullish", lastHigh.price));
      else if (close < lastLow.price) { choch.push(breakOf(candles, i, "bearish", lastLow.price)); trend = "bearish"; }
    } else {
      if (close < lastLow.price) bos.push(breakOf(candles, i, "bearish", lastLow.price));
      else if (close > lastHigh.price) { choch.push(breakOf(candles, i, "bullish", lastHigh.price)); trend = "bullish"; }
    }
  }

  const lastBos = bos.length > 0 ? bos[bos.length - 1] : null;
  const lastChoch = choch.length > 0 ? choch[choch.length - 1] : null;
  const last = lastBos && lastChoch
    ? (lastBos.index >= lastChoch.index ? lastBos : lastChoch)
    : (lastBos ?? lastChoch);
  return { bos, choch, htfBias: last ? last.direction : "range" };
}
