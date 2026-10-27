import type { NumericCandle, AsiaLiquidity } from "./types";

export type AsiaSessionConfig = {
  startHourUtc: number; // inclusive
  endHourUtc: number;   // exclusive
};

export const DEFAULT_ASIA_SESSION: AsiaSessionConfig = { startHourUtc: 0, endHourUtc: 8 };

function utcDateKey(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  return d.toISOString().slice(0, 10);
}

function hourUtc(epochSec: number): number {
  return new Date(epochSec * 1000).getUTCHours();
}

/**
 * Detect Asia session high/low for each UTC day present in the candles.
 * Asia session = [startHourUtc, endHourUtc) UTC. Only candles whose hour falls
 * in that window contribute. A day with no Asia candles is skipped.
 */
export function detectAsiaLiquidity(
  candles: NumericCandle[],
  config: AsiaSessionConfig = DEFAULT_ASIA_SESSION,
): AsiaLiquidity[] {
  const byDay = new Map<string, NumericCandle[]>();
  for (const c of candles) {
    const h = hourUtc(c.epoch);
    if (h < config.startHourUtc || h >= config.endHourUtc) continue;
    const key = utcDateKey(c.epoch);
    const arr = byDay.get(key) ?? [];
    arr.push(c);
    byDay.set(key, arr);
  }

  const out: AsiaLiquidity[] = [];
  for (const [date, cs] of byDay) {
    if (cs.length === 0) continue;
    let high = -Infinity, low = Infinity;
    let highC: NumericCandle | null = null, lowC: NumericCandle | null = null;
    for (const c of cs) {
      if (c.high > high) { high = c.high; highC = c; }
      if (c.low < low) { low = c.low; lowC = c; }
    }
    if (!highC || !lowC) continue;

    // sweep detection: after the Asia window ends for that day, did price
    // wick beyond asia high/low and close back inside?
    const asiaEndEpoch = new Date(date + "T" + String(config.endHourUtc).padStart(2, "0") + ":00:00Z").getTime() / 1000;
    let sweptHigh = false, sweptLow = false;
    let sweepHighTime: string | null = null, sweepLowTime: string | null = null;
    for (const c of candles) {
      if (c.epoch < asiaEndEpoch) continue;
      // only consider same day (before next day's asia start)
      const nextDayStart = new Date(date + "T00:00:00Z").getTime() / 1000 + 86400;
      if (c.epoch >= nextDayStart) break;
      if (!sweptHigh && c.high > high && c.close <= high) {
        sweptHigh = true; sweepHighTime = c.time;
      }
      if (!sweptLow && c.low < low && c.close >= low) {
        sweptLow = true; sweepLowTime = c.time;
      }
    }

    out.push({
      date,
      high,
      low,
      highTime: highC.time,
      lowTime: lowC.time,
      highEpoch: highC.epoch,
      lowEpoch: lowC.epoch,
      sweptHigh,
      sweptLow,
      sweepHighTime,
      sweepLowTime,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}