import type { Alignment, Setup, SetupSide, SmcSnapshot } from "@/lib/smc/types";
import type { BiasDir } from "@/lib/data/fundamental/score-types";
import { MISMATCH_NOTE } from "@/lib/smc/setups";
import type { PlaybookRuleDto } from "./rules";

// Playbook v2: ONE pure evaluation from the existing Phase 2/3 views
// (SmcSnapshot, Alignment, BiasDir, stored calendar events) plus the written
// rules. No database, no wall clock (`now` is passed in), no LLM, and it never
// invents a price — every level comes from the caller's proposal or from
// detected SMC prices. Replaces the Phase 4a evaluateSetups list. The journal
// stamps playbookVersion 2 from this function at save time and never re-scores.

export const PLAYBOOK_VERSION = 2;

export type Verdict = "allow" | "downgrade" | "block" | "no_setup";

/** A/B from the Phase 3 ranking; C is the v2 floor after downgrades or a block. */
export type PlaybookGrade = "A" | "B" | "C";

export type PlaybookRuleSeverity = "block" | "downgrade" | "confluence" | "info";

export type PlaybookRuleOutcome = {
  id: string;
  severity: PlaybookRuleSeverity;
  message: string;
};

export type PlaybookLevels = {
  entry: number;
  invalidation: number;
  target: number;
  plannedR: number;
};

export type PlaybookResult = {
  playbookVersion: 2;
  verdict: Verdict;
  grade: PlaybookGrade | null;
  direction: SetupSide | null;
  rules: PlaybookRuleOutcome[];
  levels: PlaybookLevels | null;
};

/** Fixed side + prices under test (journal logging). An analysis record, not a fill. */
export type PlaybookProposal = {
  direction: SetupSide;
  entry: number;
  invalidation: number;
  target: number;
};

export type PlaybookInput = {
  /** Candidates from rankSetups (Phase 3). Empty → no_setup unless a proposal is given. */
  setups: Setup[];
  smc: SmcSnapshot;
  alignment: Alignment;
  /** Minimal Phase 2 view: next stored calendar event for the event_window rule. */
  nextEvent: { impact: string; scheduledAt: string } | null;
  bias: BiasDir | null;
  rules: PlaybookRuleDto[];
  /** Epoch milliseconds — the ONLY clock in the evaluator. Callers pass Date.now(). */
  now: number;
  /** When present, this side/levels is evaluated instead of the ranked candidate. */
  proposal?: PlaybookProposal;
};

type Candidate = {
  side: SetupSide;
  grade: PlaybookGrade;
  entryZone: { low: number; high: number };
  invalidation: number;
  /** numeric target when the caller fixed one (proposal); otherwise derived from SMC */
  fixedTarget: number | null;
};

function sideMatches(rule: PlaybookRuleDto, side: SetupSide): boolean {
  return rule.appliesTo === "all" || rule.appliesTo === side;
}

function zonesOverlap(aLow: number, aHigh: number, bLow: number, bHigh: number): boolean {
  return Math.max(aLow, bLow) <= Math.min(aHigh, bHigh);
}

/** Same 2dp rule as the journal's roundR — kept local to avoid a playbook→journal import cycle. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Prefer the higher grade; first wins ties (rankSetups returns 0–1 setups in practice). */
function pickBest(setups: Setup[]): Setup | null {
  let best: Setup | null = null;
  for (const s of setups) {
    if (!best || (best.grade === "B" && s.grade === "A")) best = s;
  }
  return best;
}

/**
 * Detected target beyond entry: range edge → resting liquidity → swing
 * extreme. Strictly filtered to the profitable side so plannedR stays
 * positive; returns null rather than inventing a price.
 */
function detectedTarget(smc: SmcSnapshot, side: SetupSide, entry: number): number | null {
  if (side === "long") {
    if (smc.range && smc.range.high > entry) return smc.range.high;
    const pool = smc.liquidity.filter((l) => (l.side === "eqh" || l.side === "highs") && l.price > entry);
    if (pool.length > 0) return pool[0].price; // liquidity sorts newest-first
    const highs = smc.swings.filter((s) => s.type === "high" && s.price > entry);
    if (highs.length > 0) return highs[highs.length - 1].price;
    return null;
  }
  if (smc.range && smc.range.low < entry) return smc.range.low;
  const pool = smc.liquidity.filter((l) => (l.side === "eql" || l.side === "lows") && l.price < entry);
  if (pool.length > 0) return pool[0].price;
  const lows = smc.swings.filter((s) => s.type === "low" && s.price < entry);
  if (lows.length > 0) return lows[lows.length - 1].price;
  return null;
}

type FireResult = { fired: boolean; note: string };

/** The four written conditions (whenJson kinds) — `now` replaces v1's Date.now() read. */
function checkRule(
  when: NonNullable<PlaybookRuleDto["when"]>,
  side: SetupSide,
  entryZone: { low: number; high: number },
  smc: SmcSnapshot,
  alignment: Alignment,
  nextEvent: PlaybookInput["nextEvent"],
  now: number,
): FireResult {
  switch (when.kind) {
    case "ob_overlap": {
      const obs = smc.orderBlocks.filter((o) => o.kind === when.obKind && !o.mitigated);
      const hit = obs.find((o) => zonesOverlap(entryZone.low, entryZone.high, o.low, o.high));
      if (!hit) return { fired: false, note: "" };
      return {
        fired: true,
        note: `entry ${entryZone.low}–${entryZone.high} overlaps unmitigated ${when.obKind} OB ${hit.low}–${hit.high}`,
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
      // Fire only when the event is upcoming within the window relative to the
      // PASSED-IN now — never for past events and never invented ones (stored
      // calendar time only).
      if (at > now && at - now <= when.minutes * 60 * 1000) {
        return { fired: true, note: `high-impact event within ${when.minutes}m (${nextEvent.scheduledAt})` };
      }
      return { fired: false, note: "" };
    }
    case "premium_discount": {
      if (!smc.range) return { fired: false, note: "" };
      const entryMid = (entryZone.low + entryZone.high) / 2;
      if (side === "long" && entryMid > smc.range.midpoint) {
        return { fired: true, note: `long entry midpoint ${entryMid} above range midpoint ${smc.range.midpoint} (premium)` };
      }
      if (side === "short" && entryMid < smc.range.midpoint) {
        return { fired: true, note: `short entry midpoint ${entryMid} below range midpoint ${smc.range.midpoint} (discount)` };
      }
      return { fired: false, note: "" };
    }
  }
}

/**
 * Evaluate the ONE candidate against every enabled, side-matching rule
 * (callers pass rules pre-sorted). block → verdict "block" + grade C; each
 * downgrade steps the grade once (A→B→C, floor C); no candidate → "no_setup".
 * confluence/info outcomes are recorded context only — the playbook only ever
 * constrains, it never inflates a grade.
 */
export function evaluatePlaybook(input: PlaybookInput): PlaybookResult {
  const { setups, smc, alignment, nextEvent, bias, rules, now, proposal } = input;

  // --- Candidate (fixed proposal, else the best ranked setup) -----------------
  let candidate: Candidate | null;
  if (proposal) {
    const matched = setups.find((s) => s.side === proposal.direction) ?? null;
    candidate = {
      side: proposal.direction,
      grade: matched ? matched.grade : "B",
      entryZone: { low: proposal.entry, high: proposal.entry },
      invalidation: proposal.invalidation,
      fixedTarget: proposal.target,
    };
  } else {
    const best = pickBest(setups);
    candidate = best
      ? { side: best.side, grade: best.grade, entryZone: best.entryZone, invalidation: best.invalidation, fixedTarget: null }
      : null;
  }

  if (!candidate) {
    return {
      playbookVersion: 2,
      verdict: "no_setup",
      grade: null,
      direction: null,
      rules: [
        {
          id: "core.no_setup",
          severity: "info",
          message: "No setup — SMC structure and fundamental bias give no candidate here.",
        },
      ],
      levels: null,
    };
  }

  // --- Written rules (stored whenJson conditions only) ------------------------
  const out: PlaybookRuleOutcome[] = [];
  let blocked = false;
  let downgrades = 0;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!sideMatches(rule, candidate.side)) continue;
    if (rule.when === null) continue; // unknown/unparseable kind: ignore, never crash
    const { fired, note } = checkRule(rule.when, candidate.side, candidate.entryZone, smc, alignment, nextEvent, now);
    if (!fired) continue;
    out.push({ id: rule.id, severity: rule.severity, message: `${rule.title} — ${note}` });
    if (rule.severity === "block") blocked = true;
    else if (rule.severity === "downgrade") downgrades += 1;
  }

  // --- Grade + verdict --------------------------------------------------------
  let grade: PlaybookGrade = candidate.grade;
  for (let i = 0; i < downgrades && grade !== "C"; i++) grade = grade === "A" ? "B" : "C";
  const verdict: Verdict = blocked ? "block" : downgrades > 0 ? "downgrade" : "allow";
  if (blocked) grade = "C";

  // --- Core context (info only — labels from the SAME bias/SMC views) ---------
  const fundDir = bias === "bullish" || bias === "bearish" ? bias : null;
  out.push({
    id: "core.bias",
    severity: "info",
    message: bias ? `Fundamentals: ${bias}` : "Fundamentals: no bias snapshot yet",
  });
  if (smc.htfBias !== "range" && fundDir !== null && smc.htfBias !== fundDir) {
    out.push({ id: "core.mismatch", severity: "info", message: MISMATCH_NOTE });
  }
  if (proposal && !setups.some((s) => s.side === proposal.direction)) {
    out.push({
      id: "core.manual",
      severity: "info",
      message: "No ranked setup on this side — logged as a manual idea (grade floor B).",
    });
  }

  // --- Levels: caller-fixed prices or detected SMC prices only ----------------
  const entry = (candidate.entryZone.low + candidate.entryZone.high) / 2;
  const target = candidate.fixedTarget ?? detectedTarget(smc, candidate.side, entry);
  const risk = Math.abs(entry - candidate.invalidation);
  let levels: PlaybookLevels | null = null;
  if (target !== null && risk > 0) {
    levels = {
      entry,
      invalidation: candidate.invalidation,
      target,
      plannedR: round2(Math.abs(target - entry) / risk),
    };
  } else {
    out.push({
      id: "core.levels",
      severity: "info",
      message:
        target === null
          ? "No detected target beyond entry — levels withheld."
          : "Entry and invalidation are the same price — nothing to size.",
    });
  }

  return { playbookVersion: 2, verdict, grade, direction: candidate.side, rules: out, levels };
}
