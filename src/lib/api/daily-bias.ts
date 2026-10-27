import { z } from "zod";
import { PAIRS } from "@/lib/data/universe";
import type { DailyBiasResult, DailyBiasDir, LiquiditySide } from "@/lib/data/daily-bias";

export const dailyBiasQuerySchema = z.object({ pair: z.enum(PAIRS).optional() });

export type DailyBiasApiResult = Omit<DailyBiasResult, "asOf"> & {
  asOf: string;
};

export function serializeDailyBias(r: DailyBiasResult): DailyBiasApiResult {
  return {
    pair: r.pair,
    bias: r.bias,
    confidence: r.confidence,
    strength: r.strength,
    previousDay: r.previousDay,
    liquidity: r.liquidity,
    invalidation: r.invalidation,
    liquiditySweeps: r.liquiditySweeps,
    liquidityRuns: r.liquidityRuns,
    asOf: r.asOf,
    method: r.method,
  };
}

export type DailyBiasResponse = DailyBiasApiResult & {
  computedFrom: "previous daily candle + liquidity";
};

export type DailyBiasListResponse = {
  pairs: DailyBiasResponse[];
  computedFrom: "previous daily candle + liquidity";
};

export type DailyBiasComputeResponse = {
  computed: number;
  pairs: Array<{
    pair: string;
    bias: DailyBiasDir;
    confidence: number;
    strength: number;
    liquidityTaken: LiquiditySide;
    liquidityLeft: LiquiditySide;
  }>;
};
