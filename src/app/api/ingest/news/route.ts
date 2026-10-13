import { NextResponse } from "next/server";
import { internalError } from "@/lib/api";
import { runNewsIngest } from "@/lib/data/ingest";
import { recomputeAllPairs } from "@/lib/data/bias";
import { PAIRS } from "@/lib/data/universe";

export async function POST() {
  try {
    const result = await runNewsIngest();
    // Fresh headlines change bias — recompute from stored rows (rules only).
    if (result.stats.inserted + result.stats.updated > 0) {
      await recomputeAllPairs([...PAIRS]);
    }
    return NextResponse.json({ data: result });
  } catch (err) {
    return internalError(err);
  }
}
