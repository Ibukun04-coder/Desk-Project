import type { BiasDir } from "@/lib/data/fundamental/score-types";
import type { Alignment, Setup, SetupSide, SmcSnapshot } from "./types";

// Rules-only setup ranking: SmcSnapshot + Phase 2 BiasResult → 0–2 setups.
// Never auto-sends an order; there is no execution path anywhere in Phase 3.

// Minimal view of the Phase 2 bias — passed in by the caller (API route reads
// the stored snapshot via getLatestBias; scoring is never duplicated here).
export type FundamentalBiasInput = {
  bias: BiasDir;
  confidence: number;
} | null;

export type RankedSetups = {
  setups: Setup[];
  alignment: Alignment;
};

export const MISMATCH_NOTE = "SMC vs news mismatch — do not treat as aligned";

type Level = { entryZone: { low: number; high: number }; invalidation: number; source: string };

/** Best unmitigated level for a side: demand/supply OB → same-direction FVG → range edge. */
function levelFor(smc: SmcSnapshot, side: SetupSide): Level | null {
  const wantOb = side === "long" ? "demand" : "supply";
  const obs = smc.orderBlocks.filter((o) => o.kind === wantOb && !o.mitigated);
  const ob = obs.length > 0 ? obs[obs.length - 1] : null;
  if (ob) {
    return {
      entryZone: { low: ob.low, high: ob.high },
      invalidation: side === "long" ? ob.low : ob.high,
      source: `unmitigated ${wantOb} order block ${ob.low}-${ob.high}`,
    };
  }
  const wantFvg = side === "long" ? "bullish" : "bearish";
  const fvgs = smc.fvgs.filter((f) => f.direction === wantFvg && !f.mitigated);
  const fvg = fvgs.length > 0 ? fvgs[fvgs.length - 1] : null;
  if (fvg) {
    return {
      entryZone: { low: fvg.low, high: fvg.high },
      invalidation: side === "long" ? fvg.low : fvg.high,
      source: `unmitigated ${wantFvg} FVG ${fvg.low}-${fvg.high}`,
    };
  }
  if (smc.range) {
    if (side === "long") {
      return {
        entryZone: { low: smc.range.low, high: smc.range.midpoint },
        invalidation: smc.range.low,
        source: `range discount leg ${smc.range.low}-${smc.range.midpoint}`,
      };
    }
    return {
      entryZone: { low: smc.range.midpoint, high: smc.range.high },
      invalidation: smc.range.high,
      source: `range premium leg ${smc.range.midpoint}-${smc.range.high}`,
    };
  }
  return null;
}


function targetFor(smc: SmcSnapshot, side: SetupSide, entryHigh: number, entryLow: number): string {
  if (smc.range) {
    if (side === "long" && smc.range.high > entryHigh) return `range high ~${smc.range.high}`;
    if (side === "short" && smc.range.low < entryLow) return `range low ~${smc.range.low}`;
  }
  const pool = smc.liquidity.filter((l) =>
    side === "long" ? l.side === "eqh" || l.side === "highs" : l.side === "eql" || l.side === "lows",
  );
  if (pool.length > 0) return `resting liquidity ~${pool[0].price} (${pool[0].note})`;
  return side === "long" ? "recent swing high" : "recent swing low";
}

function lastBreakNote(smc: SmcSnapshot): string {
  const lastBos = smc.bos.length > 0 ? smc.bos[smc.bos.length - 1] : null;
  const lastChoch = smc.choch.length > 0 ? smc.choch[smc.choch.length - 1] : null;
  const last = lastBos && lastChoch
    ? (lastBos.index >= lastChoch.index ? { ev: lastBos, kind: "BOS" } : { ev: lastChoch, kind: "CHOCH" })
    : lastBos ? { ev: lastBos, kind: "BOS" } : lastChoch ? { ev: lastChoch, kind: "CHOCH" } : null;
  if (!last) return "no BOS/CHOCH break yet";
  return `last ${last.kind} ${last.ev.direction} broke ${last.ev.brokenLevel}`;
}

/**
 * Rank 0–2 setups.
 * - A-setup: SMC direction AND fundamental bias agree.
 * - B-setup: SMC has a level but fundamentals are mixed/neutral/missing, or
 *   range structure with a directional fundamental bias, or outright conflict
 *   (B only, flagged with the mismatch note).
 * - Conflict (bullish vs bearish): never an A-setup.
 */
export function rankSetups(smc: SmcSnapshot, fundamental: FundamentalBiasInput): RankedSetups {
  const smcDir = smc.htfBias;
  const fund = fundamental?.bias ?? null;
  const fundDir = fund === "bullish" || fund === "bearish" ? fund : null;
  const fundLabel = fundamental ? `${fundamental.bias} (${fundamental.confidence}%)` : "no bias snapshot yet";

  const conflict = smcDir !== "range" && fundDir !== null && smcDir !== fundDir;
  const agree = smcDir !== "range" && fundDir !== null && smcDir === fundDir;

  const build = (grade: "A" | "B", side: SetupSide, extraWhy: string[]): Setup | null => {
    const level = levelFor(smc, side);
    if (!level) return null;
    return {
      grade, side,
      entryZone: level.entryZone,
      invalidation: level.invalidation,
      targetHint: targetFor(smc, side, level.entryZone.high, level.entryZone.low),
      why: [
        `SMC ${smcDir}: ${lastBreakNote(smc)}`,
        `Level: ${level.source}`,
        `Fundamentals: ${fundLabel}`,
        ...extraWhy,
      ],
    };
  };

  if (agree) {
    const setup = build("A", fundDir === "bullish" ? "long" : "short", ["SMC direction and fundamental bias agree"]);
    const setups = setup ? [setup] : [];
    return { setups, alignment: setups.length > 0 ? "ALIGNED" : "DO_NOT_TRADE" };
  }

  if (conflict) {
    const setup = build("B", smcDir === "bullish" ? "long" : "short", [MISMATCH_NOTE]);
    const setups = setup ? [setup] : [];
    return { setups, alignment: "DO_NOT_TRADE" };
  }

  if (smcDir !== "range" && fundDir === null) {
    const setup = build("B", smcDir === "bullish" ? "long" : "short", [
      "fundamentals mixed/neutral/missing — structure-only level",
    ]);
    const setups = setup ? [setup] : [];
    return { setups, alignment: setups.length > 0 ? "MIXED" : "DO_NOT_TRADE" };
  }

  if (smcDir === "range" && fundDir !== null) {
    const setup = build("B", fundDir === "bullish" ? "long" : "short", [
      "range structure — fund-led B only, fade the range edge, not a trend",
    ]);
    const setups = setup ? [setup] : [];
    return { setups, alignment: setups.length > 0 ? "MIXED" : "DO_NOT_TRADE" };
  }

  return { setups: [], alignment: "DO_NOT_TRADE" };
}

// Phase 4 hook: playbook / strategy-video RAG should constrain setups HERE —
// filter or downgrade `setups` (e.g. reject entries that violate the loaded
// playbook, require playbook-pattern match for grade A) without touching the
// detector or the fundamental scorer.
export function applyPlaybookConstraint(setups: Setup[]): Setup[] {
  return setups;
}
