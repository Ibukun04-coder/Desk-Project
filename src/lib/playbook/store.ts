import { prisma } from "@/lib/data/prisma";
import { toRuleDto, type PlaybookRuleDto } from "./rules";

// Playbook rule persistence. Sort: sortOrder then createdAt.

export async function listPlaybookRules(): Promise<PlaybookRuleDto[]> {
  const rows = await prisma.playbookRule.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toRuleDto);
}

export async function listEnabledPlaybookRules(): Promise<PlaybookRuleDto[]> {
  const rows = await prisma.playbookRule.findMany({
    where: { enabled: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toRuleDto);
}

export async function getPlaybookRule(id: string): Promise<PlaybookRuleDto | null> {
  const row = await prisma.playbookRule.findUnique({ where: { id } });
  return row ? toRuleDto(row) : null;
}
