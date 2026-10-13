// Seed the 5 Phase 4a rules (idempotent — skips when any rules exist).
// Run: npx tsx src/scripts/seed-playbook.ts. Rules beat the model: enabled
// block/downgrade rules constrain setups in src/lib/playbook/evaluate.ts.

import { prisma } from "@/lib/data/prisma";

type SeedRule = {
  title: string;
  body: string;
  severity: "block" | "downgrade";
  appliesTo: "all" | "long" | "short";
  whenJson: string;
  sortOrder: number;
};

const SEED_RULES: SeedRule[] = [
  {
    title: "Do not short into demand",
    body: "Do not short into unmitigated demand / bullish order block on this timeframe.",
    severity: "block",
    appliesTo: "short",
    whenJson: JSON.stringify({ kind: "ob_overlap", obKind: "demand" }),
    sortOrder: 10,
  },
  {
    title: "Do not long into supply",
    body: "Do not long into unmitigated supply / bearish order block on this timeframe.",
    severity: "block",
    appliesTo: "long",
    whenJson: JSON.stringify({ kind: "ob_overlap", obKind: "supply" }),
    sortOrder: 20,
  },
  {
    title: "Cap non-aligned setups at B",
    body: "If fundamental bias is mixed or conflicts with SMC direction, cap at B.",
    severity: "downgrade",
    appliesTo: "all",
    whenJson: JSON.stringify({ kind: "not_aligned" }),
    sortOrder: 30,
  },
  {
    title: "No A into high-impact news",
    body: "No A-setup in the 30 minutes before a high-impact event on either currency of the pair.",
    severity: "block",
    appliesTo: "all",
    whenJson: JSON.stringify({ kind: "event_window", minutes: 30 }),
    sortOrder: 40,
  },
  {
    title: "Premium/discount discipline",
    body: "If entry is in premium for a long, or in discount for a short, downgrade.",
    severity: "downgrade",
    appliesTo: "all",
    whenJson: JSON.stringify({ kind: "premium_discount" }),
    sortOrder: 50,
  },
];

async function main(): Promise<void> {
  const existing = await prisma.playbookRule.count();
  if (existing > 0) {
    console.log(`seed-playbook: ${existing} rule(s) already present — skipping.`);
    return;
  }
  for (const rule of SEED_RULES) {
    await prisma.playbookRule.create({
      data: { ...rule, enabled: true },
    });
  }
  console.log(`seed-playbook: inserted ${SEED_RULES.length} rules.`);
}

main().catch((err: unknown) => {
  console.error("seed-playbook failed:", err);
  process.exit(1);
});
