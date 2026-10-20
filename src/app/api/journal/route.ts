import { NextResponse } from "next/server";
import { internalError, parseBody, parseQuery } from "@/lib/api";
import { computePlannedR } from "@/lib/journal/types";
import { createJournalSchema, listJournalSchema } from "@/lib/journal/schemas";
import {
  computePlaybookVerdict,
  listJournalEntries,
  toJournalDto,
} from "@/lib/journal/store";
import { prisma } from "@/lib/data/prisma";

// GET  /api/journal           → list, newest first, filtered + paginated.
// POST /api/journal           → log a paper setup. Server loads the current
//                               bias, playbook verdict and SMC itself (both
//                               from_setup and manual run the same gate) and
//                               stores them as an immutable log-time snapshot.
// Analysis records only — nothing here places or simulates a fill.

export async function GET(request: Request) {
  const parsed = parseQuery(listJournalSchema, request);
  if (!parsed.ok) return parsed.data.response;
  try {
    const result = await listJournalEntries(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    return internalError(err);
  }
}

export async function POST(request: Request) {
  const parsed = await parseBody(createJournalSchema, request);
  if (!parsed.ok) return parsed.data.response;
  try {
    const input = parsed.data;
    const plannedR = computePlannedR(input.entryPrice, input.stopPrice, input.targetPrice);
    if (plannedR === null) {
      return NextResponse.json(
        { error: "Stop price cannot equal entry price — planned R is undefined." },
        { status: 400 },
      );
    }

    // The playbook function is called ONCE, here. The stored snapshot is what
    // stats and the UI read forever; nothing re-scores this row later.
    const verdict = await computePlaybookVerdict({
      pair: input.pair,
      timeframe: input.timeframe,
      direction: input.direction,
      entryPrice: input.entryPrice,
      stopPrice: input.stopPrice,
      targetPrice: input.targetPrice,
    });

    // Gate: block can never become an active paper trade — idea only, and only
    // with a non-empty override reason that stats can exclude later.
    if (verdict.playbook.verdict === "block") {
      if (input.status === "active") {
        return NextResponse.json(
          { error: "Playbook blocked this setup. It can be saved as an idea, never as an active paper trade." },
          { status: 400 },
        );
      }
      if (!input.overrideReason || input.overrideReason.trim().length === 0) {
        return NextResponse.json(
          { error: "A blocked setup needs a non-empty overrideReason to be saved as an idea." },
          { status: 400 },
        );
      }
    }

    // Bias snapshot is nullable only when it could not be loaded — then a note is required.
    if (!verdict.bias && !input.biasNote?.trim()) {
      return NextResponse.json(
        { error: "No bias snapshot could be loaded for this pair. Add a biasNote explaining the gap." },
        { status: 400 },
      );
    }

    const created = await prisma.journalEntry.create({
      data: {
        pair: input.pair,
        timeframe: input.timeframe,
        direction: input.direction,
        status: input.status,
        entryPrice: String(input.entryPrice),
        stopPrice: String(input.stopPrice),
        targetPrice: String(input.targetPrice),
        target2Price: input.target2Price != null ? String(input.target2Price) : null,
        plannedR: String(plannedR),
        thesis: input.thesis,
        biasSnapshot: verdict.bias ?? undefined,
        biasNote: verdict.bias ? null : input.biasNote!.trim(),
        playbookSnapshot: verdict.playbook,
        smcSnapshot: verdict.smc ?? undefined,
        source: input.source,
        overrideReason: input.overrideReason?.trim() || null,
        tags: input.tags,
      },
    });
    return NextResponse.json(toJournalDto(created), { status: 201 });
  } catch (err) {
    return internalError(err);
  }
}