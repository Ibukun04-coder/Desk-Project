import { NextResponse } from "next/server";
import { internalError, parseBody } from "@/lib/api";
import { closeJournalSchema } from "@/lib/journal/schemas";
import { computeCloseOutcome, getJournalEntry, toJournalDto } from "@/lib/journal/store";
import { prisma } from "@/lib/data/prisma";

// POST /api/journal/:id/close → set exit, compute realizedR + result on the
// server from the STORED entry/stop (never from the client), stamp closedAt
// and move the status to closed (or invalidated/expired for those reasons).
// The playbook snapshot is left untouched — closing never re-scores history.

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { ok, data } = await parseBody(closeJournalSchema, request);
    if (!ok) return data.response;
    const existing = await prisma.journalEntry.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Journal entry not found" }, { status: 404 });
    if (existing.closedAt) {
      return NextResponse.json({ error: "This entry is already closed." }, { status: 400 });
    }

    const outcome = computeCloseOutcome({
      direction: existing.direction === "short" ? "short" : "long",
      entryPrice: Number(existing.entryPrice),
      stopPrice: Number(existing.stopPrice),
      exitPrice: data.exitPrice ?? null,
      exitReason: data.exitReason,
    });

    const updated = await prisma.journalEntry.update({
      where: { id },
      data: {
        exitPrice: outcome.exitPrice != null ? String(outcome.exitPrice) : null,
        exitReason: outcome.exitReason,
        result: outcome.result,
        realizedR: outcome.realizedR != null ? String(outcome.realizedR) : null,
        closedAt: new Date(),
        status: outcome.status,
        ...(data.reviewNote !== undefined ? { reviewNote: data.reviewNote } : {}),
      },
    });
    return NextResponse.json(toJournalDto(updated));
  } catch (err) {
    return internalError(err);
  }
}