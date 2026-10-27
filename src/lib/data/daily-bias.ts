﻿import { prisma } from "./prisma";
import { PAIRS, type Pair } from "./universe";
import { getCandles } from "./queries";
import type { CandleDto } from "./queries";
import { detectSmc } from "../smc/detect";
import type { LiquiditySweep, LiquidityRun } from "../smc/types";

// ============================================================================
// Types
// ============================================================================

export type DailyBiasDir = "bullish" | "bearish" | "neutral";
export type LiquiditySide = "none" | "buySide" | "sellSide" | "both";

export interface DailyBiasResult {
  pair: Pair;
  bias: DailyBiasDir;
  confidence: number;   // 0-100
  strength: number;     // 0-100
  previousDay: {
    open: string;
    high: string;
    low: string;
    close: string;
    bodyDirection: DailyBiasDir;
    bodyStrength: number; // 0-1
    closePosition: number; // 0-1
  };
  liquidity: {
    pdh: string;
    pdl: string;
    eqh: string | null;
    eql: string | null;
    liquidityTaken: LiquiditySide;
    liquidityLeft: LiquiditySide;
  };
  invalidation: string;
  liquiditySweeps: LiquiditySweep[];
  liquidityRuns: LiquidityRun[];
  asOf: string;
  method: "rules-v1";
}

// ============================================================================
// Constants
// ============================================================================

const EQ_TOLERANCE: Record<Pair, number> = {
  EURUSD: 0.0003,
  GBPUSD: 0.0003,
  USDJPY: 0.03,
  XAUUSD: 0.30,
};

const MIN_BODY_STRENGTH = 0.25;
const BIAS_THRESHOLD = 0.15;
const EQH_EQL_LOOKBACK = 20;


// ============================================================================
// Core calculation
// ============================================================================

/**
 * Calculate the daily bias for a single pair from its D1 candles.
 *
 * The previous *completed* daily candle is the second-to-last candle in the
 * series (the last candle is the current session, possibly still forming).
 * We read how it closed (body direction + strength), which liquidity levels it
 * took vs left, and combine both into a directional bias.
 */
export function calculateDailyBias(candles: CandleDto[]): DailyBiasResult | null {
  if (candles.length < 2) return null;

  const asc = [...candles].sort(
    (a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime(),
  );

  const previous = asc[asc.length - 2];

  const prevOpen = Number(previous.open);
  const prevHigh = Number(previous.high);
  const prevLow = Number(previous.low);
  const prevClose = Number(previous.close);
  const prevRange = prevHigh - prevLow;

  if (!Number.isFinite(prevRange) || prevRange <= 0) return null;

  // --- Body direction & strength -------------------------------------------
  const bodySize = Math.abs(prevClose - prevOpen);
  const bodyStrength = bodySize / prevRange; // 0-1
  const bodyDirection: DailyBiasDir =
    prevClose > prevOpen ? "bullish" : prevClose < prevOpen ? "bearish" : "neutral";

  // Where the close sits within the day's range: 0 = lows, 1 = highs.
  const closePosition = (prevClose - prevLow) / prevRange;

  // --- Liquidity context (levels from before the previous day) -------------
  const contextCandles = asc.slice(0, asc.length - 1);
  const lookback = contextCandles.slice(-EQH_EQL_LOOKBACK);
  const pair = (previous.openTime.slice(0, 4) as Pair) ?? "EURUSD";
  const tol = EQ_TOLERANCE[pair] ?? 0.0003;

  const eqh = findEqualLevel(lookback, "high", tol);
  const eql = findEqualLevel(lookback, "low", tol);

  // --- Liquidity taken vs left by the previous day -------------------------
  const pdh = prevHigh;
  const pdl = prevLow;

  let liquidityTaken: LiquiditySide = "none";
  const takenLevels: number[] = [];
  const leftLevels: number[] = [];

  if (eqh != null && prevHigh > eqh + tol) {
    liquidityTaken = "buySide";
    takenLevels.push(eqh);
  }
  if (eql != null && prevLow < eql - tol) {
    liquidityTaken = liquidityTaken === "buySide" ? "both" : "sellSide";
    takenLevels.push(eql);
  }

  if (liquidityTaken === "none") {
    leftLevels.push(pdh, pdl);
  } else if (liquidityTaken === "buySide") {
    leftLevels.push(pdl);
    if (eql != null) leftLevels.push(eql);
  } else if (liquidityTaken === "sellSide") {
    leftLevels.push(pdh);
    if (eqh != null) leftLevels.push(eqh);
  } else {
    leftLevels.push(pdh, pdl);
  }

  const liquidityLeft: LiquiditySide =
    liquidityTaken === "buySide" ? "sellSide" :
    liquidityTaken === "sellSide" ? "buySide" :
    "none";

  // --- Bias score (-1 to +1) -----------------------------------------------
  const bodyScore =
    bodyDirection === "bullish" ? bodyStrength :
    bodyDirection === "bearish" ? -bodyStrength : 0;

  let liqScore = 0;
  if (liquidityLeft === "buySide" && bodyDirection !== "bearish") liqScore += 0.5;
  if (liquidityLeft === "sellSide" && bodyDirection !== "bullish") liqScore -= 0.5;
  if (liquidityTaken === "both") liqScore = 0;

  const closeScore = (closePosition - 0.5) * 2; // -1 to +1

  const score = bodyScore * 0.4 + liqScore * 0.4 + closeScore * 0.2;

  const bias: DailyBiasDir =
    score >= BIAS_THRESHOLD ? "bullish" : score <= -BIAS_THRESHOLD ? "bearish" : "neutral";

  const strength = Math.round(Math.min(100, Math.abs(score) * 100));
  const confidence = bias === "neutral"
    ? 0
    : Math.round(Math.min(100, strength * Math.max(0.3, bodyStrength)));

  const decimals = { EURUSD: 5, GBPUSD: 5, USDJPY: 3, XAUUSD: 2 }[pair];
  const fmt = (p: number) => p.toFixed(decimals);
  const invalidation =
    bias === "bullish"
      ? `Invalidated if price closes below previous day low (${fmt(pdl)}).`
      : bias === "bearish"
        ? `Invalidated if price closes above previous day high (${fmt(pdh)}).`
        : "No clear direction ΓÇö awaiting a decisive daily close.";

  // --- SMC liquidity sweeps & runs on the D1 series -------------------------
  const smc = detectSmc(pair, "D1", candles as { openTime: string; open: string; high: string; low: string; close: string }[]);
  const liquiditySweeps = smc.sweeps;
  const liquidityRuns = smc.runs;

  return {
    pair,
    bias,
    confidence,
    strength,
    previousDay: {
      open: String(prevOpen),
      high: String(prevHigh),
      low: String(prevLow),
      close: String(prevClose),
      bodyDirection,
      bodyStrength: Math.round(bodyStrength * 100) / 100,
      closePosition: Math.round(closePosition * 100) / 100,
    },
    liquidity: {
      pdh: String(pdh),
      pdl: String(pdl),
      eqh: eqh != null ? String(eqh) : null,
      eql: eql != null ? String(eql) : null,
      liquidityTaken,
      liquidityLeft,
    },
    invalidation,
    liquiditySweeps,
    liquidityRuns,
    asOf: previous.openTime,
    method: "rules-v1",
  };
}

// ============================================================================
// Persistence
// ============================================================================

/** Persist a daily bias result (upsert on pair + asOf date). */
export async function storeDailyBias(result: DailyBiasResult): Promise<void> {
  const asOf = new Date(result.asOf);
  asOf.setUTCHours(0, 0, 0, 0);

  await prisma.dailyBias.upsert({
    where: { pair_asOf: { pair: result.pair, asOf } },
    update: {
      bias: result.bias,
      confidence: result.confidence,
      strength: result.strength,
      previousDayOpen: result.previousDay.open,
      previousDayHigh: result.previousDay.high,
      previousDayLow: result.previousDay.low,
      previousDayClose: result.previousDay.close,
      bodyDirection: result.previousDay.bodyDirection,
      bodyStrength: String(result.previousDay.bodyStrength),
      closePosition: String(result.previousDay.closePosition),
      liquidityTaken: result.liquidity.liquidityTaken,
      liquidityLeft: result.liquidity.liquidityLeft,
      pdh: result.liquidity.pdh,
      pdl: result.liquidity.pdl,
      eqh: result.liquidity.eqh ?? null,
      eql: result.liquidity.eql ?? null,
      invalidation: result.invalidation,
      method: result.method,
      liquiditySweeps: result.liquiditySweeps,
      liquidityRuns: result.liquidityRuns,
    },
    create: {
      pair: result.pair,
      bias: result.bias,
      confidence: result.confidence,
      strength: result.strength,
      previousDayOpen: result.previousDay.open,
      previousDayHigh: result.previousDay.high,
      previousDayLow: result.previousDay.low,
      previousDayClose: result.previousDay.close,
      bodyDirection: result.previousDay.bodyDirection,
      bodyStrength: String(result.previousDay.bodyStrength),
      closePosition: String(result.previousDay.closePosition),
      liquidityTaken: result.liquidity.liquidityTaken,
      liquidityLeft: result.liquidity.liquidityLeft,
      pdh: result.liquidity.pdh,
      pdl: result.liquidity.pdl,
      eqh: result.liquidity.eqh ?? null,
      eql: result.liquidity.eql ?? null,
      invalidation: result.invalidation,
      method: result.method,
      asOf,
      liquiditySweeps: result.liquiditySweeps,
      liquidityRuns: result.liquidityRuns,
    },
  });
}

/** Get the latest stored daily bias for a pair. Returns null if none exists. */
export async function getLatestDailyBias(pair: Pair): Promise<DailyBiasResult | null> {
  try {
    const row = await prisma.dailyBias.findFirst({
      where: { pair },
      orderBy: { asOf: "desc" },
    });
    if (!row) return null;
    return rowToDailyBiasResult(row);
  } catch (err) {
    // Column may not exist yet (migration not deployed); return null instead of crashing
    console.error(`[getLatestDailyBias] error for ${pair}:`, err);
    return null;
  }
}

/** Get the latest stored daily bias for all pairs (newest per pair). */
export async function getAllDailyBias(): Promise<DailyBiasResult[]> {
  try {
    const rows = await prisma.dailyBias.findMany({
      orderBy: { asOf: "desc" },
    });
    const seen = new Set<Pair>();
    const out: DailyBiasResult[] = [];
    for (const row of rows) {
      const p = row.pair as Pair;
      if (seen.has(p)) continue;
      seen.add(p);
      const r = rowToDailyBiasResult(row);
      if (r) out.push(r);
    }
    return out;
  } catch (err) {
    // Column may not exist yet (migration not deployed); return empty array instead of crashing
    console.error("[getAllDailyBias] error:", err);
    return [];
  }
}

function rowToDailyBiasResult(row: {
  pair: string;
  bias: string;
  confidence: number;
  strength: number;
  previousDayOpen: string;
  previousDayHigh: string;
  previousDayLow: string;
  previousDayClose: string;
  bodyDirection: string;
  bodyStrength: string;
  closePosition: string;
  liquidityTaken: string;
  liquidityLeft: string;
  pdh: string;
  pdl: string;
  eqh: string | null;
  eql: string | null;
  invalidation: string;
  asOf: Date;
  method: string;
  liquiditySweeps: unknown;
  liquidityRuns: unknown;
}): DailyBiasResult | null {
  const pair = row.pair as Pair;
  const bodyStrength = Number(row.bodyStrength);
  const closePosition = Number(row.closePosition);
  if (!Number.isFinite(bodyStrength) || !Number.isFinite(closePosition)) return null;
  return {
    pair,
    bias: row.bias as DailyBiasDir,
    confidence: row.confidence,
    strength: row.strength,
    previousDay: {
      open: row.previousDayOpen,
      high: row.previousDayHigh,
      low: row.previousDayLow,
      close: row.previousDayClose,
      bodyDirection: row.bodyDirection as DailyBiasDir,
      bodyStrength,
      closePosition,
    },
    liquidity: {
      pdh: row.pdh,
      pdl: row.pdl,
      eqh: row.eqh,
      eql: row.eql,
      liquidityTaken: row.liquidityTaken as LiquiditySide,
      liquidityLeft: row.liquidityLeft as LiquiditySide,
    },
    invalidation: row.invalidation,
    liquiditySweeps: (row.liquiditySweeps as LiquiditySweep[] | null) ?? [],
    liquidityRuns: (row.liquidityRuns as LiquidityRun[] | null) ?? [],
    asOf: row.asOf.toISOString(),
    method: "rules-v1",
  };
}

// ============================================================================
// Batch computation
// ============================================================================

/** Compute and persist daily bias for every pair in the universe. */
export async function computeAllDailyBias(): Promise<DailyBiasResult[]> {
  const results: DailyBiasResult[] = [];
  for (const pair of PAIRS) {
    try {
      const candles = await getCandles({ symbol: pair, timeframe: "D1", limit: 60 });
      const result = calculateDailyBias(candles);
      if (!result) continue;
      await storeDailyBias(result);
      results.push(result);
    } catch (err) {
      console.error(`[daily-bias] compute failed for ${pair}:`, err);
    }
  }
  return results;
}

function findEqualLevel(
  series: CandleDto[],
  side: "high" | "low",
  tol: number,
): number | null {
  if (series.length < 2) return null;
  const prices = series.map((c) => Number(side === "high" ? c.high : c.low)).filter(Number.isFinite);
  prices.sort((a, b) => a - b);
  let best: number | null = null;
  let bestCount = 1;
  let i = 0;
  while (i < prices.length) {
    let j = i + 1;
    while (j < prices.length && Math.abs(prices[j] - prices[i]) <= tol) j++;
    const count = j - i;
    if (count > bestCount) {
      bestCount = count;
      best = prices.slice(i, j).reduce((sum, p) => sum + p, 0) / count;
    }
    i = j;
  }
  return bestCount >= 2 ? best : null;
}

