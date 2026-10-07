import type { SmcCandleInput } from "./types";

// Deterministic unit fixtures for the SMC detector (no network, no LLM).
// Validated by src/scripts/smc-check.ts.

function iso(baseMs: number, stepMs: number, i: number): string {
  return new Date(baseMs + i * stepMs).toISOString();
}

function candle(time: string, open: number, high: number, low: number, close: number): SmcCandleInput {
  return {
    openTime: time,
    open: String(open), high: String(high), low: String(low), close: String(close),
  };
}

/**
 * Chop section: strict alternating peaks and troughs so n=2 fractal swings
 * confirm on both sides. Odd candles close AT the peak (or trough); wicks
 * reach 0.0001 beyond but never touch the opposite extreme, keeping the
 * strict inequality intact.
 */
function chop(out: SmcCandleInput[], base: number, step: number, peak: number, trough: number): void {
  // Strict zigzag WITHOUT full-range traversal. Even candles print a small
  // body at the peak (high = peak + wick, low far below); odd candles print
  // a small body at the trough (low = trough - wick, high far above).
  // Consecutive highs strictly alternate high/low so n=2 fractals confirm;
  // same for lows. Bodies alternate direction so an opposite candle always
  // exists for order-block detection.
  for (let i = 0; i < 16; i++) {
    const idx = out.length;
    const atPeak = i % 2 === 0;
    const anchor = atPeak ? peak : trough;
    const dir = i % 4 < 2 ? 1 : -1; // alternate body direction
    // Tiny per-candle jitter so consecutive same-side extremes are never
    // exactly equal (strict fractal needs distinct values).
    const jitter = 0.00002 * Math.sin(i * 1.7);
    const open = anchor - dir * 0.0002 + jitter;
    const close = anchor + dir * 0.0002 + jitter;
    const high = atPeak ? anchor + 0.0001 + jitter : Math.max(open, close) + 0.0009;
    const low = atPeak ? Math.min(open, close) - 0.0009 : anchor - 0.0001 + jitter;
    out.push(candle(iso(base, step, idx), open, high, low, close));
  }
}

/**
 * Obvious up-impulse: 16 sideways candles, then a sharp rally with stepping
 * bodies (guaranteed bullish FVGs + a bullish BOS through the chop high),
 * then 4 steady candles. Must yield ≥1 bullish BOS and (≥1 bullish FVG or
 * ≥1 unmitigated demand OB).
 */
export function buildUpImpulseFixture(): SmcCandleInput[] {
  const base = Date.UTC(2026, 0, 5, 0, 0, 0);
  const step = 60 * 60 * 1000;
  const out: SmcCandleInput[] = [];
  chop(out, base, step, 1.0862, 1.0838);
  let price = Number(out[out.length - 1].close);
  // Impulse: each candle gaps up in body terms — high[i] < low[i+2] by design
  // (small upper wicks, bodies stepping +0.0012 every candle).
  for (let k = 0; k < 10; k++) {
    const i = 16 + k;
    const open = price;
    const close = price + 0.0012;
    out.push(candle(iso(base, step, i), open, close + 0.0001, open - 0.0003, close));
    price = close;
  }
  // Settle: small bullish drift, no pullback into the impulse origin.
  for (let k = 0; k < 4; k++) {
    const i = 26 + k;
    const open = price;
    const close = price + 0.0003;
    out.push(candle(iso(base, step, i), open, close + 0.0002, open - 0.0002, close));
    price = close;
  }
  return out;
}

/** Mirrored down-impulse: chop then sharp selloff (bearish BOS + bearish FVG/OB). */
export function buildDownImpulseFixture(): SmcCandleInput[] {
  const base = Date.UTC(2026, 0, 5, 0, 0, 0);
  const step = 60 * 60 * 1000;
  const out: SmcCandleInput[] = [];
  chop(out, base, step, 1.0962, 1.0938);
  let price = Number(out[out.length - 1].close);
  for (let k = 0; k < 10; k++) {
    const i = 16 + k;
    const open = price;
    const close = price - 0.0012;
    out.push(candle(iso(base, step, i), open, open + 0.0003, close - 0.0001, close));
    price = close;
  }
  for (let k = 0; k < 4; k++) {
    const i = 26 + k;
    const open = price;
    const close = price - 0.0003;
    out.push(candle(iso(base, step, i), open, open + 0.0002, close - 0.0002, close));
    price = close;
  }
  return out;
}

export function buildShortFixture(): SmcCandleInput[] {
  return buildUpImpulseFixture().slice(0, 5);
}
