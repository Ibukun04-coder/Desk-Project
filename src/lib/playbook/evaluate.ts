import type { Pair, Timeframe } from "@/lib/data/universe";

export const PLAYBOOK_VERSION = 2;

export type Verdict = "allow" | "downgrade" | "block" | "no_setup";
export type PlaybookGrade = "A" | "B" | "C";
export type PlaybookRuleSeverity = "block" | "downgrade" | "confluence" | "info";

export type PlaybookRuleOutcome = { id: string; severity: PlaybookRuleSeverity; message: string; };
export type PlaybookLevels = { entry: number; invalidation: number; target: number; plannedR: number; };
export type PlaybookResult = {
  playbookVersion: 2; verdict: Verdict; grade: PlaybookGrade | null;
  direction: "long" | "short" | null; rules: PlaybookRuleOutcome[]; levels: PlaybookLevels | null;
};

export type CalendarEventInput = { impact: "high" | "medium"; currency: string; scheduledAt: string; };
export type LastBosMap = { H1: "long" | "short" | null; H4: "long" | "short" | null; D1: "long" | "short" | null; };
export type BreakInput = { kind: "BOS" | "CHOCH"; direction: "long" | "short"; barIndex: number; };
export type ShiftInput = { kind: "BOS" | "CHOCH"; direction: "long" | "short"; brokenLevel: number; barIndex: number; bodyClose: boolean; external: boolean; };
export type SweepInput = { pool: string; barIndex: number; wickPrice: number; ofRangeExtreme: boolean; closedBackInside: boolean; };
export type ZoneInput = { kind: "fvg" | "ob"; direction: "long" | "short"; high: number; low: number; mitigated: boolean; formedAt: number; };
export type PoolInput = { side: "buy" | "sell"; kind: "swing" | "pdh" | "pdl" | "eqh" | "eql" | "asia-high" | "asia-low"; price: number; swept: boolean; };
export type DealingRangeInput = { high: number; low: number; bothExtremesSwept: boolean; };
export type M15ZoneInput = { high: number; low: number; mitigated: boolean; formedAt: number; direction: "long" | "short"; };
export type FundamentalInput = { direction: "long" | "short" | "neutral"; confidence: number; };

export type PlaybookInput = {
  pair: Pair; timeframe: Timeframe; now: number; atr14: number | null;
  fundamental: FundamentalInput | null; previousDay: "long" | "short" | null;
  calendar: CalendarEventInput[] | null; lastBos: LastBosMap;
  recentBreaks: BreakInput[]; shift: ShiftInput | null; sweep: SweepInput | null;
  sweepCandleOpen: number | null; zones: ZoneInput[]; pools: PoolInput[];
  dealingRange: DealingRangeInput | null; extensionBeyondBreak: number | null;
  sisterH4Bos: "long" | "short" | null; m15Zone: M15ZoneInput | null;
  lastBarIndex: number;
  // Absorption/stagnation fields from SMC
  absorption?: boolean;
  absorptionScore?: number;
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function zonesOverlap(aLow: number, aHigh: number, bLow: number, bHigh: number): boolean {
  return Math.max(aLow, bLow) <= Math.min(aHigh, bHigh);
}

function pipBuffer(pair: Pair): number {
  switch (pair) {
    case "USDJPY": return 0.08;
    case "XAUUSD": return 0.80;
    default: return 0.0005;
  }
}

function eventMinutesAway(scheduledAt: string, now: number): number {
  return (new Date(scheduledAt).getTime() - now) / 1000 / 60;
}

function eventCurrencies(pair: Pair): string[] {
  if (pair === "XAUUSD") return ["USD"];
  return [pair.slice(0, 3), pair.slice(3, 6)];
}

function hasHighImpactNear(events: CalendarEventInput[] | null, pair: Pair, now: number, windowMinutes: number): CalendarEventInput | null {
  if (!events) return null;
  const ccy = eventCurrencies(pair);
  for (const e of events) {
    if (!ccy.includes(e.currency)) continue;
    if (e.impact !== "high") continue;
    const mins = Math.abs(eventMinutesAway(e.scheduledAt, now));
    if (mins <= windowMinutes) return e;
  }
  return null;
}

function hasMediumImpactNear(events: CalendarEventInput[] | null, pair: Pair, now: number, windowMinutes: number): CalendarEventInput | null {
  if (!events) return null;
  const ccy = eventCurrencies(pair);
  for (const e of events) {
    if (!ccy.includes(e.currency)) continue;
    if (e.impact !== "medium") continue;
    const mins = Math.abs(eventMinutesAway(e.scheduledAt, now));
    if (mins <= windowMinutes) return e;
  }
  return null;
}

function isInSession(pair: Pair, openTimeMs: number): boolean {
  const d = new Date(openTimeMs);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  const sessions: [number, number][] = pair === "USDJPY" ? [[0, 3], [7, 10], [12, 16]] : [[7, 10], [12, 16]];
  return sessions.some(([s, e]) => h >= s && h < e);
}

export function evaluatePlaybook(input: PlaybookInput): PlaybookResult {
  const {
    pair, timeframe, now, atr14, fundamental, previousDay, calendar,
    lastBos, recentBreaks, shift, sweep, sweepCandleOpen, zones, pools,
    dealingRange, extensionBeyondBreak, sisterH4Bos, m15Zone, lastBarIndex,
    absorption, absorptionScore,
  } = input;

  const out: PlaybookRuleOutcome[] = [];
  let direction: "long" | "short" | null = null;
  let rangeException = false;

  if (timeframe === "D1") {
    out.push({ id: "PB-INFO-D1", severity: "info", message: "D1 is narrative only — no setup on this timeframe." });
    return { playbookVersion: 2, verdict: "no_setup", grade: null, direction: null, rules: out, levels: null };
  }
  if (timeframe === "M15" && !shift) {
    out.push({ id: "PB-INFO-M15", severity: "info", message: "M15 has no confirming shift yet." });
    return { playbookVersion: 2, verdict: "no_setup", grade: null, direction: null, rules: out, levels: null };
  }
  if (!sweep) {
    out.push({ id: "PB-INFO-NO-SWEEP", severity: "info", message: "No sweep detected — nothing to trade." });
    return { playbookVersion: 2, verdict: "no_setup", grade: null, direction: null, rules: out, levels: null };
  }
  if (lastBarIndex - sweep.barIndex > 30) {
    out.push({ id: "PB-INFO-STALE-SWEEP", severity: "info", message: "Sweep is stale — more than 30 bars old." });
    return { playbookVersion: 2, verdict: "no_setup", grade: null, direction: null, rules: out, levels: null };
  }
  if (!sweep.closedBackInside) {
    out.push({ id: "PB-INFO-RUN", severity: "info", message: "Candle closed through the pool — that's a run, not a reversal." });
    return { playbookVersion: 2, verdict: "no_setup", grade: null, direction: null, rules: out, levels: null };
  }
  if (!shift) {
    out.push({ id: "PB-INFO-NO-SHIFT", severity: "info", message: "No confirming shift after the sweep." });
    return { playbookVersion: 2, verdict: "no_setup", grade: null, direction: null, rules: out, levels: null };
  }
  if (!shift.bodyClose) {
    out.push({ id: "PB-INFO-WICK", severity: "info", message: "Shift is a wick only — no body close beyond the swing." });
    return { playbookVersion: 2, verdict: "no_setup", grade: null, direction: null, rules: out, levels: null };
  }
  if (!shift.external) {
    out.push({ id: "PB-INFO-INTERNAL", severity: "info", message: "Shift is an internal swing, not an external break." });
    return { playbookVersion: 2, verdict: "no_setup", grade: null, direction: null, rules: out, levels: null };
  }
  direction = shift.direction;
  const freshZonesEarly = zones.filter((z) =>
    !z.mitigated && z.formedAt >= shift.barIndex && z.direction === direction,
  );
  const anyZoneDirAfterShiftEarly = zones.some((z) =>
    z.formedAt >= shift.barIndex && z.direction === direction,
  );
  const mitigatedOnly = anyZoneDirAfterShiftEarly && freshZonesEarly.length === 0;
  const allowMitigatedFallback = mitigatedOnly;
  const anyZoneAfterShift = zones.some((z) => z.formedAt >= shift.barIndex);
  if (!anyZoneAfterShift) {
    out.push({ id: "PB-INFO-NO-ZONE", severity: "info", message: "No zone formed at or after the shift." });
    return { playbookVersion: 2, verdict: "no_setup", grade: null, direction: null, rules: out, levels: null };
  }
  if (!fundamental) {
    out.push({ id: "PB-INFO-NO-BIAS", severity: "info", message: "No fundamental bias snapshot — grade capped at B." });
  }
  if (!calendar) {
    out.push({ id: "PB-INFO-NO-CAL", severity: "info", message: "Calendar feed missing — event blocks/downgrades skipped." });
  }

  let entry: number | null = null;
  if (timeframe === "M15" && m15Zone && !m15Zone.mitigated
    && m15Zone.formedAt >= shift.barIndex && m15Zone.direction === direction) {
    const overlapsH1 = zones.some((z) =>
      z.formedAt >= shift.barIndex && z.direction === direction
      && zonesOverlap(m15Zone.low, m15Zone.high, z.low, z.high),
    );
    if (overlapsH1) {
      entry = direction === "long" ? m15Zone.high : m15Zone.low;
    }
  }
  if (entry === null) {
    const fvg = zones.find((z) =>
      !z.mitigated && z.formedAt >= shift.barIndex
      && z.direction === direction && z.kind === "fvg",
    );
    if (fvg) {
      entry = direction === "long" ? fvg.high : fvg.low;
    } else {
      const ob = zones.find((z) =>
        !z.mitigated && z.formedAt >= shift.barIndex
        && z.direction === direction && z.kind === "ob",
      );
      if (ob) entry = (ob.low + ob.high) / 2;
    }
  }
  if (entry === null && allowMitigatedFallback) {
    const fvgAny = zones.find((z) =>
      z.formedAt >= shift.barIndex
      && z.direction === direction && z.kind === "fvg",
    );
    if (fvgAny) {
      entry = direction === "long" ? fvgAny.high : fvgAny.low;
    } else {
      const obAny = zones.find((z) =>
        z.formedAt >= shift.barIndex
        && z.direction === direction && z.kind === "ob",
      );
      if (obAny) entry = (obAny.low + obAny.high) / 2;
    }
  }
  const atrBuffer = atr14 ? atr14 * 0.1 : pipBuffer(pair);
  const invalidation = direction === "long"
    ? sweep.wickPrice - atrBuffer
    : sweep.wickPrice + atrBuffer;
  const risk = entry !== null ? Math.abs(entry - invalidation) : 0;
  let target: number | null = null;
  const opposingSide = direction === "long" ? "buy" : "sell";
  const candidatePools = pools.filter((p) => p.side === opposingSide && !p.swept);
  if (entry !== null) {
    if (direction === "long") {
      const above = candidatePools.filter((p) => p.price > entry).sort((a, b) => a.price - b.price);
      target = above.length > 0 ? above[0].price : null;
    } else {
      const below = candidatePools.filter((p) => p.price < entry).sort((a, b) => b.price - a.price);
      target = below.length > 0 ? below[0].price : null;
    }
  }
  if (dealingRange && dealingRange.bothExtremesSwept && sweep.ofRangeExtreme) {
    rangeException = true;
    const oppExtreme = direction === "long" ? dealingRange.high : dealingRange.low;
    const mid = (dealingRange.high + dealingRange.low) / 2;
    if (entry !== null && risk > 0) {
      const rewardToOpp = Math.abs(oppExtreme - entry);
      if (rewardToOpp / risk >= 2) target = oppExtreme;
      else target = mid;
    }
  }
  const plannedR = entry !== null && risk > 0 && target !== null
    ? round2(Math.abs(target - entry) / risk)
    : 0;
  let levels: PlaybookLevels | null = null;
  if (entry !== null && risk > 0 && target !== null) {
    levels = { entry, invalidation, target, plannedR };
  }
  if (entry === null || risk <= 0) {
    out.push({ id: "PB-INFO-ZERO-RISK", severity: "info", message: "Risk is zero or less — levels withheld." });
    return { playbookVersion: 2, verdict: "no_setup", grade: null, direction: null, rules: out, levels: null };
  }
  if (target === null) {
    out.push({ id: "PB-INFO-NO-TARGET", severity: "info", message: "No unswept opposing pool beyond entry — no target." });
    return { playbookVersion: 2, verdict: "no_setup", grade: null, direction: null, rules: out, levels: null };
  }

  const alignmentTfs: string[] = timeframe === "H4" ? ["D1"] : ["H4", "D1"];
  const parentTf: string = timeframe === "H4" ? "D1" : "H4";
  function tfOpposes(tf: string): boolean {
    const v = lastBos[tf as keyof LastBosMap];
    return v !== null && v !== direction;
  }
  function tfAgrees(tf: string): boolean {
    const v = lastBos[tf as keyof LastBosMap];
    return v !== null && v === direction;
  }
  const alignmentOpposes = alignmentTfs.filter(tfOpposes);
  const parentOpposes = tfOpposes(parentTf);

  const freshZones = zones.filter((z) =>
    !z.mitigated && z.formedAt >= shift.barIndex && z.direction === direction,
  );
  const anyZoneDirAfterShift = zones.some((z) =>
    z.formedAt >= shift.barIndex && z.direction === direction,
  );
  if (anyZoneDirAfterShift && freshZones.length === 0) {
    out.push({ id: "PB-BLK-MITIGATED", severity: "block", message: "The only zone is already mitigated — no valid entry area." });
  }
  if (alignmentOpposes.length === alignmentTfs.length && alignmentTfs.length > 0) {
    out.push({ id: "PB-BLK-HTF", severity: "block", message: "Every alignment timeframe's last BOS opposes the setup direction." });
  }
  if (parentOpposes) {
    out.push({ id: "PB-BLK-COUNTER", severity: "block", message: "External parent trend opposes the setup direction." });
  }
  if (fundamental && fundamental.direction !== "neutral"
    && fundamental.direction !== direction && fundamental.confidence >= 70) {
    out.push({ id: "PB-BLK-BIAS", severity: "block", message: "Fundamental bias opposes with high confidence." });
  }
  if (calendar) {
    const blkEvent = hasHighImpactNear(calendar, pair, now, 15);
    if (blkEvent) {
      out.push({ id: "PB-BLK-EVENT", severity: "block", message: "High-impact " + blkEvent.currency + " event within 15 minutes." });
    }
  }
  if (dealingRange && !sweep.ofRangeExtreme && entry !== null) {
    const mid = (dealingRange.high + dealingRange.low) / 2;
    const locBlocked = direction === "long" ? entry > mid : entry < mid;
    if (locBlocked) {
      out.push({ id: "PB-BLK-LOCATION", severity: "block", message: "Entry is on the wrong side of the dealing-range midpoint." });
    }
  }
  if (plannedR < 1.5) {
    out.push({ id: "PB-BLK-RR", severity: "block", message: "Planned R " + plannedR + " is below 1.5 minimum." });
  }
  if (!rangeException && recentBreaks.length >= 3) {
    const last3 = recentBreaks.slice(-3);
    const alternates = last3[0].kind !== last3[1].kind && last3[1].kind !== last3[2].kind;
    const noAlignmentBos = alignmentTfs.every((tf) => !tfAgrees(tf));
    if (alternates && noAlignmentBos) {
      out.push({ id: "PB-BLK-CHOP", severity: "block", message: "Choppy alternating breaks with no higher-timeframe BOS in setup direction." });
    }
  }

  const blkCounterFired = out.some((r) => r.id === "PB-BLK-COUNTER");
  if (!blkCounterFired && alignmentOpposes.length === 1 && !parentOpposes) {
    out.push({ id: "PB-DG-ONE-TF", severity: "downgrade", message: "Exactly one alignment timeframe opposes — not the parent trend." });
  }
  if (fundamental) {
    if (fundamental.direction === "neutral") {
      out.push({ id: "PB-DG-BIAS-SOFT", severity: "downgrade", message: "Fundamental bias is neutral." });
    } else if (fundamental.direction !== direction && fundamental.confidence < 70) {
      out.push({ id: "PB-DG-BIAS-SOFT", severity: "downgrade", message: "Fundamental bias opposes with low confidence." });
    }
  }
  if (dealingRange && entry !== null) {
    const rangePct = (entry - dealingRange.low) / (dealingRange.high - dealingRange.low);
    if (rangePct >= 0.45 && rangePct <= 0.55) {
      out.push({ id: "PB-DG-EQ", severity: "downgrade", message: "Entry is inside the middle 45-55% of the dealing range." });
    }
  }
  if (sweepCandleOpen === null || !isInSession(pair, sweepCandleOpen)) {
    out.push({ id: "PB-DG-SESSION", severity: "downgrade", message: "Sweep candle opened outside the pair's trading session." });
  }
  if (atr14 && extensionBeyondBreak !== null && extensionBeyondBreak > atr14 * 1.5) {
    out.push({ id: "PB-DG-LATE", severity: "downgrade", message: "Extension beyond the break exceeds 1.5 ATR(14)." });
  }
  if (plannedR >= 1.5 && plannedR < 2) {
    out.push({ id: "PB-DG-RR", severity: "downgrade", message: "Planned R " + plannedR + " is between 1.5 and 2." });
  }
  const blkEventFired = out.some((r) => r.id === "PB-BLK-EVENT");
  if (calendar && !blkEventFired) {
    const ccy = eventCurrencies(pair);
    let newsDowngrade = false;
    for (const e of calendar) {
      if (!ccy.includes(e.currency)) continue;
      const mins = eventMinutesAway(e.scheduledAt, now);
      if (e.impact === "high" && mins > 15 && mins <= 90) { newsDowngrade = true; break; }
      if (e.impact === "medium" && mins > 0 && mins <= 30) { newsDowngrade = true; break; }
    }
    if (newsDowngrade) {
      out.push({ id: "PB-DG-NEWS", severity: "downgrade", message: "High-impact event 15-90 minutes ahead, or medium-impact within 30 minutes." });
    }
  }
  if ((pair === "EURUSD" || pair === "GBPUSD") && sisterH4Bos !== null && sisterH4Bos !== direction) {
    out.push({ id: "PB-DG-CORR", severity: "downgrade", message: "Sister pair's H4 BOS opposes the setup direction." });
  }
  const hasFreshFVG = freshZones.some((z) => z.kind === "fvg");
  const hasFreshOB = freshZones.some((z) => z.kind === "ob");
  if (hasFreshOB && !hasFreshFVG) {
    out.push({ id: "PB-DG-NO-FVG", severity: "downgrade", message: "The only fresh zone is an order block — no fair value gap." });
  }
  if (previousDay !== null && previousDay !== direction) {
    out.push({ id: "PB-DG-PREV-DAY", severity: "downgrade", message: "Previous daily candle direction opposes the setup." });
  }

  if (alignmentTfs.length > 0 && alignmentTfs.every(tfAgrees)) {
    out.push({ id: "PB-CF-HTF", severity: "confluence", message: "Every alignment timeframe's BOS agrees with the setup direction." });
  }
  if (fundamental && fundamental.direction === direction && fundamental.confidence >= 60) {
    out.push({ id: "PB-CF-BIAS", severity: "confluence", message: "Fundamental bias agrees with confidence of 60 or higher." });
  }
  if (sweepCandleOpen !== null && isInSession(pair, sweepCandleOpen)) {
    out.push({ id: "PB-CF-KILLZONE", severity: "confluence", message: "Sweep candle opened inside the pair's trading session." });
  }
  if (sweep && ["asia-high", "asia-low", "pdh", "pdl", "eqh", "eql"].includes(sweep.pool)) {
    out.push({ id: "PB-CF-EXTREME", severity: "confluence", message: "Swept pool is Asia, prior-day, or equal highs/lows." });
  }
  if (shift && shift.kind === "CHOCH" && shift.bodyClose) {
    out.push({ id: "PB-CF-CHOCH", severity: "confluence", message: "Confirming shift is a body-close change of character." });
  }
  if (timeframe === "M15" && m15Zone && !m15Zone.mitigated
    && m15Zone.formedAt >= shift.barIndex && m15Zone.direction === direction) {
    const overlapsH1 = zones.some((z) =>
      z.formedAt >= shift.barIndex && z.direction === direction
      && zonesOverlap(m15Zone.low, m15Zone.high, z.low, z.high),
    );
    if (overlapsH1) {
      out.push({ id: "PB-CF-LTF", severity: "confluence", message: "M15 entry is a fresh zone inside the H1 zone." });
    }
  }
  const freshFvg = zones.find((z) =>
    !z.mitigated && z.formedAt >= shift.barIndex
    && z.direction === direction && z.kind === "fvg",
  );
  const freshOb = zones.find((z) =>
    !z.mitigated && z.formedAt >= shift.barIndex
    && z.direction === direction && z.kind === "ob",
  );
  if (freshFvg && freshOb && zonesOverlap(freshFvg.low, freshFvg.high, freshOb.low, freshOb.high)) {
    out.push({ id: "PB-CF-OVERLAP", severity: "confluence", message: "Entry sits in the overlap of a fresh gap and a fresh order block." });
  }
  if (plannedR >= 3 && entry !== null) {
    const poolInside1R = pools.some((p) =>
      !p.swept && Math.abs(p.price - entry) <= risk * 1,
    );
    if (!poolInside1R) {
      out.push({ id: "PB-CF-ROOM", severity: "confluence", message: "Planned R is 3 or more with no unswept pool inside 1R." });
    }
  }
  if (previousDay !== null && previousDay === direction) {
    out.push({ id: "PB-CF-PREV-DAY", severity: "confluence", message: "Previous daily candle agrees with the setup direction." });
  }
  if (absorption) {
    out.push({ id: "PB-CF-ABSORPTION", severity: "confluence", message: `Absorption/stagnation detected at zone (score ${absorptionScore ?? 0}) — opposing side absorbing orders.` });
  }

  const confluences = out.filter((r) => r.severity === "confluence").length;
  const downgrades = out.filter((r) => r.severity === "downgrade").length;
  const blocked = out.some((r) => r.severity === "block");

  const hasCFHTF = out.some((r) => r.id === "PB-CF-HTF");
  const hasCFBIAS = out.some((r) => r.id === "PB-CF-BIAS");
  const hasCFEXTREME = out.some((r) => r.id === "PB-CF-EXTREME");
  const hasCFCHOCH = out.some((r) => r.id === "PB-CF-CHOCH");
  const plannedR2 = plannedR >= 2;
  const noDgSession = !out.some((r) => r.id === "PB-DG-SESSION");
  const noDgPrevDay = !out.some((r) => r.id === "PB-DG-PREV-DAY");
  const noDgNoFvg = !out.some((r) => r.id === "PB-DG-NO-FVG");
  const moreCFthanDG = confluences > downgrades;

  const gradeA = hasCFHTF && hasCFBIAS && hasCFEXTREME && hasCFCHOCH
    && plannedR2 && noDgSession && noDgPrevDay && noDgNoFvg
    && moreCFthanDG && !rangeException;

  let grade: PlaybookGrade | null;
  if (gradeA) {
    grade = "A";
  } else if (downgrades - confluences >= 2) {
    grade = "C";
  } else {
    grade = "B";
  }
  if (rangeException && grade === "A") grade = "B";
  if (out.some((r) => r.id === "PB-INFO-NO-BIAS") && grade === "A") grade = "B";

  let verdict: Verdict;
  if (blocked) {
    verdict = "block";
    grade = null;
  } else {
    const dgOneTf = out.some((r) => r.id === "PB-DG-ONE-TF");
    const dgPrevDay = out.some((r) => r.id === "PB-DG-PREV-DAY");
    const dgOutnumberCF = downgrades > confluences;
    verdict = (dgOneTf || dgPrevDay || dgOutnumberCF) ? "downgrade" : "allow";
  }

  return { playbookVersion: 2, verdict, grade, direction, rules: out, levels };
}
