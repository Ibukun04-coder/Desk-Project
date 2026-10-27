import type { Pair, Timeframe } from "@/lib/data/universe";
import type { PlaybookInput } from "./evaluate";
import { atr, toNumericCandles } from "@/lib/smc/swings";
import type { SmcSnapshot } from "@/lib/smc/types";
import type { CalendarEventInput, LastBosMap, BreakInput, ShiftInput, SweepInput, ZoneInput, PoolInput, DealingRangeInput, M15ZoneInput, FundamentalInput } from "./evaluate";
import type { BiasResult } from "@/lib/data/bias";
import type { DailyBiasResult } from "@/lib/data/daily-bias";

export function derivePlaybookInput(
  pair: Pair,
  timeframe: Timeframe,
  candles: { openTime: string; open: string; high: string; low: string; close: string }[],
  smc: SmcSnapshot,
  bias: BiasResult | null,
  dailyBias: DailyBiasResult | null,
  now: number,
): PlaybookInput {
  const numeric = toNumericCandles(candles);
  const atr14 = numeric.length >= 15 ? atr(numeric, 14) : null;

  const fundamental: FundamentalInput | null = bias
    ? {
        direction: bias.bias === "bullish" ? "long" : bias.bias === "bearish" ? "short" : "neutral",
        confidence: bias.confidence,
      }
    : null;

  const calendar: CalendarEventInput[] | null = bias?.nextEvent
    ? [{
        impact: bias.nextEvent.impact as "high" | "medium",
        currency: bias.nextEvent.currency,
        scheduledAt: bias.nextEvent.scheduledAt.toISOString(),
      }]
    : null;

  const lastBos: LastBosMap = { H1: null, H4: null, D1: null };
  const tfKey = timeframe as "H1" | "H4" | "D1";
  if (smc.bos.length > 0 && tfKey in lastBos) {
    const last = smc.bos[smc.bos.length - 1];
    (lastBos as Record<string, "long" | "short" | null>)[tfKey] = last.direction === "bullish" ? "long" : "short";
  }

  const recentBreaks: BreakInput[] = [
    ...smc.bos.map((b) => ({ kind: "BOS", direction: b.direction === "bullish" ? "long" : "short", barIndex: b.index } as BreakInput)),
    ...smc.choch.map((c) => ({ kind: "CHOCH", direction: c.direction === "bullish" ? "long" : "short", barIndex: c.index } as BreakInput)),
  ].sort((a, b) => a.barIndex - b.barIndex);

  const lastBreak = recentBreaks.length > 0 ? recentBreaks[recentBreaks.length - 1] : null;
  const shift: ShiftInput | null = lastBreak
    ? {
        kind: lastBreak.kind,
        direction: lastBreak.direction,
        brokenLevel: smc.bos.find((b) => b.index === lastBreak.barIndex)?.brokenLevel ?? smc.choch.find((c) => c.index === lastBreak.barIndex)?.brokenLevel ?? 0,
        barIndex: lastBreak.barIndex,
        bodyClose: true,
        external: true,
      }
    : null;

  const zones: ZoneInput[] = [
    ...smc.fvgs.map((f) => ({ kind: "fvg", direction: f.direction === "bullish" ? "long" : "short", high: f.high, low: f.low, mitigated: f.mitigated, formedAt: f.index } as ZoneInput)),
    ...smc.orderBlocks.map((o) => ({ kind: "ob", direction: o.direction === "bullish" ? "long" : "short", high: o.high, low: o.low, mitigated: o.mitigated, formedAt: o.index } as ZoneInput)),
  ];

  const pools: PoolInput[] = smc.liquidity.map((l) => ({
    side: l.side === "eqh" || l.side === "highs" ? "buy" : "sell",
    kind: l.side as PoolInput["kind"],
    price: l.price,
    swept: false,
  }));

  const dealingRange: DealingRangeInput | null = smc.range
    ? { high: smc.range.high, low: smc.range.low, bothExtremesSwept: false }
    : null;

  // Map daily bias direction to playbook previousDay (long/short/null).
  const previousDay = dailyBias
    ? (dailyBias.bias === "bullish" ? "long" : dailyBias.bias === "bearish" ? "short" : null)
    : null;

  return {
    pair,
    timeframe,
    now,
    atr14,
    fundamental,
    previousDay,
    calendar,
    lastBos,
    recentBreaks,
    shift,
    sweep: null,
    sweepCandleOpen: null,
    zones,
    pools,
    dealingRange,
    extensionBeyondBreak: null,
    sisterH4Bos: null,
    m15Zone: null,
    lastBarIndex: numeric.length - 1,
    // Absorption/stagnation flags for playbook rules
    absorption: smc.absorption,
    absorptionScore: smc.absorptionScore,
  };
}
