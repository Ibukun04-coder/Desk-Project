import { z } from "zod";
import type { Impact, IngestKind, IngestStatus } from "./types";
import { getProviderModes, type ProviderModes } from "./config";
import { prisma } from "./prisma";
import { PAIRS, PAIR_DISPLAY, TIMEFRAMES, type Pair, type Timeframe } from "./universe";

// Read APIs shared by the HTTP routes and the Data Health page.
// All query params are validated with Zod at the route edge (400 on bad input).

const isoDateTime = z.union([
  z.string().datetime({ offset: true }),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected ISO date or date-time (UTC)"),
]);

const impactSchema = z
  .enum(["low", "med", "medium", "high"])
  .transform((v): Impact => (v === "med" ? "medium" : v));

export const candlesQuerySchema = z.object({
  symbol: z.enum(PAIRS),
  timeframe: z.enum(TIMEFRAMES),
  limit: z.coerce.number().int().min(1).max(5000).default(500),
});
export type CandlesQuery = z.infer<typeof candlesQuerySchema>;

export const calendarQuerySchema = z.object({
  from: isoDateTime.optional().transform((v) => (v ? new Date(v) : undefined)),
  to: isoDateTime.optional().transform((v) => (v ? new Date(v) : undefined)),
  impact: impactSchema.optional(),
});
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

export const newsQuerySchema = z.object({
  pair: z.enum(PAIRS).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
export type NewsQuery = z.infer<typeof newsQuerySchema>;

// --- DTOs ---------------------------------------------------------------------

export type CandleDto = {
  symbol: Pair;
  timeframe: Timeframe;
  openTime: string; // ISO, UTC
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string | null;
  provider: string;
};

export type CalendarEventDto = {
  id: string;
  externalId: string;
  title: string;
  country: string;
  currency: string;
  impact: Impact;
  scheduledAt: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  source: string;
  affectedPairs: Pair[];
};

export type NewsItemDto = {
  id: string;
  url: string;
  source: string;
  title: string;
  summary: string;
  rawText: string;
  publishedAt: string;
  currencies: string[];
  pairTags: Pair[];
  impactScore: number;
};

function jsonStringArray(value: unknown): string[] {
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value as string[];
  return [];
}

function jsonPairArray(value: unknown): Pair[] {
  return jsonStringArray(value).filter((v): v is Pair => (PAIRS as readonly string[]).includes(v));
}

// --- Queries -------------------------------------------------------------------

export async function getCandles(query: CandlesQuery): Promise<CandleDto[]> {
  const rows = await prisma.candle.findMany({
    where: { symbol: query.symbol, timeframe: query.timeframe },
    orderBy: { openTime: "desc" },
    take: query.limit,
  });
  return rows.reverse().map((row) => ({
    symbol: row.symbol as Pair,
    timeframe: row.timeframe as Timeframe,
    openTime: row.openTime.toISOString(),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    provider: row.provider,
  }));
}

export async function getCalendar(query: CalendarQuery): Promise<CalendarEventDto[]> {
  const from = query.from ?? new Date(Date.now() - 86_400_000);
  const to = query.to ?? new Date(Date.now() + 14 * 86_400_000);
  const rows = await prisma.calendarEvent.findMany({
    where: {
      scheduledAt: { gte: from, lte: to },
      ...(query.impact ? { impact: query.impact } : {}),
    },
    orderBy: { scheduledAt: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    externalId: row.externalId,
    title: row.title,
    country: row.country,
    currency: row.currency,
    impact: row.impact as Impact,
    scheduledAt: row.scheduledAt.toISOString(),
    actual: row.actual,
    forecast: row.forecast,
    previous: row.previous,
    source: row.source,
    affectedPairs: jsonPairArray(row.affectedPairs),
  }));
}

export async function getNews(query: NewsQuery): Promise<NewsItemDto[]> {
  // pairTags is JSON — SQLite JSON path filters are limited, so filter in memory
  // over the most recent 1000 items (plenty for Phase 1 volumes).
  const rows = await prisma.newsItem.findMany({
    orderBy: { publishedAt: "desc" },
    take: 1000,
  });
  const pair = query.pair;
  const filtered = pair
    ? rows.filter((row) => jsonPairArray(row.pairTags).includes(pair))
    : rows;
  return filtered.slice(0, query.limit).map((row) => ({
    id: row.id,
    url: row.url,
    source: row.source,
    title: row.title,
    summary: row.summary,
    rawText: row.rawText,
    publishedAt: row.publishedAt.toISOString(),
    currencies: jsonStringArray(row.currencies),
    pairTags: jsonPairArray(row.pairTags),
    impactScore: row.impactScore,
  }));
}

export type UniverseDto = {
  pairs: Array<{ symbol: Pair; display: string }>;
  timeframes: Timeframe[];
  providers: ProviderModes;
};

export function getUniverse(): UniverseDto {
  return {
    pairs: PAIRS.map((symbol) => ({ symbol, display: PAIR_DISPLAY[symbol] })),
    timeframes: [...TIMEFRAMES],
    providers: getProviderModes(),
  };
}

// --- Data health ----------------------------------------------------------------

export type StoredRunStats = {
  fetched?: number;
  inserted?: number;
  updated?: number;
  skipped?: number;
  failedCalls?: number;
  errors?: string[];
  provider?: string;
  mock?: boolean;
};

export type LastRunDto = {
  kind: IngestKind;
  status: IngestStatus;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  stats: StoredRunStats;
};

export type CandleCountDto = { symbol: Pair; timeframe: Timeframe; count: number };

export type DataHealthDto = {
  generatedAt: string;
  modes: ProviderModes;
  lastRuns: LastRunDto[];
  candleCounts: CandleCountDto[];
  totalCandles: number;
};

function parseStoredStats(value: unknown): StoredRunStats {
  if (typeof value !== "object" || value === null) return {};
  const rec = value as Record<string, unknown>;
  const num = (k: string): number | undefined =>
    typeof rec[k] === "number" ? (rec[k] as number) : undefined;
  return {
    fetched: num("fetched"),
    inserted: num("inserted"),
    updated: num("updated"),
    skipped: num("skipped"),
    failedCalls: num("failedCalls"),
    errors: Array.isArray(rec.errors)
      ? rec.errors.filter((e): e is string => typeof e === "string")
      : undefined,
    provider: typeof rec.provider === "string" ? rec.provider : undefined,
    mock: typeof rec.mock === "boolean" ? rec.mock : undefined,
  };
}

export async function getDataHealth(): Promise<DataHealthDto> {
  const kinds: IngestKind[] = ["price", "calendar", "news"];
  const [runs, grouped] = await Promise.all([
    Promise.all(
      kinds.map((kind) =>
        prisma.ingestRun.findFirst({ where: { kind }, orderBy: { startedAt: "desc" } }),
      ),
    ),
    prisma.candle.groupBy({ by: ["symbol", "timeframe"], _count: { _all: true } }),
  ]);

  const symbolOrder = new Map(PAIRS.map((p, i) => [p, i]));
  const timeframeOrder = new Map(TIMEFRAMES.map((t, i) => [t, i]));
  const candleCounts: CandleCountDto[] = grouped
    .map((g) => ({
      symbol: g.symbol as Pair,
      timeframe: g.timeframe as Timeframe,
      count: g._count._all,
    }))
    .sort(
      (a, b) =>
        (symbolOrder.get(a.symbol) ?? 99) - (symbolOrder.get(b.symbol) ?? 99) ||
        (timeframeOrder.get(a.timeframe) ?? 99) - (timeframeOrder.get(b.timeframe) ?? 99),
    );

  return {
    generatedAt: new Date().toISOString(),
    modes: getProviderModes(),
    lastRuns: runs.flatMap((run) =>
      run
        ? [
            {
              kind: run.kind as IngestKind,
              status: run.status as IngestStatus,
              startedAt: run.startedAt.toISOString(),
              finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
              error: run.error,
              stats: parseStoredStats(run.stats),
            },
          ]
        : [],
    ),
    candleCounts,
    totalCandles: candleCounts.reduce((sum, c) => sum + c.count, 0),
  };
}
