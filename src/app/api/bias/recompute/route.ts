import { NextResponse } from "next/server";
import { internalError, parseBody } from "@/lib/api";
import { recomputeBodySchema } from "@/lib/api/bias";
import { PAIRS } from "@/lib/data/universe";

// POST /api/bias/recompute { pairs?: [...] } -> score + persist, 400 on bad input.
export async function POST(request: Request) {
  try {
    const { ok, data } = await parseBody(recomputeBodySchema, request);
    if (!ok) return data.response;
    const { recomputeAllPairs } = await import("@/lib/data/bias");
    const results = await recomputeAllPairs(data.pairs ?? [...PAIRS]);
    return NextResponse.json({
      computed: results.length,
      pairs: results.map((r) => ({ pair: r.pair, bias: r.bias, confidence: r.confidence, usedLlm: r.usedLlm })),
    });
  } catch (err) {
    return internalError(err);
  }
}
