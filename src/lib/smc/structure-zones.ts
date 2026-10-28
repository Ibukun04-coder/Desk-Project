import type {
  BreakEvent, FairValueGap, HtfBias, LiquidityLevel, NumericCandle,
  OrderBlock, SmcRange, Swing,
  StructureDirection,
  LiquiditySweep, LiquidityRun,

} from "./types";

// FVG / order-block / liquidity / range. Pure + deterministic.

const OB_LOOKBACK = 8;

/**
 * Order block = last opposite candle before the impulsive leg that made the
 * BOS (bullish BOS → last bearish candle in the lookback window; bearish
 * mirror). Zone = that candle's [low, high]. Mitigated when a later candle
 * trades through 50% of the zone (wick counts).
 */
export function detectOrderBlocks(
  candles: NumericCandle[],
  bosEvents: BreakEvent[],
  fvgs: FairValueGap[] = [],
  htfBias: HtfBias = "range",
  sweeps: LiquiditySweep[] = [],
  runs: LiquidityRun[] = [],
): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  for (const ev of bosEvents) {
    const bullish = ev.direction === "bullish";
    let origin: NumericCandle | null = null;
    for (let j = ev.index - 1; j >= Math.max(0, ev.index - OB_LOOKBACK); j--) {
      const c = candles[j];
      const opposite = bullish ? c.close < c.open : c.close > c.open;
      if (opposite) { origin = c; break; }
    }
    if (!origin) continue;
    const low = origin.low;
    const high = origin.high;
    const mid = (low + high) / 2;
    let mitigated = false;
    for (let k = ev.index + 1; k < candles.length; k++) {
      const tradedThrough = bullish ? candles[k].low <= mid : candles[k].high >= mid;
      if (tradedThrough) { mitigated = true; break; }
    }

    // --- Institutional quality filters ---
    // 1. Pro-trend: OB direction must agree with the (final) HTF bias.
    const proTrend =
      htfBias !== "range" &&
      ((bullish && htfBias === "bullish") || (!bullish && htfBias === "bearish"));

    // 2. Formed after a liquidity sweep / run: price took previous highs/lows
    //    (sell-side sweep for demand, buy-side sweep for supply) shortly before
    //    this BOS leg.
    const neededSweepDir: StructureDirection = bullish ? "bearish" : "bullish";
    const afterSweep = [...sweeps, ...runs].some((x) => {
      if (x.direction !== neededSweepDir) return false;
      return x.index >= ev.index - 15 && x.index < ev.index;
    });

    // 3. Clear BOS on a body close is already guaranteed by detectStructure
    //    (breaks are registered on candle close beyond the swing level).
    const bosBodyClose = true;

    // 4. Ideally contains or is closely followed by a same-direction FVG.
    const fvgClose = fvgs.some((f) => {
      if (f.direction !== ev.direction) return false;
      const proximity = f.index >= origin!.index && f.index <= origin!.index + 12;
      const overlaps = !(f.high < low || f.low > high);
      return proximity || overlaps;
    });

    const highProbability = proTrend && afterSweep && bosBodyClose && fvgClose;

    blocks.push({
      index: origin.index, time: origin.time, epoch: origin.epoch,
      low, high, direction: ev.direction,
      kind: bullish ? "demand" : "supply", mitigated,
      quality: highProbability ? "high-probability" : "normal",
    });
  }
  return blocks.sort((a, b) => a.index - b.index);
}

/**
 * 3-candle gap. Bullish: candle[i].high < candle[i+2].low → zone
 * (high[i], low[i+2]) stamped at candle i+2. Bearish inverse.
 * Mitigated when a later wick fills ≥50% of the gap.
 */
export function detectFvgs(candles: NumericCandle[]): FairValueGap[] {
  const gaps: FairValueGap[] = [];
  for (let i = 0; i + 2 < candles.length; i++) {
    const a = candles[i];
    const c = candles[i + 2];
    if (a.high < c.low) {
      const low = a.high;
      const high = c.low;
      const mid = (low + high) / 2;
      let mitigated = false;
      for (let k = i + 3; k < candles.length; k++) {
        if (candles[k].low <= mid) { mitigated = true; break; }
      }
      gaps.push({ index: c.index, time: c.time, epoch: c.epoch, low, high, direction: "bullish", mitigated });
    } else if (a.low > c.high) {
      const low = c.high;
      const high = a.low;
      const mid = (low + high) / 2;
      let mitigated = false;
      for (let k = i + 3; k < candles.length; k++) {
        if (candles[k].high >= mid) { mitigated = true; break; }
      }
      gaps.push({ index: c.index, time: c.time, epoch: c.epoch, low, high, direction: "bearish", mitigated });
    }
  }
  return gaps;
}
