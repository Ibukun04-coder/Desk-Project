import type { Alignment, Setup, SetupSide, SmcSnapshot } from "@/lib/smc/types";
import type { BiasDir } from "@/lib/data/fundamental/score-types";
import type { PlaybookRuleDto } from "./rules";

// Phase 4a evaluator: written rules BLOCK or DOWNGRADE Phase 3 setups.
// Rules beat the model — a setup failing an enabled rule cannot stay grade A.
// Pure function; no I/O, no LLM, never invents prices or headlines.

export type EvaluatedGrade = "A" | "B" | "rejected";

export type FiredRule = {
  ruleId: string;
  title: string;
  severity: "block" | "downgrade";
  note: string;
};

export type EvaluatedSetup = Setup & {
  originalGrade: Setup["grade"];
  finalGrade: EvaluatedGrade;
  fired: FiredRule[];
};

export type EvaluateInput = {
  setups: Setup[];
  smc: SmcSnapshot;
  alignment: Alignment;
  /** minimal Phase 2 view: next high-impact event for the event_window rule */
  nextEvent: {
    impact: string;
    scheduledAt: string;
  } | null;
  bias: BiasDir | null;
  rules: PlaybookRuleDto[];
};

function sideMatches(rule: PlaybookRuleDto, side: SetupSide): boolean {
  return rule.appliesTo === "all" || rule.appliesTo === side;
}

function zonesOverlap(aLow: number, aHigh: number, bLow: number, bHigh: number): boolean {
  return Math.max(aLow, bLow) <= Math.min(aHigh, bHigh);
}

type FireResult = { fired: boolean; note: string };

function checkRule(
  rule: PlaybookRuleDto,
  setup: Setup,
  smc: SmcSnapshot,
  alignment: Alignment,
  nextEvent: EvaluateInput["nextEvent"],
): FireResult {
  const when = rule.when;
  if (!when) return { fired: false, note: "" };
  switch (when.kind) {
    case "ob_overlap": {
      const obs = smc.orderBlocks.filter((o) => o.kind === when.obKind && !o.mitigated);
      const hit = obs.find((o) =>
        zonesOverlap(setup.entryZone.low, setup.entryZone.high, o.low, o.high),
      );
      if (!hit) return { fired: false, note: "" };
      return {
        fired: true,
        note: `entry ${setup.entryZone.low}–${setup.entryZone.high} overlaps unmitigated ${when.obKind} OB ${hit.low}–${hit.high}`,
      };
    }
    case "not_aligned": {
      if (alignment === "ALIGNED") return { fired: false, note: "" };
      return { fired: true, note: `alignment is ${alignment}, not ALIGNED` };
    }
    case "event_window": {
      if (!nextEvent || nextEvent.impact !== "high") return { fired: false, note: "" };
      const at = new Date(nextEvent.scheduledAt).getTime();
      if (!Number.isFinite(at)) return { fired: false, note: "" };
      const now = Date.now();
      // Fire only when the event is upcoming within the window — never for
      // past events and never invented ones (stored calendar time only).
      if (at > now && at - now <= when.minutes * 60 * 1000) {
        return { fired: true, note: `high-impact event within ${when.minutes}m (${nextEvent.scheduledAt})` };
      }
      return { fired: false, note: "" };
    }
    case "premium_discount": {
      if (!smc.range) return { fired: false, note: "" };
      const entryMid = (setup.entryZone.low + setup.entryZone.high) / 2;
      if (setup.side === "long" && entryMid > smc.range.midpoint) {
        return { fired: true, note: `long entry midpoint ${entryMid} above range midpoint ${smc.range.midpoint} (premium)` };
      }
      if (setup.side === "short" && entryMid < smc.range.midpoint) {
        return { fired: true, note: `short entry midpoint ${entryMid} below range midpoint ${smc.range.midpoint} (discount)` };
      }
      return { fired: false, note: "" };
    }
  }
}

/**
 * Evaluate every setup against enabled, side-matching rules (sortOrder then
 * createdAt — callers pass them pre-sorted). block on A → "rejected";
 * downgrade on A → "B"; block on B → "rejected"; B otherwise stays B.
 */
export function evaluateSetups(input: EvaluateInput): EvaluatedSetup[] {
  const { setups, smc, alignment, nextEvent, rules } = input;
  return setups.map((setup) => {
    const fired: FiredRule[] = [];
    let blocked = false;
    let downgraded = false;
    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (!sideMatches(rule, setup.side)) continue;
      if (rule.when === null) continue; // unknown/unparseable kind: ignore, never crash
      const { fired: hit, note } = checkRule(rule, setup, smc, alignment, nextEvent);
      if (!hit) continue;
      fired.push({ ruleId: rule.id, title: rule.title, severity: rule.severity, note });
      if (rule.severity === "block") blocked = true;
      else downgraded = true;
    }
    const finalGrade: EvaluatedGrade = blocked ? "rejected" : setup.grade === "A" && downgraded ? "B" : setup.grade;
    const why =
      fired.length === 0
        ? [...setup.why, "No playbook rule fired"]
        : [
            ...setup.why,
            ...fired.map((f) => `${f.severity === "block" ? "Blocked" : "Downgraded"} by: ${f.title} — ${f.note}`),
          ];
    return { ...setup, originalGrade: setup.grade, finalGrade, fired, why };
  });
}
