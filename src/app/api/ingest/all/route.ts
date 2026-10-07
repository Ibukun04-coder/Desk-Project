import { NextRequest, NextResponse } from "next/server";
import { internalError } from "@/lib/api";
import { runAllIngest } from "@/lib/data/ingest";
import { recomputeAllPairs } from "@/lib/data/bias";

export async function POST(request: NextRequest) {
  try {
    const results = await runAllIngest();
    // One button updates data + bias. recomputeAllPairs is idempotent and safe in
    // mock mode (no LLM keys required).
    const biasSnapshots = await recomputeAllPairs(["EURUSD", "GBPUSD", "USDJPY", "XAUUSD"]);
    return NextResponse.json({
      data: { ingest: results, bias: biasSnapshots },
      ingestStatus: results.map((r) => ({ kind: r.kind, status: r.status, mock: r.mock, stats: r.stats })),
      biasSnapshots: biasSnapshots.map((s) => ({ pair: s.pair, bias: s.bias, confidence: s.confidence, usedLlm: s.usedLlm })),
    });
  } catch (err) {
    return internalError(err);
  }
}
