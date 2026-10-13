// Playbook self-check: seeded-condition fixtures → evaluateSetups.
// Run: npx tsx src/scripts/playbook-check.ts (no network, no keys).

import { detectSmc } from "@/lib/smc/detect";
import { rankSetups } from "@/lib/smc/setups";
import { buildDownImpulseFixture, buildUpImpulseFixture } from "@/lib/smc/fixtures";
import { evaluateSetups } from "@/lib/playbook/evaluate";
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
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...over,
  } as PlaybookRuleDto;
}

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
// stamped exactly over its entry zone — rule 1 must reject it.
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
const rejected = evaluateSetups({
  setups: ranked.setups, smc: overlappedSmc, alignment: ranked.alignment,
  nextEvent: null, bias: "bearish", rules: [blockRule],
});
check("rule 1 rejects A-short overlapping demand OB", rejected[0]?.finalGrade === "rejected" &&
  rejected[0]?.fired.some((f) => f.ruleId === "seed-1"),
  rejected[0]?.finalGrade ?? "no setup");

// Natural fixture has no demand OBs, so rule 1 stays quiet — wiring visible,
// no faked rejection.
const demandOverlap = downSmc.orderBlocks.some((o) => o.kind === "demand" && !o.mitigated &&
  Math.max(ranked.setups[0]?.entryZone.low ?? 0, o.low) <= Math.min(ranked.setups[0]?.entryZone.high ?? 0, o.high));
const quietNatural = evaluateSetups({
  setups: ranked.setups, smc: downSmc, alignment: ranked.alignment,
  nextEvent: null, bias: "bearish", rules: [blockRule],
});
check("rule 1 quiet without overlap", !demandOverlap &&
  quietNatural[0]?.finalGrade === "A" && quietNatural[0]?.fired.length === 0);

// Downgrade: A + not ALIGNED → B.
const upSmc = detectSmc("EURUSD", "H1", buildUpImpulseFixture());
const upRanked = rankSetups(upSmc, { bias: "bullish", confidence: 70 });
const capRule = rule({
  id: "seed-3", title: "Cap non-aligned setups at B", severity: "downgrade", appliesTo: "all",
  whenJson: JSON.stringify({ kind: "not_aligned" }),
  when: { kind: "not_aligned" },
  sortOrder: 30,
});
const down2 = evaluateSetups({
  setups: upRanked.setups, smc: upSmc, alignment: "MIXED",
  nextEvent: null, bias: "mixed", rules: [capRule],
});
check("downgrade A→B when not aligned", down2.length === 0 ||
  down2[0]?.finalGrade === "B" && down2[0]?.fired.length === 1,
  JSON.stringify(down2.map((s) => s.finalGrade)));

// Block on B → rejected.
const blocked2 = evaluateSetups({
  setups: upRanked.setups, smc: upSmc, alignment: "MIXED",
  nextEvent: null, bias: "mixed", rules: [blockRule],
});
if (upRanked.setups.length > 0 && upRanked.setups[0].grade === "B") {
  const overlapB = upSmc.orderBlocks.some((o) => o.kind === "demand" && !o.mitigated &&
    Math.max(upRanked.setups[0].entryZone.low, o.low) <= Math.min(upRanked.setups[0].entryZone.high, o.high));
  check("block fires on B only with overlap", overlapB
    ? blocked2[0]?.finalGrade === "rejected"
    : blocked2[0]?.finalGrade === "B");
}

// Unknown kind + disabled rules never fire, never crash.
const weird = rule({ id: "weird", title: "Weird", whenJson: "{\"kind\":\"nope\"}", when: null });
const off = rule({
  id: "off", title: "Off", enabled: false,
  whenJson: JSON.stringify({ kind: "not_aligned" }), when: { kind: "not_aligned" },
});
const quiet = evaluateSetups({
  setups: upRanked.setups, smc: upSmc, alignment: "MIXED",
  nextEvent: null, bias: "mixed", rules: [weird, off],
});
check("unknown/disabled ignored", quiet.every((s) => s.fired.length === 0 && s.finalGrade === s.originalGrade));

// appliesTo mismatch: long-only rule never touches a short.
const longOnly = rule({
  id: "long-only", title: "Long only", appliesTo: "long",
  whenJson: JSON.stringify({ kind: "not_aligned" }), when: { kind: "not_aligned" },
});
const untouched = evaluateSetups({
  setups: ranked.setups, smc: downSmc, alignment: "MIXED",
  nextEvent: null, bias: "mixed", rules: [longOnly],
});
check("appliesTo respected", untouched.every((s) => s.fired.length === 0));

// Event window: far-future mock event does not fire.
const farEvent = evaluateSetups({
  setups: ranked.setups, smc: downSmc, alignment: ranked.alignment,
  nextEvent: { impact: "high", scheduledAt: "2030-01-01T00:00:00.000Z" },
  bias: "bearish",
  rules: [rule({
    id: "seed-4", title: "No A into news", severity: "block", appliesTo: "all",
    whenJson: JSON.stringify({ kind: "event_window", minutes: 30 }),
    when: { kind: "event_window", minutes: 30 },
    sortOrder: 40,
  })],
});
check("far event ignored", farEvent.every((s) => s.fired.length === 0));

if (failures > 0) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("playbook-check: all green");
