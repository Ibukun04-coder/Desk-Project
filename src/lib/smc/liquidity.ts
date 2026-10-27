import type {
  LiquidityLevel, LiquidityRun, LiquiditySweep, NumericCandle,
  SmcRange, Swing,
} from "./types";

// Liquidity clusters + sweeps (rejections) + runs (continuations) + last confirmed swing range.
// Pure + deterministic.

/**
 * Liquidity = clustered swing highs/lows within an ATR-scaled threshold
 * (equal highs/lows), plus the single most recent swing high ("highs",
 * buy-side) and low ("lows", sell-side).
 */
export function detectLiquidity(
  candles: NumericCandle[],
  swings: Swing[],
  atrValue: number,
): { levels: LiquidityLevel[]; sweeps: LiquiditySweep[]; runs: LiquidityRun[] } {
  const out: LiquidityLevel[] = [];
  const tol = Math.max(atrValue * 0.15, 1e-9);

  const cluster = (type: "high" | "low", side: "eqh" | "eql", label: string): void => {
    const pts = swings.filter((s) => s.type === type).sort((a, b) => a.price - b.price);
    const groups: Swing[][] = [];
    for (const p of pts) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(p.price - g[g.length - 1].price) <= tol) g.push(p);
      else groups.push([p]);
    }
    for (const g of groups) {
      if (g.length < 2) continue;
      const latest = g.reduce((m, s) => (s.index > m.index ? s : m), g[0]);
      const avg = g.reduce((sum, s) => sum + s.price, 0) / g.length;
      out.push({ time: latest.time, epoch: latest.epoch, price: avg, side, note: `${g.length} ${label}` });
    }
  };
  cluster("high", "eqh", "equal highs");
  cluster("low", "eql", "equal lows");

  const highs = swings.filter((s) => s.type === "high");
  const lows = swings.filter((s) => s.type === "low");
  if (highs.length > 0) {
    const m = highs.reduce((a, b) => (b.index > a.index ? b : a));
    out.push({ time: m.time, epoch: m.epoch, price: m.price, side: "highs", note: "recent swing high (buy-side)" });
  }
  if (lows.length > 0) {
    const m = lows.reduce((a, b) => (b.index > a.index ? b : a));
    out.push({ time: m.time, epoch: m.epoch, price: m.price, side: "lows", note: "recent swing low (sell-side)" });
  }

  const sweeps = detectSweeps(candles, swings, atrValue);
  const runs = detectRuns(candles, swings, atrValue);

  return {
    levels: out.sort((a, b) => b.epoch - a.epoch),
    sweeps,
    runs,
  };
}

/**
 * Liquidity Sweep (rejection / stop-hunt):
 * Price wicks beyond a swing high or low, then closes back inside the level.
 * The wick takes liquidity; the close back inside signals rejection.
 */
export function detectSweeps(
  candles: NumericCandle[],
  swings: Swing[],
  atrValue: number,
): LiquiditySweep[] {
  const sweeps: LiquiditySweep[] = [];
  const tol = Math.max(atrValue * 0.15, 1e-9);

  for (const swing of swings) {
    const startIdx = swing.index + 1;
    for (let i = startIdx; i < candles.length; i++) {
      const c = candles[i];
      if (swing.type === "high") {
        // Buy-side liquidity: wick above swing high, close back inside.
        if (c.high > swing.price + tol && c.close <= swing.price + tol) {
          sweeps.push({
            index: i,
            time: c.time,
            epoch: c.epoch,
            price: swing.price,
            direction: "bullish", // price moved up to take liquidity
            sweptLevel: swing.price,
            closeInside: true,
          });
          break; // first sweep per level
        }
      } else {
        // Sell-side liquidity: wick below swing low, close back inside.
        if (c.low < swing.price - tol && c.close >= swing.price - tol) {
          sweeps.push({
            index: i,
            time: c.time,
            epoch: c.epoch,
            price: swing.price,
            direction: "bearish",
            sweptLevel: swing.price,
            closeInside: true,
          });
          break;
        }
      }
    }
  }
  return sweeps;
}

/**
 * Liquidity Run (continuation fuel):
 * Price closes beyond a swing high or low and continues with momentum
 * in the same direction. The level is used as fuel, not rejected.
 */
export function detectRuns(
  candles: NumericCandle[],
  swings: Swing[],
  atrValue: number,
): LiquidityRun[] {
  const runs: LiquidityRun[] = [];
  const tol = Math.max(atrValue * 0.15, 1e-9);

  for (const swing of swings) {
    const startIdx = swing.index + 1;
    for (let i = startIdx; i < candles.length; i++) {
      const c = candles[i];
      if (swing.type === "high") {
        // Close breaks above swing high → bullish run.
        if (c.close > swing.price + tol) {
          // Check momentum continuation: next candle also closes above the level.
          let continuation: "bullish" | "bearish" = "bullish";
          if (i + 1 < candles.length) {
            const next = candles[i + 1];
            if (next.close <= swing.price + tol) continuation = "bearish"; // weak / failed
          }
          runs.push({
            index: i,
            time: c.time,
            epoch: c.epoch,
            price: swing.price,
            direction: "bullish",
            brokenLevel: swing.price,
            continuation,
          });
          break; // first run per level
        }
      } else {
        // Close breaks below swing low → bearish run.
        if (c.close < swing.price - tol) {
          let continuation: "bullish" | "bearish" = "bearish";
          if (i + 1 < candles.length) {
            const next = candles[i + 1];
            if (next.close >= swing.price - tol) continuation = "bullish"; // weak / failed
          }
          runs.push({
            index: i,
            time: c.time,
            epoch: c.epoch,
            price: swing.price,
            direction: "bearish",
            brokenLevel: swing.price,
            continuation,
          });
          break;
        }
      }
    }
  }
  return runs;
}

/** Last confirmed swing range; null when either side has no swing. */
export function computeRange(swings: Swing[]): SmcRange | null {
  let high: Swing | null = null;
  let low: Swing | null = null;
  for (const s of swings) {
    if (s.type === "high" && (!high || s.index > high.index)) high = s;
    if (s.type === "low" && (!low || s.index > low.index)) low = s;
  }
  if (!high || !low) return null;
  const midpoint = (high.price + low.price) / 2;
  return { high: high.price, low: low.price, midpoint, premiumMax: high.price, discountMin: low.price };
}
