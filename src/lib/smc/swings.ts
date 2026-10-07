import type { NumericCandle, SmcCandleInput, Swing } from "./types";

// Fractal swings + ATR. Pure functions; no I/O.

export const SWING_ORDER = 2;

/**
 * Parse decimal strings to numbers once at the edge (Phase 1 stores prices as
 * strings). Drops rows with unparseable prices/times so the detector never
 * crashes on bad input. Output is oldest → newest with positional indices.
 */
export function toNumericCandles(candles: SmcCandleInput[]): NumericCandle[] {
  const out: NumericCandle[] = [];
  for (const c of candles) {
    const ms = new Date(c.openTime).getTime();
    const open = Number(c.open);
    const high = Number(c.high);
    const low = Number(c.low);
    const close = Number(c.close);
    if (!Number.isFinite(ms) || !Number.isFinite(open) || !Number.isFinite(high) ||
        !Number.isFinite(low) || !Number.isFinite(close)) {
      continue;
    }
    out.push({
      time: c.openTime,
      epoch: Math.floor(ms / 1000),
      open, high, low, close,
      index: out.length,
    });
  }
  return out;
}

/**
 * Fractal swings, n = SWING_ORDER (default 2): a swing high is strictly higher
 * than the 2 highs on each side; inverse for a swing low.
 * The last `order` candles are unconfirmed by construction (a center at index
 * i needs candles up to i + order), so they can never be swing centers.
 */
export function findSwings(candles: NumericCandle[], order: number = SWING_ORDER): Swing[] {
  const swings: Swing[] = [];
  if (candles.length < order * 2 + 1) return swings;
  for (let i = order; i <= candles.length - 1 - order; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = i - order; j <= i + order; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high) isHigh = false;
      if (candles[j].low <= c.low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) swings.push({ index: i, time: c.time, epoch: c.epoch, price: c.high, type: "high" });
    else if (isLow) swings.push({ index: i, time: c.time, epoch: c.epoch, price: c.low, type: "low" });
  }
  return swings;
}

/** Simple average true range over the trailing `period` (or all candles if fewer). */
export function atr(candles: NumericCandle[], period: number = 14): number {
  if (candles.length < 2) return 0;
  const start = Math.max(1, candles.length - period);
  let sum = 0;
  let n = 0;
  for (let i = start; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    if (Number.isFinite(tr)) { sum += tr; n++; }
  }
  return n > 0 ? sum / n : 0;
}
