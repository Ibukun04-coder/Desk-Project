import { NextResponse } from "next/server";
import { internalError, parseBody } from "@/lib/api";
import { previewJournalSchema } from "@/lib/journal/schemas";
import { computePlaybookVerdict } from "@/lib/journal/store";

// POST /api/journal/preview → run the playbook gate WITHOUT writing anything.
// The new-entry form calls this so the verdict (and the downgrade, if any) is
// visible before the save. Numbers/verdict only — no recommendation.

export async function POST(request: Request) {
  const parsed = await parseBody(previewJournalSchema, request);
  if (!parsed.ok) return parsed.data.response;
  try {
    const input = parsed.data;
    const { playbook, bias, smc } = await computePlaybookVerdict({
      pair: input.pair,
      timeframe: input.timeframe,
      direction: input.direction,
      entryPrice: input.entryPrice,
      stopPrice: input.stopPrice,
      targetPrice: input.targetPrice,
    });
    return NextResponse.json({
      verdict: playbook.verdict,
      grade: playbook.grade,
      originalGrade: playbook.originalGrade,
      fired: playbook.fired,
      alignment: playbook.alignment,
      biasLoaded: bias !== null,
      biasDirection: bias?.direction ?? null,
      biasConfidence: bias?.confidence ?? null,
      smcLoaded: smc !== null,
      htfBias: smc?.htfBias ?? null,
    });
  } catch (err) {
    return internalError(err);
  }
}