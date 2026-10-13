import { NextResponse } from "next/server";
import { parseBody, internalError } from "@/lib/api";
import { updateRuleSchema } from "@/lib/playbook/rules";
import { getPlaybookRule } from "@/lib/playbook/store";
import { prisma } from "@/lib/data/prisma";

// PATCH /api/playbook/[id] → edit fields incl. enabled. DELETE → remove.

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { ok, data } = await parseBody(updateRuleSchema, request);
    if (!ok) return data.response;
    const existing = await prisma.playbookRule.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Playbook rule not found" }, { status: 404 });
    await prisma.playbookRule.update({ where: { id }, data });
    return NextResponse.json(await getPlaybookRule(id));
  } catch (err) {
    return internalError(err);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const existing = await prisma.playbookRule.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Playbook rule not found" }, { status: 404 });
    await prisma.playbookRule.delete({ where: { id } });
    return NextResponse.json({ deleted: id });
  } catch (err) {
    return internalError(err);
  }
}
