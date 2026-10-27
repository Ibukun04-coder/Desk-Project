import { describe, it } from "node:test";
import { strict as assertStrict } from "node:assert";
import { evaluatePlaybook } from "@/lib/playbook/evaluate";
import { derivePlaybookInput } from "@/lib/playbook/derive";
import type { BiasResult } from "@/lib/data/bias";

const NOW = Date.UTC(2026, 0, 10, 12, 0, 0);

const mockBias: BiasResult = {
  pair: "EURUSD",
  bias: "bearish",
  confidence: 70,
  drivers: [],
  nextEvent: null,
  invalidation: "",
  asOf: new Date(NOW),
  method: "rules-v1",
  usedLlm: false,
};

function baseInput(overrides: Partial<Parameters<typeof evaluatePlaybook>[0]>): Parameters<typeof evaluatePlaybook>[0] {
  const derived = derivePlaybookInput(
    "EURUSD",
    "H1",
    [],
    { symbol: "EURUSD", timeframe: "H1", asOf: new Date(NOW).toISOString(), candleCount: 0, swings: [], bos: [], choch: [], fvgs: [], orderBlocks: [], liquidity: [], sweeps: [], runs: [], asia: [], range: null, htfBias: "range", absorption: false, absorptionScore: 0 },
    mockBias,
    null,
    NOW,
  );
  return { ...derived, ...overrides } as Parameters<typeof evaluatePlaybook>[0];
}

describe("evaluatePlaybook (v2)", () => {
  it("1. equal-low sweep, body-close CHoCH, fresh gap, H4/D1 long, bias long 80, plannedR 2.4, London → allow A", () => {
    const res = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      previousDay: "long",
      calendar: [],
      lastBos: { H1: "long", H4: "long", D1: "long" },
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      sweepCandleOpen: Date.UTC(2026, 0, 10, 8, 0, 0),
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.11, swept: false }],
      dealingRange: { high: 1.11, low: 1.08, bothExtremesSwept: false },
      extensionBeyondBreak: 0.0005,
      lastBarIndex: 30,
    }));
    assertStrict.equal(res.verdict, "allow");
    assertStrict.equal(res.grade, "A");
    assertStrict.equal(res.direction, "long");
  });

  it("2. same but D1 opposes and H4 agrees → downgrade, not block, not A", () => {
    const res = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      lastBos: { H1: "long", H4: "long", D1: "short" },
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.104, swept: false }],
      dealingRange: { high: 1.104, low: 1.08, bothExtremesSwept: false },
      lastBarIndex: 30,
    }));
    assertStrict.equal(res.verdict, "downgrade");
    assertStrict.notEqual(res.grade, "A");
    assertStrict.ok(res.rules.some((r) => r.id === "PB-DG-ONE-TF"));
  });

  it("3. H4 and D1 both oppose → block PB-BLK-HTF", () => {
    const res = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      lastBos: { H1: "long", H4: "short", D1: "short" },
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.104, swept: false }],
      dealingRange: { high: 1.104, low: 1.08, bothExtremesSwept: false },
      lastBarIndex: 30,
    }));
    assertStrict.equal(res.verdict, "block");
    assertStrict.equal(res.grade, null);
    assertStrict.ok(res.rules.some((r) => r.id === "PB-BLK-HTF"));
    assertStrict.ok(res.levels !== null);
  });

  it("4. H4 opposes and D1 agrees → block PB-BLK-COUNTER", () => {
    const res = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      lastBos: { H1: "long", H4: "short", D1: "long" },
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.104, swept: false }],
      dealingRange: { high: 1.104, low: 1.08, bothExtremesSwept: false },
      lastBarIndex: 30,
    }));
    assertStrict.equal(res.verdict, "block");
    assertStrict.equal(res.grade, null);
    assertStrict.ok(res.rules.some((r) => r.id === "PB-BLK-COUNTER"));
    assertStrict.ok(!res.rules.some((r) => r.id === "PB-DG-ONE-TF"));
  });
  it("5. fundamental bias short at 75 against long → block PB-BLK-BIAS; bias short at 50 → PB-DG-BIAS-SOFT, not block", () => {
    const blockRes = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "short", confidence: 75 },
      lastBos: { H1: "long", H4: "long", D1: "long" },
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.104, swept: false }],
      dealingRange: { high: 1.104, low: 1.08, bothExtremesSwept: false },
      lastBarIndex: 30,
    }));
    assertStrict.equal(blockRes.verdict, "block");
    assertStrict.equal(blockRes.grade, null);
    assertStrict.ok(blockRes.rules.some((r) => r.id === "PB-BLK-BIAS"));

    const softRes = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "short", confidence: 50 },
      lastBos: { H1: "long", H4: "long", D1: "long" },
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.104, swept: false }],
      dealingRange: { high: 1.104, low: 1.08, bothExtremesSwept: false },
      lastBarIndex: 30,
    }));
    assertStrict.notEqual(softRes.verdict, "block");
    assertStrict.ok(softRes.rules.some((r) => r.id === "PB-DG-BIAS-SOFT"));
  });

  it("6. high-impact USD event 10 min away → block; 40 min ahead → PB-DG-NEWS only; calendar null → no event block", () => {
    const blockRes = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      lastBos: { H1: "long", H4: "long", D1: "long" },
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.104, swept: false }],
      dealingRange: { high: 1.104, low: 1.08, bothExtremesSwept: false },
      lastBarIndex: 30,
      calendar: [{ impact: "high", currency: "USD", scheduledAt: new Date(NOW + 10 * 60 * 1000).toISOString() }],
    }));
    assertStrict.equal(blockRes.verdict, "block");
    assertStrict.ok(blockRes.rules.some((r) => r.id === "PB-BLK-EVENT"));

    const newsRes = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      lastBos: { H1: "long", H4: "long", D1: "long" },
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.104, swept: false }],
      dealingRange: { high: 1.104, low: 1.08, bothExtremesSwept: false },
      lastBarIndex: 30,
      calendar: [{ impact: "high", currency: "USD", scheduledAt: new Date(NOW + 40 * 60 * 1000).toISOString() }],
    }));
    assertStrict.notEqual(newsRes.verdict, "block");
    assertStrict.ok(newsRes.rules.some((r) => r.id === "PB-DG-NEWS"));

    const noCalRes = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      lastBos: { H1: "long", H4: "long", D1: "long" },
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.104, swept: false }],
      dealingRange: { high: 1.104, low: 1.08, bothExtremesSwept: false },
      lastBarIndex: 30,
      calendar: null,
    }));
    assertStrict.notEqual(noCalRes.verdict, "block");
    assertStrict.ok(!noCalRes.rules.some((r) => r.id === "PB-BLK-EVENT"));
  });
  it("7. long in premium without sweep of high -> PB-BLK-LOCATION; discount after sell sweep -> clean", () => {
    const prem = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      previousDay: "long",
      calendar: [],
      lastBos: { H1: "long", H4: "long", D1: "long" },
      recentBreaks: [{ kind: "CHOCH", direction: "long", barIndex: 20 }],
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      sweepCandleOpen: Date.UTC(2026, 0, 10, 8, 0, 0),
      zones: [{ kind: "fvg", direction: "long", high: 1.1, low: 1.098, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.115, swept: false }],
      dealingRange: { high: 1.11, low: 1.08, bothExtremesSwept: false },
      extensionBeyondBreak: 0.0005,
      lastBarIndex: 30,
    }));
    assertStrict.ok(prem.rules.some((r) => r.id === "PB-BLK-LOCATION"));
    const disc = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      previousDay: "long",
      calendar: [],
      lastBos: { H1: "long", H4: "long", D1: "long" },
      recentBreaks: [{ kind: "CHOCH", direction: "long", barIndex: 20 }],
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      sweepCandleOpen: Date.UTC(2026, 0, 10, 8, 0, 0),
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.104, swept: false }],
      dealingRange: { high: 1.104, low: 1.08, bothExtremesSwept: false },
      extensionBeyondBreak: 0.0005,
      lastBarIndex: 30,
    }));
    assertStrict.ok(!disc.rules.some((r) => r.id === "PB-BLK-LOCATION"));
  });

  it("8. plannedR 1.2 -> PB-BLK-RR; 1.7 -> PB-DG-RR; 3.2 clear path -> PB-CF-ROOM", () => {
    const mk = (target: number) => baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      previousDay: "long",
      calendar: [],
      lastBos: { H1: "long", H4: "long", D1: "long" },
      recentBreaks: [{ kind: "CHOCH", direction: "long", barIndex: 20 }],
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      sweepCandleOpen: Date.UTC(2026, 0, 10, 8, 0, 0),
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: target, swept: false }],
      dealingRange: null,
      extensionBeyondBreak: 0.0005,
      lastBarIndex: 30,
    });
    const lo = evaluatePlaybook(mk(1.101));
    assertStrict.ok(lo.rules.some((r) => r.id === "PB-BLK-RR"));
    const mid = evaluatePlaybook(mk(1.10475));
    assertStrict.ok(mid.rules.some((r) => r.id === "PB-DG-RR"));
    assertStrict.ok(!mid.rules.some((r) => r.id === "PB-BLK-RR"));
    const hi = evaluatePlaybook(mk(1.116));
    assertStrict.ok(hi.rules.some((r) => r.id === "PB-CF-ROOM"));
  });

  it("9. mitigated zone only -> PB-BLK-MITIGATED; no sweep -> no_setup, word block absent", () => {
    const mit = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      previousDay: "long",
      calendar: [],
      lastBos: { H1: "long", H4: "long", D1: "long" },
      recentBreaks: [{ kind: "CHOCH", direction: "long", barIndex: 20 }],
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: true, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.104, swept: false }],
      dealingRange: null,
      lastBarIndex: 30,
    }));
    assertStrict.ok(mit.rules.some((r) => r.id === "PB-BLK-MITIGATED"));
    const noSweep = evaluatePlaybook(baseInput({
      timeframe: "H1",
      sweep: null,
      lastBarIndex: 30,
    }));
    assertStrict.equal(noSweep.verdict, "no_setup");
    assertStrict.ok(!noSweep.rules.flatMap((r) => (r.message + " " + r.id).toLowerCase().split(/[^a-z]+/)).includes("block"));
  });

  it("10. close through pool -> PB-INFO-RUN; wick-only shift -> PB-INFO-WICK; internal shift -> PB-INFO-INTERNAL", () => {
    const run = evaluatePlaybook(baseInput({
      timeframe: "H1",
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: false },
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      lastBarIndex: 30,
    }));
    assertStrict.ok(run.rules.some((r) => r.id === "PB-INFO-RUN"));
    const wick = evaluatePlaybook(baseInput({
      timeframe: "H1",
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: false, external: true },
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      lastBarIndex: 30,
    }));
    assertStrict.ok(wick.rules.some((r) => r.id === "PB-INFO-WICK"));
    const internal = evaluatePlaybook(baseInput({
      timeframe: "H1",
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: false },
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      lastBarIndex: 30,
    }));
    assertStrict.ok(internal.rules.some((r) => r.id === "PB-INFO-INTERNAL"));
  });

  it("11. internal swing sweep -> not an A", () => {
    const res = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      previousDay: "long",
      calendar: [],
      lastBos: { H1: "long", H4: "long", D1: "long" },
      recentBreaks: [{ kind: "CHOCH", direction: "long", barIndex: 20 }],
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "swing-low", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      sweepCandleOpen: Date.UTC(2026, 0, 10, 8, 0, 0),
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.104, swept: false }],
      dealingRange: null,
      extensionBeyondBreak: 0.0005,
      lastBarIndex: 30,
    }));
    assertStrict.notEqual(res.grade, "A");
    assertStrict.ok(!res.rules.some((r) => r.id === "PB-CF-EXTREME"));
  });

  it("12. opposing previous day -> downgrade not A; OB with no gap -> PB-DG-NO-FVG not A", () => {
    const prevDay = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      previousDay: "short",
      calendar: [],
      lastBos: { H1: "long", H4: "long", D1: "long" },
      recentBreaks: [{ kind: "CHOCH", direction: "long", barIndex: 20 }],
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      sweepCandleOpen: Date.UTC(2026, 0, 10, 8, 0, 0),
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.104, swept: false }],
      dealingRange: null,
      lastBarIndex: 30,
    }));
    assertStrict.equal(prevDay.verdict, "downgrade");
    assertStrict.notEqual(prevDay.grade, "A");
    const noFvg = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      previousDay: "long",
      calendar: [],
      lastBos: { H1: "long", H4: "long", D1: "long" },
      recentBreaks: [{ kind: "BOS", direction: "long", barIndex: 20 }],
      shift: { kind: "BOS", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      sweepCandleOpen: Date.UTC(2026, 0, 10, 8, 0, 0),
      zones: [{ kind: "ob", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.104, swept: false }],
      dealingRange: null,
      lastBarIndex: 30,
    }));
    assertStrict.ok(noFvg.rules.some((r) => r.id === "PB-DG-NO-FVG"));
    assertStrict.notEqual(noFvg.grade, "A");
  });
  it("13. M15 with no shift -> PB-INFO-M15; M15 zone inside H1 zone -> PB-CF-LTF", () => {
    const noShift = evaluatePlaybook(baseInput({
      timeframe: "M15",
      shift: null,
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      lastBarIndex: 30,
    }));
    assertStrict.ok(noShift.rules.some((r) => r.id === "PB-INFO-M15"));
    const ltf = evaluatePlaybook(baseInput({
      pair: "EURUSD",
      timeframe: "M15",
      fundamental: { direction: "long", confidence: 50 },
      previousDay: "long",
      calendar: [],
      lastBos: { H1: "long", H4: "long", D1: "long" },
      recentBreaks: [{ kind: "BOS", direction: "long", barIndex: 20 }],
      shift: { kind: "BOS", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      sweepCandleOpen: Date.UTC(2026, 0, 10, 8, 0, 0),
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      m15Zone: { high: 1.0915, low: 1.0905, mitigated: false, formedAt: 22, direction: "long" },
      pools: [{ side: "buy", kind: "eqh", price: 1.104, swept: false }],
      dealingRange: null,
      lastBarIndex: 30,
    }));
    assertStrict.ok(ltf.rules.some((r) => r.id === "PB-CF-LTF"));
  });

  it("14. D1 selected -> PB-INFO-D1", () => {
    const res = evaluatePlaybook(baseInput({ timeframe: "D1", lastBarIndex: 30 }));
    assertStrict.equal(res.verdict, "no_setup");
    assertStrict.ok(res.rules.some((r) => r.id === "PB-INFO-D1"));
  });

  it("15. alternating breaks no HTF BOS -> PB-BLK-CHOP; range exception suppresses chop, caps at B", () => {
    const alt = [
      { kind: "BOS", direction: "long", barIndex: 10 },
      { kind: "CHOCH", direction: "short", barIndex: 12 },
      { kind: "BOS", direction: "long", barIndex: 14 },
    ] as { kind: "BOS" | "CHOCH"; direction: "long" | "short"; barIndex: number }[];
    const chop = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 50 },
      previousDay: "long",
      calendar: [],
      lastBos: { H1: null, H4: null, D1: null },
      recentBreaks: alt,
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      sweepCandleOpen: Date.UTC(2026, 0, 10, 8, 0, 0),
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.104, swept: false }],
      dealingRange: null,
      lastBarIndex: 30,
    }));
    assertStrict.ok(chop.rules.some((r) => r.id === "PB-BLK-CHOP"));
    const rangeCase = evaluatePlaybook(baseInput({
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      previousDay: "long",
      calendar: [],
      lastBos: { H1: "long", H4: "long", D1: "long" },
      recentBreaks: alt,
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "asia-low", barIndex: 15, wickPrice: 1.0845, ofRangeExtreme: true, closedBackInside: true },
      sweepCandleOpen: Date.UTC(2026, 0, 10, 8, 0, 0),
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.104, swept: false }],
      dealingRange: { high: 1.1, low: 1.085, bothExtremesSwept: true },
      lastBarIndex: 30,
    }));
    assertStrict.ok(!rangeCase.rules.some((r) => r.id === "PB-BLK-CHOP"));
    assertStrict.notEqual(rangeCase.grade, "A");
  });

  it("16. EURUSD long + GBPUSD H4 bearish -> PB-DG-CORR; USDJPY must not fire it", () => {
    const eur = evaluatePlaybook(baseInput({
      pair: "EURUSD",
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      previousDay: "long",
      calendar: [],
      lastBos: { H1: "long", H4: "long", D1: "long" },
      recentBreaks: [{ kind: "CHOCH", direction: "long", barIndex: 20 }],
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 1.09, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 1.085, ofRangeExtreme: false, closedBackInside: true },
      sweepCandleOpen: Date.UTC(2026, 0, 10, 8, 0, 0),
      zones: [{ kind: "fvg", direction: "long", high: 1.092, low: 1.09, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 1.104, swept: false }],
      dealingRange: null,
      sisterH4Bos: "short",
      extensionBeyondBreak: 0.0005,
      lastBarIndex: 30,
    }));
    assertStrict.ok(eur.rules.some((r) => r.id === "PB-DG-CORR"));
    const jpy = evaluatePlaybook(baseInput({
      pair: "USDJPY",
      timeframe: "H1",
      fundamental: { direction: "long", confidence: 80 },
      previousDay: "long",
      calendar: [],
      lastBos: { H1: "long", H4: "long", D1: "long" },
      recentBreaks: [{ kind: "CHOCH", direction: "long", barIndex: 20 }],
      shift: { kind: "CHOCH", direction: "long", brokenLevel: 150, barIndex: 20, bodyClose: true, external: true },
      sweep: { pool: "eql", barIndex: 15, wickPrice: 149.5, ofRangeExtreme: false, closedBackInside: true },
      sweepCandleOpen: Date.UTC(2026, 0, 10, 1, 0, 0),
      zones: [{ kind: "fvg", direction: "long", high: 151, low: 150.5, mitigated: false, formedAt: 21 }],
      pools: [{ side: "buy", kind: "eqh", price: 153, swept: false }],
      dealingRange: null,
      sisterH4Bos: "short",
      extensionBeyondBreak: 0.2,
      lastBarIndex: 30,
    }));
    assertStrict.ok(!jpy.rules.some((r) => r.id === "PB-DG-CORR"));
  });
});

