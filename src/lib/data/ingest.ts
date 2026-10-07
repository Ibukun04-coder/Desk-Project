import type { PriceProviderName } from "./config";
import type {
  CalendarEventInput,
  CandleInput,
  IngestKind,
  IngestResult,
  IngestStats,
  IngestStatus,
  NewsItemInput,
} from "./types";
import { prisma } from "./prisma";
import { sleep } from "./providers/http";
import { getPriceProvider, PRICE_PROVIDER_DELAY_MS } from "./providers/price";
import { getCalendarProvider } from "./providers/calendar";
import { getNewsProvider } from "./providers/news";
import { PAIRS, TIMEFRAMES } from "./universe";

// All ingest jobs are idempotent: upserts keyed on natural keys, IngestRun rows
// bookkeeping every attempt, and a provider failure never deletes stored data.

const CANDLE_FETCH_LIMIT = 500;
const CALENDAR_LOOKBACK_DAYS = 3;
const CALENDAR_LOOKAHEAD_DAYS = 14;
const NEWS_FETCH_LIMIT = 100;
const MAX_STORED_ERRORS = 10;
const UPSERT_CHUNK = 400;

function emptyStats(): IngestStats {
  return { fetched: 0, inserted: 0, updated: 0, skipped: 0, failedCalls: 0, errors: [] };
}

function pushError(stats: IngestStats, message: string): void {
  if (stats.errors.length < MAX_STORED_ERRORS) stats.errors.push(message);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2002"
  );
}

function deriveStatus(stats: IngestStats): IngestStatus {
  if (stats.failedCalls > 0) {
    return stats.inserted + stats.updated + stats.skipped > 0 ? "partial" : "failed";
  }
  return "success";
}

async function startRun(kind: IngestKind): Promise<string> {
  const row = await prisma.ingestRun.create({
    data: { kind, status: "running", startedAt: new Date() },
  });
  return row.id;
}

function toJson(stats: IngestStats, provider: string, mock: boolean): {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  failedCalls: number;
  errors: string[];
  provider: string;
  mock: boolean;
} {
  return {
    fetched: stats.fetched,
    inserted: stats.inserted,
    updated: stats.updated,
    skipped: stats.skipped,
    failedCalls: stats.failedCalls,
    errors: stats.errors,
    provider,
    mock,
  };
}

async function finishRun(
  runId: string,
  kind: IngestKind,
  status: IngestStatus,
  provider: string,
  mock: boolean,
  startedAt: Date,
  stats: IngestStats,
): Promise<IngestResult> {
  const finishedAt = new Date();
  await prisma.ingestRun.update({
    where: { id: runId },
    data: {
      status,
      finishedAt,
      error: stats.errors.length > 0 ? stats.errors.join(" | ") : null,
      stats: toJson(stats, provider, mock),
    },
  });
  return {
    runId,
    kind,
    status,
    provider,
    mock,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    stats,
  };
}

type CandleCounts = { inserted: number; updated: number; skipped: number };

function candleCreateRow(candle: CandleInput, provider: string) {
  return {
    symbol: candle.symbol,
    timeframe: candle.timeframe,
    openTime: candle.openTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    provider,
  };
}

function candleUnchanged(
  row: { open: string; high: string; low: string; close: string; volume: string | null },
  candle: CandleInput,
): boolean {
  return (
    row.open === candle.open &&
    row.high === candle.high &&
    row.low === candle.low &&
    row.close === candle.close &&
    row.volume === candle.volume
  );
}

/** Upsert candles by (symbol, timeframe, openTime). Counts insert/update/skip. */
async function upsertCandles(candles: CandleInput[], provider: string): Promise<CandleCounts> {
  const counts: CandleCounts = { inserted: 0, updated: 0, skipped: 0 };
  const groups = new Map<string, CandleInput[]>();
  for (const candle of candles) {
    const key = `${candle.symbol}|${candle.timeframe}`;
    const group = groups.get(key);
    if (group) group.push(candle);
    else groups.set(key, [candle]);
  }
  for (const group of groups.values()) {
    const { symbol, timeframe } = group[0];
    for (const batch of chunk(group, UPSERT_CHUNK)) {
      const times = batch.map((c) => c.openTime);
      const existing = await prisma.candle.findMany({
        where: { symbol, timeframe, openTime: { in: times } },
        select: { id: true, openTime: true, open: true, high: true, low: true, close: true, volume: true },
      });
      const byTime = new Map(existing.map((row) => [row.openTime.getTime(), row]));
      const toInsert: CandleInput[] = [];
      const toUpdate: Array<{ id: string; candle: CandleInput }> = [];
      for (const candle of batch) {
        const row = byTime.get(candle.openTime.getTime());
        if (!row) {
          toInsert.push(candle);
        } else if (candleUnchanged(row, candle)) {
          counts.skipped++;
        } else {
          toUpdate.push({ id: row.id, candle });
        }
      }
      if (toInsert.length > 0) {
        try {
          await prisma.candle.createMany({ data: toInsert.map((c) => candleCreateRow(c, provider)) });
          counts.inserted += toInsert.length;
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          // Lost a race with a concurrent ingest â€” fall back to per-row upsert.
          for (const candle of toInsert) {
            const where = {
              symbol_timeframe_openTime: {
                symbol: candle.symbol,
                timeframe: candle.timeframe,
                openTime: candle.openTime,
              },
            };
            await prisma.candle.upsert({
              where,
              update: candleCreateRow(candle, provider),
              create: candleCreateRow(candle, provider),
            });
            counts.inserted++;
          }
        }
      }
      for (const { id, candle } of toUpdate) {
        await prisma.candle.update({ where: { id }, data: candleCreateRow(candle, provider) });
        counts.updated++;
      }
    }
  }
  return counts;
}

type EventCounts = CandleCounts;

async function upsertCalendarEvents(events: CalendarEventInput[]): Promise<EventCounts> {
  const counts: EventCounts = { inserted: 0, updated: 0, skipped: 0 };
  for (const batch of chunk(events, UPSERT_CHUNK)) {
    const ids = batch.map((e) => e.externalId);
    const existing = await prisma.calendarEvent.findMany({
      where: { externalId: { in: ids } },
      select: {
        id: true,
        externalId: true,
        title: true,
        country: true,
        currency: true,
        impact: true,
        scheduledAt: true,
        actual: true,
        forecast: true,
        previous: true,
        affectedPairs: true,
      },
    });
    const byId = new Map(existing.map((row) => [row.externalId, row]));
    const toInsert: CalendarEventInput[] = [];
    const toUpdate: Array<{ id: string; event: CalendarEventInput }> = [];
    for (const event of batch) {
      const row = byId.get(event.externalId);
      if (!row) {
        toInsert.push(event);
        continue;
      }
      const unchanged =
        row.title === event.title &&
        row.country === event.country &&
        row.currency === event.currency &&
        row.impact === event.impact &&
        row.scheduledAt.getTime() === event.scheduledAt.getTime() &&
        row.actual === event.actual &&
        row.forecast === event.forecast &&
        row.previous === event.previous &&
        JSON.stringify(row.affectedPairs) === JSON.stringify(event.affectedPairs);
      if (unchanged) counts.skipped++;
      else toUpdate.push({ id: row.id, event });
    }
    if (toInsert.length > 0) {
      try {
        await prisma.calendarEvent.createMany({
          data: toInsert.map((e) => ({
            externalId: e.externalId,
            title: e.title,
            country: e.country,
            currency: e.currency,
            impact: e.impact,
            scheduledAt: e.scheduledAt,
            actual: e.actual,
            forecast: e.forecast,
            previous: e.previous,
            source: e.source,
            affectedPairs: e.affectedPairs,
          })),
        });
        counts.inserted += toInsert.length;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        for (const event of toInsert) {
          await prisma.calendarEvent.upsert({
            where: { externalId: event.externalId },
            update: eventUpdateData(event),
            create: eventCreateData(event),
          });
          counts.inserted++;
        }
      }
    }
    for (const { id, event } of toUpdate) {
      await prisma.calendarEvent.update({ where: { id }, data: eventUpdateData(event) });
      counts.updated++;
    }
  }
  return counts;
}

function eventCreateData(event: CalendarEventInput) {
  return {
    externalId: event.externalId,
    title: event.title,
    country: event.country,
    currency: event.currency,
    impact: event.impact,
    scheduledAt: event.scheduledAt,
    actual: event.actual,
    forecast: event.forecast,
    previous: event.previous,
    source: event.source,
    affectedPairs: event.affectedPairs,
  };
}

function eventUpdateData(event: CalendarEventInput) {
  const { externalId: _externalId, ...rest } = eventCreateData(event);
  return rest;
}

async function upsertNewsItems(items: NewsItemInput[]): Promise<EventCounts> {
  const counts: EventCounts = { inserted: 0, updated: 0, skipped: 0 };
  for (const batch of chunk(items, UPSERT_CHUNK)) {
    const urls = batch.map((n) => n.url);
    const existing = await prisma.newsItem.findMany({
      where: { url: { in: urls } },
      select: {
        id: true,
        url: true,
        title: true,
        summary: true,
        rawText: true,
        publishedAt: true,
        currencies: true,
        pairTags: true,
        impactScore: true,
      },
    });
    const byUrl = new Map(existing.map((row) => [row.url, row]));
    const toInsert: NewsItemInput[] = [];
    const toUpdate: Array<{ id: string; item: NewsItemInput }> = [];
    for (const item of batch) {
      const row = byUrl.get(item.url);
      if (row) {
        const unchanged =
          row.title === item.title &&
          row.summary === item.summary &&
          row.rawText === item.rawText &&
          row.publishedAt.getTime() === item.publishedAt.getTime() &&
          row.impactScore === item.impactScore &&
          JSON.stringify(row.currencies) === JSON.stringify(item.currencies) &&
          JSON.stringify(row.pairTags) === JSON.stringify(item.pairTags);
        if (unchanged) counts.skipped++;
        else toUpdate.push({ id: row.id, item });
        continue;
      }
      // Dedupe rule 2: same (source, title, publishedAt) under a different url.
      const twin = await prisma.newsItem.findFirst({
        where: {
          source: item.source,
          title: item.title,
          publishedAt: item.publishedAt,
        },
        select: { id: true },
      });
      if (twin) counts.skipped++;
      else toInsert.push(item);
    }
    if (toInsert.length > 0) {
      try {
        await prisma.newsItem.createMany({ data: toInsert.map(newsCreateData) });
        counts.inserted += toInsert.length;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        for (const item of toInsert) {
          await prisma.newsItem.upsert({
            where: { url: item.url },
            update: newsUpdateData(item),
            create: newsCreateData(item),
          });
          counts.inserted++;
        }
      }
    }
    for (const { id, item } of toUpdate) {
      await prisma.newsItem.update({ where: { id }, data: newsUpdateData(item) });
      counts.updated++;
    }
  }
  return counts;
}

function newsCreateData(item: NewsItemInput) {
  return {
    url: item.url,
    source: item.source,
    title: item.title,
    summary: item.summary,
    rawText: item.rawText,
    publishedAt: item.publishedAt,
    currencies: item.currencies,
    pairTags: item.pairTags,
    impactScore: item.impactScore,
  };
}

function newsUpdateData(item: NewsItemInput) {
  const { url: _url, ...rest } = newsCreateData(item);
  return rest;
}

// --- Runners -------------------------------------------------------------------

export async function runPriceIngest(): Promise<IngestResult> {
  const provider = getPriceProvider();
  const startedAt = new Date();
  const runId = await startRun("price");
  const stats = emptyStats();
  const delayMs = PRICE_PROVIDER_DELAY_MS[provider.name as PriceProviderName] ?? 0;

  const combos: Array<{ symbol: (typeof PAIRS)[number]; timeframe: (typeof TIMEFRAMES)[number] }> = [];
  for (const symbol of PAIRS) for (const timeframe of TIMEFRAMES) combos.push({ symbol, timeframe });

  let index = 0;
  for (const { symbol, timeframe } of combos) {
    index++;
    try {
      const candles = await provider.fetchCandles({ symbol, timeframe, limit: CANDLE_FETCH_LIMIT });
      stats.fetched += candles.length;
      const counts = await upsertCandles(candles, provider.name);
      stats.inserted += counts.inserted;
      stats.updated += counts.updated;
      stats.skipped += counts.skipped;
    } catch (err) {
      // One broken symbol/timeframe never aborts the rest of the universe.
      stats.failedCalls++;
      pushError(stats, `${symbol}/${timeframe}: ${messageOf(err)}`);
    }
    if (delayMs > 0 && index < combos.length) await sleep(delayMs);
  }

  const status = deriveStatus(stats);
  const result = await finishRun(runId, "price", status, provider.name, provider.isMock, startedAt, stats);
  console.log(
    `[desk] ingest price (${provider.name}) ${status}: fetched=${stats.fetched} inserted=${stats.inserted} updated=${stats.updated} skipped=${stats.skipped} failed=${stats.failedCalls}`,
  );
  return result;
}

export async function runCalendarIngest(): Promise<IngestResult> {
  const provider = getCalendarProvider();
  const startedAt = new Date();
  const runId = await startRun("calendar");
  const stats = emptyStats();
  const from = new Date(startedAt.getTime() - CALENDAR_LOOKBACK_DAYS * 86_400_000);
  const to = new Date(startedAt.getTime() + CALENDAR_LOOKAHEAD_DAYS * 86_400_000);

  try {
    const events = await provider.fetchEvents({ from, to });
    stats.fetched += events.length;
    const counts = await upsertCalendarEvents(events);
    stats.inserted += counts.inserted;
    stats.updated += counts.updated;
    stats.skipped += counts.skipped;
  } catch (err) {
    stats.failedCalls++;
    pushError(stats, messageOf(err));
  }

  const status = deriveStatus(stats);
  const result = await finishRun(
    runId,
    "calendar",
    status,
    provider.name,
    provider.isMock,
    startedAt,
    stats,
  );
  console.log(
    `[desk] ingest calendar (${provider.name}) ${status}: fetched=${stats.fetched} inserted=${stats.inserted} updated=${stats.updated} skipped=${stats.skipped} failed=${stats.failedCalls}`,
  );
  return result;
}

export async function runNewsIngest(): Promise<IngestResult> {
  const provider = getNewsProvider();
  const startedAt = new Date();
  const runId = await startRun("news");
  const stats = emptyStats();

  try {
    const items = await provider.fetchNews({ limit: NEWS_FETCH_LIMIT });
    stats.fetched += items.length;
    const counts = await upsertNewsItems(items);
    stats.inserted += counts.inserted;
    stats.updated += counts.updated;
    stats.skipped += counts.skipped;
  } catch (err) {
    stats.failedCalls++;
    pushError(stats, messageOf(err));
  }

  const status = deriveStatus(stats);
  const result = await finishRun(runId, "news", status, provider.name, provider.isMock, startedAt, stats);
  console.log(
    `[desk] ingest news (${provider.name}) ${status}: fetched=${stats.fetched} inserted=${stats.inserted} updated=${stats.updated} skipped=${stats.skipped} failed=${stats.failedCalls}`,
  );
  return result;
}

/** Sequential so a slow feed cannot starve the others. */
export async function runAllIngest(): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  results.push(await runPriceIngest());
  results.push(await runCalendarIngest());
  results.push(await runNewsIngest());
  return results;
}
