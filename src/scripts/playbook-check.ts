// Playbook v2 self-check: fixtures → evaluatePlaybook.
// Run: npx tsx src/scripts/playbook-check.ts (no network, no keys, no wall
// clock — every call passes `now` explicitly, so the event-window checks are
// deterministic no matter when they run).

import { detectSmc } from "@/lib/smc/detect";
import { rankSetups } from "@/lib/smc/setups";
import { buildDownImpulseFixture, buildUpImpulseFixture } from "@/lib/smc/fixtures";
import { evaluatePlaybook } from "@/lib/playbook/evaluate";
import type { PlaybookRuleDto } from "@/lib/playbook/rules";

let failures = 0;

function check(name: string, cond: boolean, detail: string = ""): void {
  if (cond) console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  else { console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); failures++; }
}

function rule(over: Partial<PlaybookRuleDto> & { id: string }): PlaybookRuleDto {
  return {
    title: over.id, body: "", enabled: true, severity: "block", appliesTo: "all",
    whenJson: "{}", when: null, sortOrder: 0,
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    ...over,
  } as PlaybookRuleDto;
}

/** Fixed clock: every evaluatePlaybook call below receives this, never Date.now(). */
const NOW = Date.UTC(2026, 0, 10, 12, 0, 0);

// Acceptance fixture: aligned A-short whose entry overlaps a demand OB.
const downSmc = detectSmc("EURUSD", "H1", buildDownImpulseFixture());
const ranked = rankSetups(downSmc, { bias: "bearish", confidence: 70 });
check("fixture: aligned A-short exists", ranked.setups.length === 1 && ranked.setups[0].grade === "A" &&
  ranked.setups[0].side === "short",
JSON.stringify(ranked.setups.map((s) => `${s.grade}-${s.side} ${s.entryZone.low}-${s.entryZone.high}`)));

const blockRule = rule({
  id: "seed-1", title: "Do not short into demand", severity: "block", appliesTo: "short",
  whenJson: JSON.stringify({ kind: "ob_overlap", obKind: "demand" }),
  when: { kind: "ob_overlap", obKind: "demand" },
  sortOrder: 10,
});

// Synthetic overlap case: same A-short, but with an unmitigated demand OB
// stamped exactly over its entry zone — the block rule must fire.
const overlappedSmc = {
  ...downSmc,
  orderBlocks: [
    ...downSmc.orderBlocks,
    {
      index: 0, time: downSmc.orderBlocks[0]?.time ?? "", epoch: downSmc.orderBlocks[0]?.epoch ?? 0,
      low: ranked.setups[0].entryZone.low, high: ranked.setups[0].entryZone.high,
      direction: "bullish" as const, kind: "demand" as const, mitigated: false,
    },
  ],
};
const blocked = evaluatePlaybook({
  setups: ranked.setups, smc: overlappedSmc, alignment: ranked.alignment,
  nextEvent: null, bias: "bearish", rules: [blockRule], now: NOW,
});
check("block: verdict block + grade C + rule listed", blocked.verdict === "block" &&
  blocked.grade === "C" && blocked.direction === "short" &&
  blocked.rules.some((r) => r.id === "seed-1" && r.severity === "block"), blocked.verdict);
check("block: playbookVersion 2 stamped", blocked.playbookVersion === 2);

// Natural fixture has no demand OB over the entry, so the rule stays quiet.
const quietNatural = evaluatePlaybook({
  setups: ranked.setups, smc: downSmc, alignment: ranked.alignment,
  nextEvent: null, bias: "bearish", rules: [blockRule], now: NOW,
});
check("no rule → allow + grade A", quietNatural.verdict === "allow" && quietNatural.grade === "A" &&
  !quietNatural.rules.some((r) => r.id === "seed-1"));
check("levels: numeric entry/invalidation + plannedR", quietNatural.levels !== null &&
  quietNatural.levels.entry === (ranked.setups[0].entryZone.low + ranked.setups[0].entryZone.high) / 2 &&
  quietNatural.levels.invalidation === ranked.setups[0].invalidation &&
  quietNatural.levels.plannedR > 0);

// Downgrade: A + not ALIGNED → B.
const upSmc = detectSmc("EURUSD", "H1", buildUpImpulseFixture());
const upRanked = rankSetups(upSmc, { bias: "bullish", confidence: 70 });
const capRule = rule({
  id: "seed-3", title: "Cap non-aligned setups at B", severity: "downgrade", appliesTo: "all",
  whenJson: JSON.stringify({ kind: "not_aligned" }), when: { kind: "not_aligned" },
  sortOrder: 30,
});
const down = evaluatePlaybook({
  setups: upRanked.setups, smc: upSmc, alignment: "MIXED",
  nextEvent: null, bias: "mixed", rules: [capRule], now: NOW,
});
check("downgrade A→B", down.verdict === "downgrade" && down.grade === "B", `${down.verdict}/${down.grade}`);

// Two downgrades on an A → C (v2 steps once per rule, floor C).
const twice = evaluatePlaybook({
  setups: upRanked.setups, smc: upSmc, alignment: "MIXED",
  nextEvent: null, bias: "mixed",
  rules: [capRule, rule({ ...capRule, id: "seed-3b" })],
  now: NOW,
});
check("two downgrades step A→B→C", twice.verdict === "downgrade" && twice.grade === "C",
  `${twice.verdict}/${twice.grade}`);

// Unknown kind + disabled rules never fire, never crash.
const weird = rule({ id: "weird", title: "Weird", whenJson: "{\"kind\":\"nope\"}", when: null });
const off = rule({
  id: "off", title: "Off", enabled: false,
  whenJson: JSON.stringify({ kind: "not_aligned" }), when: { kind: "not_aligned" },
});
const quiet = evaluatePlaybook({
  setups: upRanked.setups, smc: upSmc, alignment: "MIXED",
  nextEvent: null, bias: "mixed", rules: [weird, off], now: NOW,
});
check("unknown/disabled ignored", quiet.verdict === "allow" && quiet.grade === upRanked.setups[0]?.grade);

// appliesTo mismatch: long-only rule never touches a short.
const longOnly = rule({
  id: "long-only", title: "Long only", appliesTo: "long",
  whenJson: JSON.stringify({ kind: "not_aligned" }), when: { kind: "not_aligned" },
});
const untouched = evaluatePlaybook({
  setups: ranked.setups, smc: downSmc, alignment: "MIXED",
  nextEvent: null, bias: "mixed", rules: [longOnly], now: NOW,
});
check("appliesTo respected", untouched.verdict === "allow" &&
  !untouched.rules.some((r) => r.id === "long-only"));

// Event window: relative to the PASSED-IN now — wall-clock free, deterministic.
const eventRule = rule({
  id: "seed-4", title: "No entries into high-impact news", severity: "block", appliesTo: "all",
  whenJson: JSON.stringify({ kind: "event_window", minutes: 30 }),
  when: { kind: "event_window", minutes: 30 },
  sortOrder: 40,
});
const eventBase = {
  setups: ranked.setups, smc: downSmc, alignment: ranked.alignment,
  bias: "bearish" as const, now: NOW,
};
const inWindow = evaluatePlaybook({
  ...eventBase,
  nextEvent: { impact: "high", scheduledAt: new Date(NOW + 10 * 60 * 1000).toISOString() },
  rules: [eventRule],
});
check("event within window of passed now → block", inWindow.verdict === "block", inWindow.verdict);
const far = evaluatePlaybook({
  ...eventBase,
  nextEvent: { impact: "high", scheduledAt: new Date(NOW + 2 * 60 * 60 * 1000).toISOString() },
  rules: [eventRule],
});
check("event beyond window → allow", far.verdict === "allow", far.verdict);
const past = evaluatePlaybook({
  ...eventBase,
  nextEvent: { impact: "high", scheduledAt: new Date(NOW - 5 * 60 * 1000).toISOString() },
  rules: [eventRule],
});
check("past event never fires", past.verdict === "allow", past.verdict);

// No candidate → no_setup with a single info outcome.
const none = evaluatePlaybook({
  setups: [], smc: downSmc, alignment: "DO_NOT_TRADE", nextEvent: null, bias: null,
  rules: [blockRule], now: NOW,
});
check("no candidate → no_setup", none.verdict === "no_setup" && none.grade === null &&
  none.direction === null && none.levels === null &&
  none.rules.some((r) => r.id === "core.no_setup" && r.severity === "info"));

// confluence / info severities are recorded but never move the verdict.
const conf = evaluatePlaybook({
  setups: ranked.setups, smc: downSmc, alignment: "MIXED", nextEvent: null, bias: "bearish",
  rules: [rule({
    id: "seed-6", title: "Confirming note", severity: "confluence",
    whenJson: JSON.stringify({ kind: "not_aligned" }), when: { kind: "not_aligned" },
  })],
  now: NOW,
});
check("confluence recorded, verdict allow", conf.verdict === "allow" && conf.grade === "A" &&
  conf.rules.some((r) => r.id === "seed-6" && r.severity === "confluence"));
const info = evaluatePlaybook({
  setups: ranked.setups, smc: downSmc, alignment: "MIXED", nextEvent: null, bias: "bearish",
  rules: [rule({
    id: "seed-7", title: "Context note", severity: "info",
    whenJson: JSON.stringify({ kind: "not_aligned" }), when: { kind: "not_aligned" },
  })],
  now: NOW,
});
check("info recorded, verdict allow", info.verdict === "allow" &&
  info.rules.some((r) => r.id === "seed-7" && r.severity === "info"));

// Proposal path (journal): fixed prices echo back with plannedR math.
const proposal = evaluatePlaybook({
  setups: ranked.setups, smc: downSmc, alignment: ranked.alignment, nextEvent: null,
  bias: "bearish", rules: [], now: NOW,
  proposal: { direction: "short", entry: 1.1, invalidation: 1.12, target: 1.06 },
});
check("proposal: levels echo + plannedR = 2", proposal.verdict === "allow" && proposal.grade === "A" &&
  proposal.levels !== null && proposal.levels.entry === 1.1 &&
  proposal.levels.invalidation === 1.12 && proposal.levels.target === 1.06 &&
  proposal.levels.plannedR === 2, JSON.stringify(proposal.levels));

// Proposal on the unranked side → grade floor B + core.manual context note.
const manual = evaluatePlaybook({
  setups: ranked.setups, smc: downSmc, alignment: ranked.alignment, nextEvent: null,
  bias: "bearish", rules: [], now: NOW,
  proposal: { direction: "long", entry: 1.1, invalidation: 1.08, target: 1.14 },
});
check("proposal unranked side → grade B + manual note", manual.grade === "B" &&
  manual.rules.some((r) => r.id === "core.manual"));

if (failures > 0) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("playbook-check: all green");
