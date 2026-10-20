import { NextResponse } from "next/server";
import { internalError, parseQuery } from "@/lib/api";
import { statsJournalSchema } from "@/lib/journal/schemas";
import { computeJournalStats } from "@/lib/journal/store";

// GET /api/journal/stats?from=&to=&includeOverrides=true
// Numbers only — win rate, averages, expectancy and breakdowns. No tuning
// recommendation is ever invented here. By default scratched/invalidated/
// expired rows and blocked-idea overrides are excluded.

export async function GET(request: Request) {
  const parsed = parseQuery(statsJournalSchema, request);
  if (!parsed.ok) return parsed.data.response;
  try {
    const stats = await computeJournalStats(parsed.data);
    return NextResponse.json(stats);
  } catch (err) {
    return internalError(err);
  }
}