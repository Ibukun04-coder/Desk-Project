import { NextResponse, type NextRequest } from "next/server";
import { internalError, parseQuery } from "@/lib/api";
import {
  dailyBiasQuerySchema,
  type DailyBiasListResponse,
  type DailyBiasResponse,
  serializeDailyBias,
} from "@/lib/api/daily-bias";
import {
  getAllDailyBias,
  getLatestDailyBias,
  computeAllDailyBias,
} from "@/lib/data/daily-bias";
import { PAIRS } from "@/lib/data/universe";

// GET /api/daily-bias -> all pairs' latest daily bias
// GET /api/daily-bias?pair=EURUSD -> one pair's latest daily bias
export async function GET(request: NextRequest) {
  try {
    const { ok, data } = parseQuery(dailyBiasQuerySchema, request);
    if (!ok) return data.response;

    if (data.pair) {
      const result = await getLatestDailyBias(data.pair);
      if (!result) {
        return NextResponse.json(
          {
            error: `No daily bias for pair "${data.pair}". Run POST /api/daily-bias/compute first.`,
            pair: data.pair,
          },
          { status: 404 },
        );
      }
      const body: DailyBiasResponse = {
        ...serializeDailyBias(result),
        computedFrom: "previous daily candle + liquidity",
      };
      return NextResponse.json(body);
    }

    const all = await getAllDailyBias();
    const byPair = new Map(all.map((s) => [s.pair, s]));
    const body: DailyBiasListResponse = {
      pairs: PAIRS.map((pair) => {
        const s = byPair.get(pair);
        return s
          ? { ...serializeDailyBias(s), computedFrom: "previous daily candle + liquidity" as const }
          : {
              pair,
              bias: "neutral" as const,
              confidence: 0,
              strength: 0,
              previousDay: {
                open: "0", high: "0", low: "0", close: "0",
                bodyDirection: "neutral", bodyStrength: 0, closePosition: 0,
              },
              liquidity: {
                pdh: "0", pdl: "0", eqh: null, eql: null,
                liquidityTaken: "none" as const, liquidityLeft: "none" as const,
              },
              liquiditySweeps: [],
              liquidityRuns: [],
              invalidation: "Daily bias not yet computed.",
              asOf: "",
              method: "rules-v1" as const,
              computedFrom: "previous daily candle + liquidity" as const,
            };
      }),
      computedFrom: "previous daily candle + liquidity",
    };
    return NextResponse.json(body);
  } catch (err) {
    return internalError(err);
  }
}

// POST /api/daily-bias/compute -> compute & persist daily bias for all pairs
export async function POST() {
  try {
    const { computeAllDailyBias } = await import("@/lib/data/daily-bias");
    const results = await computeAllDailyBias();
    return NextResponse.json({
      computed: results.length,
      pairs: results.map((r) => ({
        pair: r.pair,
        bias: r.bias,
        confidence: r.confidence,
        strength: r.strength,
        liquidityTaken: r.liquidity.liquidityTaken,
        liquidityLeft: r.liquidity.liquidityLeft,
      })),
    });
  } catch (err) {
    return internalError(err);
  }
}
