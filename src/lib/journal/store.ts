import { prisma } from "@/lib/data/prisma";
import { getLatestBias, type BiasResult } from "@/lib/data/bias";
import { getCandles } from "@/lib/data/queries";
import type { Pair, Timeframe } from "@/lib/data/universe";
import { evaluatePlaybook } from "@/lib/playbook/evaluate";
import { derivePlaybookInput } from "@/lib/playbook/derive";
import { MIN_CANDLES_FOR_SMC, detectSmc } from "@/lib/smc/detect";
import type { SmcSnapshot } from "@/lib/smc/types";
import type { JournalEntry } from "@prisma/client";
import {
  classifyResult,
  computeRealizedR,
  roundR,
  SCORED_RESULTS,
  statusForExitReason,
  type JournalBiasSnapshot,
  type JournalDirection,
  type JournalEntryDto,
  type JournalExitReason,
  type JournalListQuery,
  type JournalListResponse,
  type JournalPlaybookSnapshot,
  type JournalResult,
  type JournalSmcSnapshot,
  type JournalSource,
  type JournalStatsBucket,
  type JournalStatsResponse,
  type JournalStatus,
  type PlaybookVerdict,
} from "./types";

// Phase 5 journal persistence. The playbook verdict is computed ONCE, at save
// time, by calling the existing evaluatePlaybook (v2) â€” old rows are never
// re-scored, so a later playbook or bias edit cannot rewrite journal history.

const CANDLE_LIMIT_FOR_SMC = 300;

// --- Verdict gate ---------------------------------------------------------------

export type VerdictInput = {
  pair: Pair;
  timeframe: Timeframe;
  direction: JournalDirection;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
};

export type VerdictResult = {
  playbook: JournalPlaybookSnapshot;
  bias: JournalBiasSnapshot | null;
  smc: JournalSmcSnapshot | null;
};

/**
 * One call into the existing playbook evaluator. Server loads the current
 * bias, SMC and enabled rules itself â€” the client never supplies a verdict.
 * The entry's own prices form the setup under test, so a blocked setup stays
 * blocked whether it came from the chart or from a manual form.
 */
export async function computePlaybookVerdict(input: VerdictInput): Promise<VerdictResult> {
  const [candles, bias] = await Promise.all([
    getCandles({ symbol: input.pair, timeframe: input.timeframe, limit: CANDLE_LIMIT_FOR_SMC }),
    getLatestBias(input.pair),
  ]);
  const smc = detectSmc(input.pair, input.timeframe, candles);
  const playbookInput = derivePlaybookInput(input.pair, input.timeframe, candles, smc, bias, Date.now());
  const result = evaluatePlaybook(playbookInput);


  // The snapshot keeps its original shape: written block/downgrade rules only
  // (confluence/info context lives in the live result, not in history).
  const playbook: JournalPlaybookSnapshot = {
    playbookVersion: 2,
    verdict: result.verdict,
    grade: result.grade,
    originalGrade: null,
    fired: result.rules.flatMap((r) =>
      r.severity === "block" || r.severity === "downgrade"
        ? [{ ruleId: r.id, title: r.message, severity: r.severity }]
        : [],
    ),
    alignment: "DO_NOT_TRADE",
    asOf: new Date().toISOString(),
  };

  return { playbook, bias: bias ? toBiasSnapshot(bias) : null, smc: toSmcSnapshot(smc) };
}

function toBiasSnapshot(bias: BiasResult): JournalBiasSnapshot {
  return {
    direction: bias.bias,
    confidence: bias.confidence,
    drivers: bias.drivers.map((d) => ({ type: d.type, text: d.text })),
    invalidation: bias.invalidation,
    asOf: bias.asOf.toISOString(),
  };
}

/** Trim the live SmcSnapshot down to what the journal keeps â€” same types, no swings. */
function toSmcSnapshot(smc: SmcSnapshot): JournalSmcSnapshot | null {
  const meaningful =
    smc.candleCount >= MIN_CANDLES_FOR_SMC &&
    (smc.bos.length > 0 ||
      smc.choch.length > 0 ||
      smc.fvgs.length > 0 ||
      smc.orderBlocks.length > 0 ||
      smc.liquidity.length > 0 ||
      smc.range !== null);
  if (!meaningful) return null;
  return {
    asOf: smc.asOf,
    candleCount: smc.candleCount,
    bos: smc.bos,
    choch: smc.choch,
    fvgs: smc.fvgs,
    orderBlocks: smc.orderBlocks,
    liquidity: smc.liquidity,
    range: smc.range,
    htfBias: smc.htfBias,
    entryContext: describeEntryContext(smc),
  };
}

/** Where the last unmitigated zones sat relative to the current price â€” analysis note only. */
function describeEntryContext(smc: SmcSnapshot): string | null {
  const parts: string[] = [];
  const lastOb = smc.orderBlocks.filter((o) => !o.mitigated).at(-1);
  if (lastOb) parts.push(`last unmitigated ${lastOb.kind} OB ${lastOb.low}-${lastOb.high}`);
  const lastFvg = smc.fvgs.filter((f) => !f.mitigated).at(-1);
  if (lastFvg) parts.push(`last unmitigated ${lastFvg.direction} FVG ${lastFvg.low}-${lastFvg.high}`);
  if (smc.range) parts.push(`range ${smc.range.low}-${smc.range.high} (mid ${smc.range.midpoint})`);
  return parts.length > 0 ? parts.join(" Â· ") : null;
}

// --- Serialization ---------------------------------------------------------------

function parseJson<T>(value: unknown, guard: (v: unknown) => v is T): T | null {
  if (value == null) return null;
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return guard(parsed) ? parsed : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isBiasSnapshot(v: unknown): v is JournalBiasSnapshot {
  return isRecord(v) && typeof v.direction === "string" && typeof v.confidence === "number";
}

function isPlaybookSnapshot(v: unknown): v is JournalPlaybookSnapshot {
  return isRecord(v) && typeof v.verdict === "string" && Array.isArray(v.fired);
}

function isSmcSnapshot(v: unknown): v is JournalSmcSnapshot {
  return isRecord(v) && typeof v.htfBias === "string" && Array.isArray(v.orderBlocks);
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function toJournalDto(row: JournalEntry): JournalEntryDto {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    pair: row.pair as Pair,
    timeframe: row.timeframe as Timeframe,
    direction: row.direction as JournalDirection,
    status: row.status as JournalStatus,
    entryPrice: Number(row.entryPrice),
    stopPrice: Number(row.stopPrice),
    targetPrice: Number(row.targetPrice),
    target2Price: numOrNull(row.target2Price),
    plannedR: Number(row.plannedR),
    thesis: row.thesis,
    biasSnapshot: parseJson<JournalBiasSnapshot>(row.biasSnapshot, isBiasSnapshot),
    biasNote: row.biasNote,
    playbookSnapshot: parseJson<JournalPlaybookSnapshot>(row.playbookSnapshot, isPlaybookSnapshot),
    smcSnapshot: parseJson<JournalSmcSnapshot>(row.smcSnapshot, isSmcSnapshot),
    exitPrice: numOrNull(row.exitPrice),
    exitReason: (row.exitReason as JournalExitReason | null) ?? null,
    result: (row.result as JournalResult | null) ?? null,
    realizedR: numOrNull(row.realizedR),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    reviewNote: row.reviewNote,
    source: row.source as JournalSource,
    overrideReason: row.overrideReason,
    tags: strArr(row.tags),
  };
}

// --- Queries ---------------------------------------------------------------------

export async function listJournalEntries(query: JournalListQuery): Promise<JournalListResponse> {
  const where: Record<string, unknown> = {};
  if (query.pair) where.pair = query.pair;
  if (query.timeframe) where.timeframe = query.timeframe;
  if (query.status) where.status = query.status;
  if (query.result) where.result = query.result;
  if (query.from || query.to) {
    where.createdAt = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    };
  }
  const skip = (query.page - 1) * query.pageSize;
  const [rows, total] = await Promise.all([
    prisma.journalEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: query.pageSize,
    }),
    prisma.journalEntry.count({ where }),
  ]);
  return {
    entries: rows.map(toJournalDto),
    total,
    page: query.page,
    pageSize: query.pageSize,
    hasMore: skip + rows.length < total,
  };
}

export async function getJournalEntry(id: string): Promise<JournalEntryDto | null> {
  const row = await prisma.journalEntry.findUnique({ where: { id } });
  return row ? toJournalDto(row) : null;
}

export type StatsRow = Pick<
  JournalEntry,
  "pair" | "timeframe" | "direction" | "result" | "realizedR" | "playbookSnapshot"
>;

// --- Stats -----------------------------------------------------------------------

type Acc = JournalStatsBucket & { winSum: number; lossAbsSum: number };

function emptyAcc(): Acc {
  return {
    trades: 0, wins: 0, losses: 0, breakevens: 0,
    winRate: 0, avgWinR: 0, avgLossR: 0, expectancyR: 0,
    winSum: 0, lossAbsSum: 0,
  };
}

function addRow(acc: Acc, row: StatsRow): void {
  const r = numOrNull(row.realizedR) ?? 0;
  acc.trades += 1;
  if (row.result === "win") {
    acc.wins += 1;
    acc.winSum += r;
  } else if (row.result === "loss") {
    acc.losses += 1;
    acc.lossAbsSum += Math.abs(r);
  } else {
    acc.breakevens += 1;
  }
}

function finalize(acc: Acc): JournalStatsBucket {
  const scored = acc.wins + acc.losses;
  const winRate = acc.trades > 0 ? acc.wins / acc.trades : 0;
  const avgWinR = acc.wins > 0 ? acc.winSum / acc.wins : 0;
  const avgLossR = acc.losses > 0 ? acc.lossAbsSum / acc.losses : 0;
  // Expectancy uses win+loss as the denominator â€” breakevens neither add nor subtract.
  const expectancyR = scored > 0 ? winRate * avgWinR - (1 - winRate) * avgLossR : 0;
  return {
    trades: acc.trades,
    wins: acc.wins,
    losses: acc.losses,
    breakevens: acc.breakevens,
    winRate: roundR(winRate),
    avgWinR: roundR(avgWinR),
    avgLossR: roundR(avgLossR),
    expectancyR: roundR(expectancyR),
  };
}

function verdictOf(row: StatsRow): PlaybookVerdict | null {
  const snap = parseJson<JournalPlaybookSnapshot>(row.playbookSnapshot, isPlaybookSnapshot);
  return snap && (snap.verdict === "allow" || snap.verdict === "downgrade" || snap.verdict === "block")
    ? snap.verdict
    : null;
}

function gradeOf(row: StatsRow): string {
  const snap = parseJson<JournalPlaybookSnapshot>(row.playbookSnapshot, isPlaybookSnapshot);
  return snap?.grade ?? "none";
}

export async function computeJournalStats(opts: {
  from?: Date;
  to?: Date;
  includeOverrides: boolean;
}): Promise<JournalStatsResponse> {
  // Only closed win/loss/breakeven rows count. scratched, invalidated, expired
  // and open ideas/actives are never part of win rate or expectancy.
  const where: Record<string, unknown> = { status: "closed", result: { in: [...SCORED_RESULTS] } };
  if (opts.from || opts.to) {
    where.createdAt = {
      ...(opts.from ? { gte: opts.from } : {}),
      ...(opts.to ? { lte: opts.to } : {}),
    };
  }
  const [rows, openCount] = await Promise.all([
    prisma.journalEntry.findMany({
      where,
      select: {
        pair: true,
        timeframe: true,
        direction: true,
        result: true,
        realizedR: true,
        playbookSnapshot: true,
      },
    }),
    prisma.journalEntry.count({ where: { status: "active" } }),
  ]);

  // Blocked-idea overrides are excluded unless explicitly asked for.
  const kept = opts.includeOverrides ? rows : rows.filter((r) => verdictOf(r) !== "block");

  const totals = emptyAcc();
  const maps = {
    byPair: new Map<string, Acc>(),
    byTimeframe: new Map<string, Acc>(),
    byDirection: new Map<string, Acc>(),
    byGrade: new Map<string, Acc>(),
    byVerdict: new Map<string, Acc>(),
  };

  const bump = (m: Map<string, Acc>, key: string, row: StatsRow): void => {
    const acc = m.get(key) ?? emptyAcc();
    addRow(acc, row);
    m.set(key, acc);
  };

  for (const row of kept) {
    addRow(totals, row);
    bump(maps.byPair, row.pair, row);
    bump(maps.byTimeframe, row.timeframe, row);
    bump(maps.byDirection, row.direction, row);
    bump(maps.byGrade, gradeOf(row), row);
    bump(maps.byVerdict, verdictOf(row) ?? "none", row);
  }

  const out = (m: Map<string, Acc>): Record<string, JournalStatsBucket> => {
    const res: Record<string, JournalStatsBucket> = {};
    for (const [key, acc] of m) res[key] = finalize(acc);
    return res;
  };

  const bucket = finalize(totals);
  return {
    from: opts.from ? opts.from.toISOString() : null,
    to: opts.to ? opts.to.toISOString() : null,
    includeOverrides: opts.includeOverrides,
    openCount,
    trades: bucket.trades,
    wins: bucket.wins,
    losses: bucket.losses,
    breakevens: bucket.breakevens,
    winRate: bucket.winRate,
    avgWinR: bucket.avgWinR,
    avgLossR: bucket.avgLossR,
    expectancyR: bucket.expectancyR,
    breakdowns: {
      byPair: out(maps.byPair),
      byTimeframe: out(maps.byTimeframe),
      byDirection: out(maps.byDirection),
      byGrade: out(maps.byGrade),
      byVerdict: out(maps.byVerdict),
    },
  };
}

// --- Close outcome -----------------------------------------------------------------

export type CloseOutcome = {
  exitPrice: number | null;
  exitReason: JournalExitReason;
  result: JournalResult;
  realizedR: number | null;
  status: JournalStatus;
};

/**
 * Outcome math for a close. realizedR comes from the stored entry/stop and the
 * submitted exit â€” the client never supplies its own R. A missing exit price
 * (invalidated / expired / manual scratch) keeps realizedR null and the row is
 * excluded from win rate and expectancy by the stats query.
 */
export function computeCloseOutcome(input: {
  direction: JournalDirection;
  entryPrice: number;
  stopPrice: number;
  exitPrice: number | null;
  exitReason: JournalExitReason;
}): CloseOutcome {
  const status = statusForExitReason(input.exitReason);
  if (input.exitPrice === null) {
    return { ...input, result: "scratched", realizedR: null, status };
  }
  const realizedR = computeRealizedR(
    input.direction,
    input.entryPrice,
    input.stopPrice,
    input.exitPrice,
  );
  if (realizedR === null) {
    return { ...input, result: "scratched", realizedR: null, status };
  }
  return { ...input, result: classifyResult(realizedR), realizedR, status };
}
