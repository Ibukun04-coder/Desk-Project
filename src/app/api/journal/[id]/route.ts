import { NextResponse } from "next/server";
import { internalError, parseBody } from "@/lib/api";
import { computePlannedR } from "@/lib/journal/types";
import { updateJournalSchema } from "@/lib/journal/schemas";
import { getJournalEntry, toJournalDto } from "@/lib/journal/store";
import { prisma } from "@/lib/data/prisma";

// GET   /api/journal/:id → one entry incl. its log-time snapshots.
// PATCH /api/journal/:id → edit thesis, tags, prices and status ONLY while the
//                           entry is not closed. Snapshots and close fields are
//                           never writable from the client — history stays a
//                           snapshot, so a later playbook edit cannot rewrite it.

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const entry = await getJournalEntry(id);
    if (!entry) return NextResponse.json({ error: "Journal entry not found" }, { status: 404 });
    return NextResponse.json(entry);
  } catch (err) {
    return internalError(err);
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { ok, data } = await parseBody(updateJournalSchema, request);
    if (!ok) return data.response;
    const existing = await prisma.journalEntry.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Journal entry not found" }, { status: 404 });
    if (existing.status === "closed") {
      return NextResponse.json(
        { error: "This entry is closed. Snapshots and close fields are frozen." },
        { status: 400 },
      );
    }

    // Prices may move before close; plannedR is derived, so it follows them.
    const entryPrice = data.entryPrice != null ? data.entryPrice : Number(existing.entryPrice);
    const stopPrice = data.stopPrice != null ? data.stopPrice : Number(existing.stopPrice);
    const targetPrice = data.targetPrice != null ? data.targetPrice : Number(existing.targetPrice);
    const plannedR = computePlannedR(entryPrice, stopPrice, targetPrice);
    if (plannedR === null) {
      return NextResponse.json(
        { error: "Stop price cannot equal entry price — planned R is undefined." },
        { status: 400 },
      );
    }

    const updated = await prisma.journalEntry.update({
      where: { id },
      data: {
        ...(data.thesis !== undefined ? { thesis: data.thesis } : {}),
        ...(data.tags !== undefined ? { tags: data.tags } : {}),
        ...(data.entryPrice !== undefined ? { entryPrice: String(data.entryPrice) } : {}),
        ...(data.stopPrice !== undefined ? { stopPrice: String(data.stopPrice) } : {}),
        ...(data.targetPrice !== undefined ? { targetPrice: String(data.targetPrice) } : {}),
        ...(data.target2Price !== undefined
          ? { target2Price: data.target2Price != null ? String(data.target2Price) : null }
          : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        plannedR: String(plannedR),
      },
    });
    return NextResponse.json(toJournalDto(updated));
  } catch (err) {
    return internalError(err);
  }
}