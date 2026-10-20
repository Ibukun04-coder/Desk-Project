import { describe, it } from "node:test";
import { strict as assertStrict } from "node:assert";
import { detectSmc } from "@/lib/smc/detect";
import { rankSetups } from "@/lib/smc/setups";
import {
  buildDownImpulseFixture,
  buildUpImpulseFixture,
} from "@/lib/smc/fixtures";
import { evaluatePlaybook } from "@/lib/playbook/evaluate";
import type { PlaybookRuleDto } from "@/lib/playbook/rules";

const NOW = Date.UTC(2026, 0, 10, 12, 0, 0);

const downSmc = detectSmc("EURUSD", "H1", buildDownImpulseFixture());
const upSmc = detectSmc("EURUSD", "H1", buildUpImpulseFixture());
const downRanked = rankSetups(downSmc, { bias: "bearish", confidence: 70 });
const upRanked = rankSetups(upSmc, { bias: "bullish", confidence: 70 });

const shortSetup = downRanked.setups[0];

function rule(over: Partial<PlaybookRuleDto> & { id: string }): PlaybookRuleDto {
  return {
    title: over.id,
    body: "",
    enabled: true,
    severity: "block",
    appliesTo: "all",
    whenJson: "{}",
    when: null,
    sortOrder: 0,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...over,
  } as PlaybookRuleDto;
}

function baseInput(over: {
  setups?: typeof downRanked.setups;
  smc?: typeof downSmc;
  alignment?: (typeof downRanked)["alignment"];
  nextEvent?: { impact: string; scheduledAt: string } | null;
  bias?: "bearish" | "bullish" | null;
  rules?: PlaybookRuleDto[];
  now?: number;
  proposal?: Parameters<typeof evaluatePlaybook>[0]["proposal"];
}) {
  return {
    setups: over.setups ?? downRanked.setups,
    smc: over.smc ?? downSmc,
    alignment: over.alignment ?? downRanked.alignment,
    nextEvent: over.nextEvent ?? null,
    bias: over.bias ?? null,
    rules: over.rules ?? [],
    now: over.now ?? NOW,
    proposal: over.proposal,
  };
}

describe("evaluatePlaybook (v2)", () => {
  it("1. fixture sanity: down impulse yields one aligned A-short", () => {
    assertStrict.equal(downRanked.setups.length, 1);
    assertStrict.equal(downRanked.setups[0].grade, "A");
    assertStrict.equal(downRanked.setups[0].side, "short");
    assertStrict.equal(downRanked.alignment, "ALIGNED");
  });

  it("2. block via ob_overlap demand over short entry -> block, grade C", () => {
    const overlapped = {
      ...downSmc,
      orderBlocks: [
        ...downSmc.orderBlocks,
        {
          index: 0,
          time: "",
          epoch: 0,
          low: shortSetup.entryZone.low,
          high: shortSetup.entryZone.high,
          direction: "bullish" as const,
          kind: "demand" as const,
          mitigated: false,
        },
      ],
    };
    const res = evaluatePlaybook(
      baseInput({
        smc: overlapped,
        rules: [
          rule({
            id: "seed-1",
            severity: "block",
            appliesTo: "short",
            whenJson: JSON.stringify({ kind: "ob_overlap", obKind: "demand" }),
            when: { kind: "ob_overlap", obKind: "demand" },
            sortOrder: 10,
          }),
        ],
      }),
    );
    assertStrict.equal(res.verdict, "block");
    assertStrict.equal(res.grade, "C");
    assertStrict.equal(res.direction, "short");
    assertStrict.ok(
      res.rules.some((r) => r.id === "seed-1" && r.severity === "block"),
      "block rule listed",
    );
    assertStrict.equal(res.playbookVersion, 2);
  });

  it("3. block still returns levels and all fired rules", () => {
    const overlapped = {
      ...downSmc,
      orderBlocks: [
        ...downSmc.orderBlocks,
        {
          index: 0,
          time: "",
          epoch: 0,
          low: shortSetup.entryZone.low,
          high: shortSetup.entryZone.high,
          direction: "bullish" as const,
          kind: "demand" as const,
          mitigated: false,
        },
      ],
    };
    const res = evaluatePlaybook(
      baseInput({
        smc: overlapped,
        rules: [
          rule({
            id: "seed-1",
            severity: "block",
            appliesTo: "short",
            whenJson: JSON.stringify({ kind: "ob_overlap", obKind: "demand" }),
            when: { kind: "ob_overlap", obKind: "demand" },
          }),
        ],
      }),
    );
    assertStrict.equal(res.verdict, "block");
    assertStrict.ok(res.levels !== null, "levels returned on block");
    assertStrict.equal(
      res.levels!.entry,
      shortSetup.entryZone.low / 2 + shortSetup.entryZone.high / 2,
    );
  });

  it("4. natural fixture with no rules -> allow, grade A", () => {
    const res = evaluatePlaybook(
      baseInput({ nextEvent: null, bias: "bearish", rules: [] }),
    );
    assertStrict.equal(res.verdict, "allow");
    assertStrict.equal(res.grade, "A");
    assertStrict.equal(res.direction, "short");
    assertStrict.ok(
      !res.rules.some(
        (r) => r.severity === "block" || r.severity === "downgrade",
      ),
    );
  });

  it("5. levels are numeric: entry / invalidation / target / plannedR", () => {
    const res = evaluatePlaybook(
      baseInput({ nextEvent: null, bias: "bearish", rules: [] }),
    );
    assertStrict.ok(res.levels !== null);
    const l = res.levels!;
    const expectedEntry = (shortSetup.entryZone.low + shortSetup.entryZone.high) / 2;
    assertStrict.equal(l.entry, expectedEntry);
    assertStrict.equal(l.invalidation, shortSetup.invalidation);
    assertStrict.ok(l.target !== null);
    assertStrict.ok(l.plannedR > 0);
  });

  it("6. high-impact event within window of passed now -> block", () => {
    const res = evaluatePlaybook(
      baseInput({
        nextEvent: {
          impact: "high",
          scheduledAt: new Date(NOW + 10 * 60 * 1000).toISOString(),
        },
        now: NOW,
        rules: [
          rule({
            id: "ev",
            severity: "block",
            whenJson: JSON.stringify({ kind: "event_window", minutes: 30 }),
            when: { kind: "event_window", minutes: 30 },
          }),
        ],
      }),
    );
    assertStrict.equal(res.verdict, "block");
  });

  it("7. high-impact event beyond window -> allow", () => {
    const res = evaluatePlaybook(
      baseInput({
        nextEvent: {
          impact: "high",
          scheduledAt: new Date(NOW + 2 * 60 * 60 * 1000).toISOString(),
        },
        now: NOW,
        rules: [
          rule({
            id: "ev",
            severity: "block",
            whenJson: JSON.stringify({ kind: "event_window", minutes: 30 }),
            when: { kind: "event_window", minutes: 30 },
          }),
        ],
      }),
    );
    assertStrict.equal(res.verdict, "allow");
  });

  it("8. past high-impact event never fires -> allow", () => {
    const res = evaluatePlaybook(
      baseInput({
        nextEvent: {
          impact: "high",
          scheduledAt: new Date(NOW - 5 * 60 * 1000).toISOString(),
        },
        now: NOW,
        rules: [
          rule({
            id: "ev",
            severity: "block",
            whenJson: JSON.stringify({ kind: "event_window", minutes: 30 }),
            when: { kind: "event_window", minutes: 30 },
          }),
        ],
      }),
    );
    assertStrict.equal(res.verdict, "allow");
  });

  it("9. no candidate -> no_setup, grade null, direction null, levels null", () => {
    const res = evaluatePlaybook(
      baseInput({
        setups: [],
        alignment: "DO_NOT_TRADE",
        nextEvent: null,
        bias: null,
        rules: [],
      }),
    );
    assertStrict.equal(res.verdict, "no_setup");
    assertStrict.equal(res.grade, null);
    assertStrict.equal(res.direction, null);
    assertStrict.equal(res.levels, null);
    assertStrict.ok(
      res.rules.some((r) => r.id === "core.no_setup" && r.severity === "info"),
    );
  });

  it("10. confluence rule recorded, verdict and grade unchanged", () => {
    const res = evaluatePlaybook(
      baseInput({
        alignment: "MIXED",
        bias: "bearish",
        rules: [
          rule({
            id: "cf-1",
            severity: "confluence",
            whenJson: JSON.stringify({ kind: "not_aligned" }),
            when: { kind: "not_aligned" },
          }),
        ],
      }),
    );
    assertStrict.equal(res.verdict, "allow");
    assertStrict.equal(res.grade, "A");
    assertStrict.ok(
      res.rules.some((r) => r.id === "cf-1" && r.severity === "confluence"),
    );
  });

  it("11. info rule recorded, verdict and grade unchanged", () => {
    const res = evaluatePlaybook(
      baseInput({
        alignment: "MIXED",
        bias: "bearish",
        rules: [
          rule({
            id: "inf-1",
            severity: "info",
            whenJson: JSON.stringify({ kind: "not_aligned" }),
            when: { kind: "not_aligned" },
          }),
        ],
      }),
    );
    assertStrict.equal(res.verdict, "allow");
    assertStrict.ok(
      res.rules.some((r) => r.id === "inf-1" && r.severity === "info"),
    );
  });

  it("12. proposal path echoes fixed levels with plannedR math", () => {
    const res = evaluatePlaybook(
      baseInput({
        bias: "bearish",
        rules: [],
        proposal: {
          direction: "short",
          entry: 1.1,
          invalidation: 1.12,
          target: 1.06,
        },
      }),
    );
    assertStrict.equal(res.verdict, "allow");
    assertStrict.equal(res.grade, "A");
    assertStrict.ok(res.levels !== null);
    assertStrict.equal(res.levels!.entry, 1.1);
    assertStrict.equal(res.levels!.invalidation, 1.12);
    assertStrict.equal(res.levels!.target, 1.06);
    assertStrict.equal(res.levels!.plannedR, 2);
  });

  it("13. proposal on unranked side -> grade B + core.manual note", () => {
    const res = evaluatePlaybook(
      baseInput({
        bias: "bearish",
        rules: [],
        proposal: {
          direction: "long",
          entry: 1.1,
          invalidation: 1.08,
          target: 1.14,
        },
      }),
    );
    assertStrict.equal(res.grade, "B");
    assertStrict.ok(res.rules.some((r) => r.id === "core.manual"));
  });

  it("14. one downgrade steps grade A -> B", () => {
    const res = evaluatePlaybook(
      baseInput({
        bias: "bearish",
        rules: [
          rule({
            id: "pd",
            severity: "downgrade",
            appliesTo: "short",
            whenJson: JSON.stringify({ kind: "premium_discount" }),
            when: { kind: "premium_discount" },
          }),
        ],
      }),
    );
    assertStrict.equal(res.verdict, "downgrade");
    assertStrict.equal(res.grade, "B");
  });

  it("15. two downgrades step grade A -> C (floor)", () => {
    const overlapped = {
      ...downSmc,
      orderBlocks: [
        ...downSmc.orderBlocks,
        {
          index: 0,
          time: "",
          epoch: 0,
          low: shortSetup.entryZone.low,
          high: shortSetup.entryZone.high,
          direction: "bullish" as const,
          kind: "demand" as const,
          mitigated: false,
        },
      ],
    };
    const res = evaluatePlaybook(
      baseInput({
        smc: overlapped,
        bias: "bearish",
        rules: [
          rule({
            id: "pd",
            severity: "downgrade",
            appliesTo: "short",
            whenJson: JSON.stringify({ kind: "premium_discount" }),
            when: { kind: "premium_discount" },
          }),
          rule({
            id: "ob",
            severity: "downgrade",
            appliesTo: "short",
            whenJson: JSON.stringify({ kind: "ob_overlap", obKind: "demand" }),
            when: { kind: "ob_overlap", obKind: "demand" },
          }),
        ],
      }),
    );
    assertStrict.equal(res.verdict, "downgrade");
    assertStrict.equal(res.grade, "C");
  });

  it("16. up impulse yields one aligned A-long -> allow, grade A", () => {
    const upRankedLocal = rankSetups(upSmc, {
      bias: "bullish",
      confidence: 70,
    });
    assertStrict.equal(upRankedLocal.setups.length, 1);
    assertStrict.equal(upRankedLocal.setups[0].grade, "A");
    assertStrict.equal(upRankedLocal.setups[0].side, "long");
    const res = evaluatePlaybook(
      baseInput({
        setups: upRankedLocal.setups,
        smc: upSmc,
        alignment: upRankedLocal.alignment,
        bias: "bullish",
        rules: [],
      }),
    );
    assertStrict.equal(res.verdict, "allow");
    assertStrict.equal(res.grade, "A");
    assertStrict.equal(res.direction, "long");
  });
});
