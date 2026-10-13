import { NextResponse } from "next/server";
import { parseBody, parseQuery, internalError } from "@/lib/api";
import { createRuleSchema } from "@/lib/playbook/rules";
import { getPlaybookRule, listPlaybookRules } from "@/lib/playbook/store";
import { prisma } from "@/lib/data/prisma";
import { z } from "zod";

// GET /api/playbook → rules sorted (sortOrder, createdAt).
// POST /api/playbook → create { title, body, severity, appliesTo, whenJson, enabled?, sortOrder? }.

const emptyQuery = z.object({});

export async function GET(request: Request) {
  const parsed = parseQuery(emptyQuery, request);
  if (!parsed.ok) return parsed.data.response;
  try {
    const rules = await listPlaybookRules();
    return NextResponse.json({ rules, count: rules.length });
  } catch (err) {
    return internalError(err);
  }
}

export async function POST(request: Request) {
  try {
    const { ok, data } = await parseBody(createRuleSchema, request);
    if (!ok) return data.response;
    const created = await prisma.playbookRule.create({ data });
    const dto = await getPlaybookRule(created.id);
    return NextResponse.json(dto, { status: 201 });
  } catch (err) {
    return internalError(err);
  }
}
