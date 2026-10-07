import { prisma } from "./prisma";
import { PAIRS, type Pair } from "./universe";
import { buildBiasResult, scoreBias } from "./fundamental/score";
import type { BiasFilters, RawBiasResult } from "./fundamental/score-types";
import { llmKeysPresent, rewriteWithLlm } from "./llm";
import { getBiasSnapshotRows, getLatestBiasRow, saveBiasSnapshot, type SnapshotRow } from "./snapshots";

export type BiasResult = RawBiasResult;
export type { BiasFilters, SnapshotRow };

export async function scorePair(pair: Pair, filters: BiasFilters = {}): Promise<BiasResult> {
  const [news, events] = await Promise.all([
    prisma.newsItem.findMany({ orderBy: { publishedAt: "desc" }, take: 200 }),
    prisma.calendarEvent.findMany({ orderBy: { scheduledAt: "asc" }, take: 100 }),
  ]);
  const scored = scoreBias(
    pair,
    news.map((n) => ({
      url: n.url, source: n.source, title: n.title, summary: n.summary, rawText: n.rawText,
      publishedAt: n.publishedAt,
      currencies: Array.isArray(n.currencies) ? (n.currencies as string[]) : [],
      pairTags: Array.isArray(n.pairTags) ? (n.pairTags as Pair[]) : [],
      impactScore: n.impactScore,
    })),
    events.map((e) => ({
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
  return rows.map(rowToBiasResult).filter((r): r is BiasResult => r !== null);
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
