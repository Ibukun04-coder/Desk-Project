// Playbook v2 self-check: fixtures → evaluatePlaybook.
// Run: npx tsx src/scripts/playbook-check.ts (no network, no keys, no wall
// clock — every call passes `now` explicitly, so the event-window checks are
// deterministic no matter when they run).

import { detectSmc } from "@/lib/smc/detect";
import { rankSetups } from "@/lib/smc/setups";
import { buildDownImpulseFixture } from "@/lib/smc/fixtures";
import { evaluatePlaybook } from "@/lib/playbook/evaluate";
import { derivePlaybookInput } from "@/lib/playbook/derive";
import type { BiasResult } from "@/lib/data/bias";

let failures = 0;

function check(name: string, cond: boolean, detail: string = ""): void {
  if (cond) console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  else { console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); failures++; }
}

const NOW = Date.UTC(2026, 0, 10, 12, 0, 0);

const downSmc = detectSmc("EURUSD", "H1", buildDownImpulseFixture());
const ranked = rankSetups(downSmc, { bias: "bearish", confidence: 70 });

const mockBias: BiasResult = {
  pair: "EURUSD", bias: "bearish", confidence: 70, drivers: [],
  nextEvent: null, invalidation: "", asOf: new Date(NOW),
  method: "rules-v1", usedLlm: false,
};

function baseInput(overrides: Partial<Parameters<typeof evaluatePlaybook>[0]>): Parameters<typeof evaluatePlaybook>[0] {
  const derived = derivePlaybookInput("EURUSD", "H1", buildDownImpulseFixture(), downSmc, mockBias, null, NOW);
  return { ...derived, ...overrides } as Parameters<typeof evaluatePlaybook>[0];
}

check(
  "fixture: aligned A-short exists",
  ranked.setups.length === 1 && ranked.setups[0].grade === "A" &&
    ranked.setups[0].side === "short",
  JSON.stringify(ranked.setups.map((s) => `${s.grade}-${s.side} ${s.entryZone.low}-${s.entryZone.high}`)),
);

check(
  "block PB-BLK-HTF: H4+D1 oppose → block, grade null",
  (() => {
    const res = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      lastBos: { H1: "long", H4: "short", D1: "short" },
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.10, swept: false }],
      dealingRange: { high: 1.095, low: 1.085, bothExtremesSwept: false },
      lastBarIndex: 30,
    }));
    return res.verdict === "block" && res.grade === null && res.rules.some((r) => r.id === "PB-BLK-HTF") && res.levels !== null;
  })(),
);

check(
  "block PB-BLK-BIAS: bias short 75 vs long → block",
  (() => {
    const res = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "short", confidence: 75 },
      lastBos: { H1: "long", H4: "long", D1: "long" },
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.10, swept: false }],
      dealingRange: { high: 1.095, low: 1.085, bothExtremesSwept: false },
      lastBarIndex: 30,
    }));
    return res.verdict === "block" && res.grade === null && res.rules.some((r) => r.id === "PB-BLK-BIAS");
  })(),
);

check(
  "block PB-BLK-EVENT: high-impact 10 min → block",
  (() => {
    const res = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      lastBos: { H1: "long", H4: "long", D1: "long" },
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.10, swept: false }],
      dealingRange: { high: 1.095, low: 1.085, bothExtremesSwept: false },
      lastBarIndex: 30,
      calendar: [{ impact: "high", currency: "USD", scheduledAt: new Date(NOW + 10 * 60 * 1000).toISOString() }],
    }));
    return res.verdict === "block" && res.rules.some((r) => r.id === "PB-BLK-EVENT");
  })(),
);

check(
  "block PB-BLK-RR: planned R 1.2 → block",
  (() => {
    const res = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      lastBos: { H1: "long", H4: "long", D1: "long" },
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.093, swept: false }],
      dealingRange: { high: 1.095, low: 1.085, bothExtremesSwept: false },
      lastBarIndex: 30,
    }));
    return res.verdict === "block" && res.rules.some((r) => r.id === "PB-BLK-RR");
  })(),
);

check(
  "no_setup PB-INFO-NO-SWEEP: no sweep → no_setup",
  (() => {
    const res = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      lastBos: { H1: "long", H4: "long", D1: "long" },
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: null,
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.10, swept: false }],
      dealingRange: { high: 1.095, low: 1.085, bothExtremesSwept: false },
      lastBarIndex: 30,
    }));
    return res.verdict === "no_setup" && res.grade === null && res.levels === null &&
      !res.rules.some((r) => r.message.includes("block"));
  })(),
);

check(
  "block PB-BLK-MITIGATED: mitigated zone only → block",
  (() => {
    const res = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      lastBos: { H1: "long", H4: "long", D1: "long" },
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      zones: [{ kind: "ob", direction: "long", high: 1.092, low: 1.09, mitigated: true, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.10, swept: false }],
      dealingRange: { high: 1.095, low: 1.085, bothExtremesSwept: false },
      lastBarIndex: 30,
    }));
    return res.rules.some((r) => r.id === "PB-BLK-MITIGATED");
  })(),
);

check(
  "no_setup PB-INFO-M15: M15 no shift → no_setup",
  (() => {
    const res = evaluatePlaybook(baseInput({
      timeframe: "M15",
      fundamental: { direction: "long", confidence: 80 },
      lastBos: { H1: "long", H4: "long", D1: "long" },
      shift: null,
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.10, swept: false }],
      dealingRange: { high: 1.095, low: 1.085, bothExtremesSwept: false },
      lastBarIndex: 30,
    }));
    return res.verdict === "no_setup" && res.rules.some((r) => r.id === "PB-INFO-M15");
  })(),
);

check(
  "no_setup PB-INFO-D1: D1 → no_setup",
  (() => {
    const res = evaluatePlaybook(baseInput({
      timeframe: "D1",
      fundamental: { direction: "long", confidence: 80 },
      lastBos: { H1: "long", H4: "long", D1: "long" },
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.10, swept: false }],
      dealingRange: { high: 1.095, low: 1.085, bothExtremesSwept: false },
      lastBarIndex: 30,
    }));
    return res.verdict === "no_setup" && res.rules.some((r) => r.id === "PB-INFO-D1");
  })(),
);

check(
  "downgrade PB-DG-CORR: EURUSD long + GBPUSD H4 bearish",
  (() => {
    const res = evaluatePlaybook(baseInput({
      pair: "EURUSD",
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      lastBos: { H1: "long", H4: "long", D1: "long" },
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.10, swept: false }],
      dealingRange: { high: 1.095, low: 1.085, bothExtremesSwept: false },
      sisterH4Bos: "short",
      lastBarIndex: 30,
    }));
    return res.rules.some((r) => r.id === "PB-DG-CORR");
  })(),
);

check(
  "playbookVersion 2 stamped",
  (() => {
    const res = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      lastBos: { H1: "long", H4: "long", D1: "long" },
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.10, swept: false }],
      dealingRange: { high: 1.095, low: 1.085, bothExtremesSwept: false },
      lastBarIndex: 30,
    }));
    return res.playbookVersion === 2;
  })(),
);

if (failures > 0) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("playbook-check: all green");
