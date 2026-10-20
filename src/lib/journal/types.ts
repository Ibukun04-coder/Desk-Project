import type { Pair, Timeframe } from "@/lib/data/universe";
import type { BiasDir } from "@/lib/data/fundamental/score-types";
import type { PlaybookGrade } from "@/lib/playbook/evaluate";
import type { SetupGrade } from "@/lib/smc/types";
import type {
  Alignment,
  BreakEvent,
  FairValueGap,
  HtfBias,
  LiquidityLevel,
  OrderBlock,
  SmcRange,
} from "@/lib/smc/types";

// Phase 5 paper journal types. Analysis-only paper record — nothing here
// places, simulates, or resembles an execution path. Snapshots reuse the
// existing bias / playbook / SMC shapes; there is no second SMC or bias model.

export const JOURNAL_DIRECTIONS = ["long", "short"] as const;
export type JournalDirection = (typeof JOURNAL_DIRECTIONS)[number];

export const JOURNAL_STATUSES = ["idea", "active", "closed", "invalidated", "expired"] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

/** Statuses an entry may be created with. closed/invalidated/expired come from the close route. */
export const JOURNAL_CREATABLE_STATUSES = ["idea", "active"] as const;
export type JournalCreatableStatus = (typeof JOURNAL_CREATABLE_STATUSES)[number];

export const JOURNAL_EXIT_REASONS = ["target", "stop", "manual", "invalidated", "expired"] as const;
export type JournalExitReason = (typeof JOURNAL_EXIT_REASONS)[number];

export const JOURNAL_RESULTS = ["win", "loss", "breakeven", "scratched"] as const;
export type JournalResult = (typeof JOURNAL_RESULTS)[number];

/** Results that count toward win rate / expectancy. scratched, invalidated and expired never do. */
export const SCORED_RESULTS = ["win", "loss", "breakeven"] as const;
export type ScoredResult = (typeof SCORED_RESULTS)[number];

export const JOURNAL_SOURCES = ["from_setup", "manual"] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

/** v2 evaluator verdicts. A journal entry always carries a proposal, so a
 * snapshot is never stamped "no_setup" — the value exists for type parity. */
export const PLAYBOOK_VERDICTS = ["allow", "downgrade", "block", "no_setup"] as const;
export type PlaybookVerdict = (typeof PLAYBOOK_VERDICTS)[number];

// --- Snapshots (copied at log time, never refreshed) ---------------------------

/** Direction + confidence + the drivers already on the bias object. */
export type JournalBiasSnapshot = {
  direction: BiasDir;
  confidence: number;
  drivers: Array<{ type: "news" | "calendar"; text: string }>;
  invalidation: string;
  asOf: string;
};

export type JournalFiredRule = {
  ruleId: string;
  title: string;
  severity: "block" | "downgrade";
};

/**
 * Verdict from the ONE evaluatePlaybook call at save time (playbook v2).
 * grade is A/B/C from the evaluator — or the legacy v1 "rejected" when an old
 * row is read back. Never recomputed later.
 */
export type JournalPlaybookSnapshot = {
  /** stamped by playbook v2 writers; absent on v1 snapshots */
  playbookVersion?: 2;
  verdict: PlaybookVerdict;
  /** "rejected" is a legacy v1 blocked grade; v2 writes C */
  grade: PlaybookGrade | "rejected" | null;
  originalGrade: SetupGrade | null;
  fired: JournalFiredRule[];
  alignment: Alignment;
  asOf: string;
};

/**
 * Trimmed view of the existing SmcSnapshot — same element types the chart
 * already draws (BreakEvent, OrderBlock, FairValueGap, LiquidityLevel,
 * SmcRange, HtfBias). Swings are dropped; null when nothing was detected.
 */
export type JournalSmcSnapshot = {
  asOf: string;
  candleCount: number;
  bos: BreakEvent[];
  choch: BreakEvent[];
  fvgs: FairValueGap[];
  orderBlocks: OrderBlock[];
  liquidity: LiquidityLevel[];
  range: SmcRange | null;
  htfBias: HtfBias;
  /** note on where the entry sat against the zones at log time — analysis context only */
  entryContext: string | null;
};

export type JournalEntryDto = {
  id: string;
  createdAt: string;
  updatedAt: string;
  pair: Pair;
  timeframe: Timeframe;
  direction: JournalDirection;
  status: JournalStatus;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  target2Price: number | null;
  plannedR: number;
  thesis: string;
  biasSnapshot: JournalBiasSnapshot | null;
  biasNote: string | null;
  playbookSnapshot: JournalPlaybookSnapshot | null;
  smcSnapshot: JournalSmcSnapshot | null;
  exitPrice: number | null;
  exitReason: JournalExitReason | null;
  result: JournalResult | null;
  realizedR: number | null;
  closedAt: string | null;
  reviewNote: string | null;
  source: JournalSource;
  overrideReason: string | null;
  tags: string[];
};

export type JournalListQuery = {
  pair?: Pair;
  timeframe?: Timeframe;
  status?: JournalStatus;
  result?: JournalResult;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
};

export type JournalListResponse = {
  entries: JournalEntryDto[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export type JournalStatsBucket = {
  trades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  avgWinR: number;
  avgLossR: number;
  expectancyR: number;
};

export type JournalStatsResponse = {
  from: string | null;
  to: string | null;
  includeOverrides: boolean;
  openCount: number;
  trades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  avgWinR: number;
  avgLossR: number;
  expectancyR: number;
  breakdowns: {
    byPair: Record<string, JournalStatsBucket>;
    byTimeframe: Record<string, JournalStatsBucket>;
    byDirection: Record<string, JournalStatsBucket>;
    byGrade: Record<string, JournalStatsBucket>;
    byVerdict: Record<string, JournalStatsBucket>;
  };
};

// --- Outcome math ---------------------------------------------------------------

/** Round to 2 decimals — the single rounding rule for every stored R value. */
export function roundR(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * plannedR = distance to target / distance to stop, fixed at log time.
 * Returns null when stop === entry (the save is rejected in that case).
 */
export function computePlannedR(entry: number, stop: number, target: number): number | null {
  const risk = Math.abs(entry - stop);
  if (risk === 0) return null;
  return roundR(Math.abs(target - entry) / risk);
}

/**
 * Server-side realized R at close.
 *   Long  = (exit - entry) / (entry - stop)
 *   Short = (entry - exit) / (stop - entry)
 * Returns null when stop === entry (no defined risk, cannot score).
 */
export function computeRealizedR(
  direction: JournalDirection,
  entry: number,
  stop: number,
  exit: number,
): number | null {
  const risk = direction === "long" ? entry - stop : stop - entry;
  if (risk === 0) return null;
  const reward = direction === "long" ? exit - entry : entry - exit;
  return roundR(reward / risk);
}

/** win > 0.1, loss < -0.1, breakeven otherwise. */
export function classifyResult(realizedR: number): ScoredResult {
  if (realizedR > 0.1) return "win";
  if (realizedR < -0.1) return "loss";
  return "breakeven";
}

/** Status an entry lands in for a given close reason. */
export function statusForExitReason(reason: JournalExitReason): JournalStatus {
  if (reason === "invalidated") return "invalidated";
  if (reason === "expired") return "expired";
  return "closed";
}
