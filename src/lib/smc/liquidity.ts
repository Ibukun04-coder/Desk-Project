import type { LiquidityLevel, SmcRange, Swing } from "./types";

// Liquidity clusters + last confirmed swing range. Pure + deterministic.

/**
 * Liquidity = clustered swing highs/lows within an ATR-scaled threshold
 * (equal highs/lows), plus the single most recent swing high ("highs",
 * buy-side) and low ("lows", sell-side).
 */
export function detectLiquidity(swings: Swing[], atrValue: number): LiquidityLevel[] {
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
  return out.sort((a, b) => b.epoch - a.epoch);
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
