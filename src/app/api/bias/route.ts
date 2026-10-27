import { NextResponse, type NextRequest } from "next/server";
import { internalError, parseQuery } from "@/lib/api";
import { biasQuerySchema, serializeBiasResult } from "@/lib/api/bias";
import { getBiasSnapshots, getLatestBias } from "@/lib/data/bias";
import { getAllDailyBias, getLatestDailyBias } from "@/lib/data/daily-bias";
import { serializeDailyBias } from "@/lib/api/daily-bias";
import { getProviderModes } from "@/lib/data/config";
import { PAIRS } from "@/lib/data/universe";

// GET /api/bias -> all latest snapshots; GET /api/bias?pair=EURUSD -> one.
export async function GET(request: NextRequest) {
  try {
    const { ok, data } = parseQuery(biasQuerySchema, request);
    if (!ok) return data.response;
    const modes = getProviderModes();
    const providers = { price: modes.price.name, calendar: modes.calendar.name, news: modes.news.name };
    const llmActive = Boolean(process.env.OPENAI_API_KEY || process.env.XAI_API_KEY || process.env.GROK_API_KEY);
    const allDaily = await getAllDailyBias();
    const dailyByPair = new Map(allDaily.map((d) => [d.pair, d]));
    if (data.pair) {
      const [result, daily] = await Promise.all([
        getLatestBias(data.pair),
        getLatestDailyBias(data.pair),
      ]);
      if (!result) {
        return NextResponse.json(
          { error: `No bias snapshot for pair "${data.pair}". Run POST /api/bias/recompute first.`, computedFrom: "stored news + calendar", pair: data.pair },
          { status: 404 },
        );
      }
      return NextResponse.json({ ...serializeBiasResult(result, daily ? serializeDailyBias(daily) : null), computedFrom: "stored news + calendar", providers, llmActive });
    }
    const snapshots = await getBiasSnapshots();
    const byPair = new Map(snapshots.map((s) => [s.pair, s]));
    return NextResponse.json({
      pairs: PAIRS.map((pair) => {
        const s = byPair.get(pair);
        return s
          ? { ...serializeBiasResult(s), computedFrom: "stored news + calendar" as const }
          : {
              pair,
              bias: "neutral" as const,
              confidence: 0,
              drivers: [],
              nextEvent: null,
              invalidation: "No bias computed yet.",
              asOf: null,
              method: "rules-v1" as const,
              usedLlm: false,
              dailyBias: dailyByPair.get(pair) ? serializeDailyBias(dailyByPair.get(pair)!) : null,
              computedFrom: "stored news + calendar" as const,
            };
      }),
      providers,
      llmActive,
    });
  } catch (err) {
    return internalError(err);
  }
}

// POST /api/bias recomputes every pair from stored rows and persists snapshots.
export async function POST() {
  try {
    const { recomputeAllPairs } = await import("@/lib/data/bias");
    const results = await recomputeAllPairs();
    return NextResponse.json({
      computed: results.length,
      pairs: results.map((r) => ({ pair: r.pair, bias: r.bias, confidence: r.confidence, usedLlm: r.usedLlm })),
    });
  } catch (err) {
    return internalError(err);
  }
}
