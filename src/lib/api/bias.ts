import { z } from "zod";
import { PAIRS } from "@/lib/data/universe";
import type { BiasResult } from "@/lib/data/bias";
import type { DailyBiasApiResult } from "@/lib/api/daily-bias";

export const biasQuerySchema = z.object({ pair: z.enum(PAIRS).optional() });

export const recomputeBodySchema = z.object({ pairs: z.array(z.enum(PAIRS)).max(4).optional() }).default({});

// Dates cross the network as ISO strings; the card formats them at the edge.
export type BiasApiResult = Omit<BiasResult, "asOf" | "nextEvent"> & {
  asOf: string;
  nextEvent: {
    title: string;
    scheduledAt: string;
    currency: string;
    impact: string;
    forecast: string | null;
    previous: string | null;
    actual: string | null;
  } | null;
  /** Phase 6: daily bias filter (higher-timeframe, from previous daily candle). */
  dailyBias: DailyBiasApiResult | null;
};

export function serializeBiasResult(r: BiasResult, dailyBias?: DailyBiasApiResult | null): BiasApiResult {
  return {
    pair: r.pair,
    bias: r.bias,
    confidence: r.confidence,
    drivers: r.drivers,
    nextEvent: r.nextEvent
      ? {
          title: r.nextEvent.headline,
          scheduledAt: r.nextEvent.scheduledAt.toISOString(),
          currency: r.nextEvent.currency,
          impact: r.nextEvent.impact,
          forecast: r.nextEvent.forecast,
          previous: r.nextEvent.previous,
          actual: r.nextEvent.actual,
        }
      : null,
    invalidation: r.invalidation,
    asOf: r.asOf.toISOString(),
    method: r.method,
    usedLlm: r.usedLlm,
    dailyBias: dailyBias ?? null,
  };
}

export type BiasResponse = BiasApiResult & { computedFrom: "stored news + calendar" };

export type BiasListResponse = {
  pairs: BiasResponse[];
  providers: { price: string; calendar: string; news: string };
  llmActive: boolean;
};

export type RecomputeResponse = {
  computed: number;
  pairs: Array<{ pair: string; bias: string; confidence: number; usedLlm: boolean }>;
};
