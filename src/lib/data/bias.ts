import { prisma } from "./prisma";
import { PAIRS, type Pair } from "./universe";
import { getProviderModes } from "./config";
import { buildBiasResult, scoreBias } from "./fundamental/score";
import type { BiasFilters, RawBiasResult } from "./fundamental/score-types";
import { llmKeysPresent, rewriteWithLlm } from "./llm";
import { tagNews as tagNewsText } from "./providers/news";
import { getBiasSnapshotRows, getLatestBiasRow, saveBiasSnapshot, type SnapshotRow } from "./snapshots";

export type BiasResult = RawBiasResult;
export type { BiasFilters, SnapshotRow };

/**
 * Some rows were stored before tagging existed (empty pairTags/currencies).
 * Re-tag at read time from title + summary with the same currency→pair rules
 * the ingest uses, so old rows still score. Never mutates the database.
 */
function ensureTagged(row: {
  title: string;
  summary: string;
  currencies: unknown;
  pairTags: unknown;
}): { currencies: string[]; pairTags: Pair[] } {
  const currencies = Array.isArray(row.currencies) ? (row.currencies as string[]) : [];
  const pairTags = Array.isArray(row.pairTags) ? (row.pairTags as Pair[]) : [];
  if (pairTags.length > 0) return { currencies, pairTags };
  const tagged = tagNewsText(`${row.title} ${row.summary}`);
  return tagged.pairTags.length > 0 ? tagged : { currencies, pairTags };
}

export async function scorePair(pair: Pair, filters: BiasFilters = {}): Promise<BiasResult> {
  const [news, events, calRuns] = await Promise.all([
    prisma.newsItem.findMany({
      // Bias is fundamentals — never synthetic rows. Mock items carry
      // source "mock" and a "[MOCK]" title prefix (see providers/news.ts).
      where: { NOT: { OR: [{ source: "mock" }, { title: { startsWith: "[MOCK]" } }] } },
      orderBy: { publishedAt: "desc" },
      take: 200,
    }),
    prisma.calendarEvent.findMany({ orderBy: { scheduledAt: "asc" }, take: 100 }),
    prisma.ingestRun.findMany({
      where: { kind: "calendar" },
      orderBy: { startedAt: "desc" },
      take: 1,
      select: { status: true },
    }),
  ]);
  // Seeded sample events (source "mock") must never masquerade as the upcoming
  // next event when a live calendar feed is configured — or when the feed's
  // latest run failed. In deliberate mock mode they remain the only data.
  const calLive = getProviderModes().calendar.mode === "live";
  const calFailed = calRuns.length > 0 && calRuns[0].status === "failed";
  const hideSeedEvents = calLive || calFailed;
  const usableEvents = events.filter((e) => {
    if (hideSeedEvents && e.source === "mock") return false;
    // Each pair only sees events mapped onto it (USD → all four, EUR → EURUSD…).
    const affected = Array.isArray(e.affectedPairs) ? (e.affectedPairs as string[]) : [];
    return affected.includes(pair);
  });
  const scored = scoreBias(
    pair,
    news.map((n) => {
      const tagged = ensureTagged(n);
      return {
        url: n.url, source: n.source, title: n.title, summary: n.summary, rawText: n.rawText,
        publishedAt: n.publishedAt,
        currencies: tagged.currencies,
        pairTags: tagged.pairTags,
        impactScore: n.impactScore,
      };
    }),
    usableEvents.map((e) => ({
      externalId: e.externalId, title: e.title, country: e.country, currency: e.currency,
      impact: (e.impact === "high" || e.impact === "low" ? e.impact : "medium") as "low" | "medium" | "high",
      scheduledAt: e.scheduledAt, actual: e.actual, forecast: e.forecast, previous: e.previous,
      source: e.source, affectedPairs: Array.isArray(e.affectedPairs) ? (e.affectedPairs as Pair[]) : [],
    })),
    filters,
  );
  let result = buildBiasResult(pair, scored);
  if (llmKeysPresent()) {
    const newsSnippets = news.slice(0, 8).map((n) => `${n.title} (${n.source})`);
    const eventSnippets = events.slice(0, 6).map((e) => `${e.title} [${e.impact}]`);
    result = await rewriteWithLlm(result, newsSnippets, eventSnippets, filters);
  }
  await saveBiasSnapshot(result);
  return result;
}

export async function recomputeAllPairs(pairs: readonly Pair[] = PAIRS, filters: BiasFilters = {}): Promise<BiasResult[]> {
  const out: BiasResult[] = [];
  for (const pair of pairs) {
    try {
      out.push(await scorePair(pair, filters));
    } catch (err) {
      console.error(`[desk] recompute failed for ${pair}:`, err);
      out.push({ pair, bias: "neutral", confidence: 0, drivers: [], nextEvent: null, invalidation: "Scoring failed; stored data unchanged.", asOf: new Date(), method: "rules-v1", usedLlm: false });
    }
  }
  return out;
}

export async function getLatestBias(pair: Pair): Promise<BiasResult | null> {
  const row = await getLatestBiasRow(pair);
  if (!row) return null;
  return rowToBiasResult(row);
}

export async function getBiasSnapshots(limit = 20): Promise<BiasResult[]> {
  const rows = await getBiasSnapshotRows(limit);
  // Rows arrive newest-first; keep only the newest snapshot per pair so
  // consumers that group by pair never see an older run win the Map.
  const seen = new Set<string>();
  const newestPerPair = rows.filter((row) => {
    if (seen.has(row.pair)) return false;
    seen.add(row.pair);
    return true;
  });
  return newestPerPair.map(rowToBiasResult).filter((r): r is BiasResult => r !== null);
}

function rowToBiasResult(row: SnapshotRow): BiasResult | null {
  try {
    const driversRaw = typeof row.drivers === "string" ? JSON.parse(row.drivers) : row.drivers;
    const nextRaw = row.nextEvent == null || (typeof row.nextEvent === "string" && row.nextEvent === "")
      ? null
      : typeof row.nextEvent === "string" ? JSON.parse(row.nextEvent) : row.nextEvent;
    const drivers = (Array.isArray(driversRaw) ? driversRaw : []) as BiasResult["drivers"];
    let nextEvent: BiasResult["nextEvent"] = null;
    if (nextRaw && typeof nextRaw === "object") {
      const n = nextRaw as Record<string, unknown>;
      const scheduledAt = typeof n.scheduledAt === "string" ? new Date(n.scheduledAt)
        : n.scheduledAt instanceof Date ? n.scheduledAt : null;
      if (typeof n.title === "string" && scheduledAt && !Number.isNaN(scheduledAt.getTime())) {
        nextEvent = {
          currency: typeof n.currency === "string" ? n.currency : "",
          dir: "neutral",
          headline: n.title,
          impact: typeof n.impact === "string" ? n.impact : "medium",
          actual: typeof n.actual === "string" ? n.actual : null,
          forecast: typeof n.forecast === "string" ? n.forecast : null,
          previous: typeof n.previous === "string" ? n.previous : null,
          scheduledAt,
          actualPrinted: typeof n.actual === "string" && n.actual !== "",
          surprise: null,
        };
      }
    }
    return {
      pair: row.pair as Pair,
      bias: row.bias as BiasResult["bias"],
      confidence: row.confidence,
      drivers,
      nextEvent,
      invalidation: row.invalidation,
      asOf: row.asOf instanceof Date ? row.asOf : new Date(row.asOf),
      method: "rules-v1",
      usedLlm: row.usedLlm,
    };
  } catch {
    return null;
  }
}
