import { z } from "zod";

// Playbook rule shapes (consumed by the v2 evaluatePlaybook). whenJson stays
// machine-readable; the evaluator switches on `kind`. Unknown kinds are
// ignored, never crash. block/downgrade change the verdict; confluence/info
// are recorded context that never blocks or downgrades.

export const RULE_SEVERITIES = ["block", "downgrade", "confluence", "info"] as const;
export type RuleSeverity = (typeof RULE_SEVERITIES)[number];

export const RULE_APPLIES = ["all", "long", "short"] as const;
export type RuleAppliesTo = (typeof RULE_APPLIES)[number];

export const WHEN_KINDS = ["ob_overlap", "not_aligned", "event_window", "premium_discount"] as const;
export type WhenKind = (typeof WHEN_KINDS)[number];

const baseWhen = z.object({ kind: z.enum(WHEN_KINDS) });

/** Entry zone overlaps an unmitigated opposite-side order block. */
export const obOverlapWhen = baseWhen.extend({
  kind: z.literal("ob_overlap"),
  /** which OB kind counts as opposing flow: demand blocks shorts, supply blocks longs */
  obKind: z.enum(["demand", "supply"]),
});

export const notAlignedWhen = baseWhen.extend({ kind: z.literal("not_aligned") });

export const eventWindowWhen = baseWhen.extend({
  kind: z.literal("event_window"),
  minutes: z.number().int().min(1).max(24 * 60).default(30),
});

export const premiumDiscountWhen = baseWhen.extend({ kind: z.literal("premium_discount") });

export const whenConditionSchema = z.discriminatedUnion("kind", [
  obOverlapWhen,
  notAlignedWhen,
  eventWindowWhen,
  premiumDiscountWhen,
]);

export type WhenCondition = z.infer<typeof whenConditionSchema>;

export const playbookRuleSchema = z.object({
  title: z.string().min(3).max(200),
  body: z.string().max(2000).default(""),
  severity: z.enum(RULE_SEVERITIES),
  appliesTo: z.enum(RULE_APPLIES).default("all"),
  whenJson: z.string().min(2).max(4000),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100000).default(0),
});

export const createRuleSchema = playbookRuleSchema;

export const updateRuleSchema = playbookRuleSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: "at least one field to update" },
);

export type PlaybookRuleDto = {
  id: string;
  title: string;
  body: string;
  enabled: boolean;
  severity: RuleSeverity;
  appliesTo: RuleAppliesTo;
  whenJson: string;
  /** parsed whenJson when valid; null when unparseable/unknown (rule ignored by evaluator) */
  when: WhenCondition | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export function parseWhen(whenJson: string): WhenCondition | null {
  try {
    const parsed: unknown = JSON.parse(whenJson);
    const result = whenConditionSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function toRuleDto(row: {
  id: string; title: string; body: string; enabled: boolean;
  severity: string; appliesTo: string; whenJson: string;
  sortOrder: number; createdAt: Date; updatedAt: Date;
}): PlaybookRuleDto {
  const severity: RuleSeverity = severityOf(row.severity);
  const appliesTo: RuleAppliesTo = appliesOf(row.appliesTo);
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    enabled: row.enabled,
    severity,
    appliesTo,
    whenJson: row.whenJson,
    when: parseWhen(row.whenJson),
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function severityOf(v: string): RuleSeverity {
  if (v === "downgrade" || v === "confluence" || v === "info") return v;
  return "block"; // unknown legacy values stay the strictest severity
}

function appliesOf(v: string): RuleAppliesTo {
  if (v === "long" || v === "short") return v;
  return "all";
}
