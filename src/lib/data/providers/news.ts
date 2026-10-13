import { z } from "zod";
import { getEnv, logOnce, resolveNewsProvider } from "../config";
import { clamp } from "../hash";
import type { FetchNewsParams, NewsItemInput, NewsProvider } from "../types";
import { pairsForCodes, type Pair } from "../universe";
import { fetchJsonWithRetry } from "./http";
import { fetchAllRss, stripHtml, type RssFeedEntry } from "./rss";

// --- Tagging -----------------------------------------------------------------

const CURRENCY_RULES: ReadonlyArray<{ code: string; pattern: RegExp }> = [
  { code: "USD", pattern: /\bUSD\b|dollar|Federal Reserve|\bFed\b|greenback/i },
  { code: "EUR", pattern: /\bEUR\b|euro|ECB|European Central Bank/i },
  { code: "GBP", pattern: /\bGBP\b|sterling|\bpound\b|Bank of England|\bBoE\b/i },
  { code: "JPY", pattern: /\bJPY\b|yen|Bank of Japan|\bBoJ\b/i },
  { code: "XAU", pattern: /\bXAU\b|\bgold\b/i },
];

export function tagNews(text: string): { currencies: string[]; pairTags: Pair[] } {
  const currencies = CURRENCY_RULES.filter((rule) => rule.pattern.test(text)).map(
    (rule) => rule.code,
  );
  return { currencies, pairTags: pairsForCodes(currencies) };
}

export function scoreImpact(text: string, sourceBoost: number, currencyCount: number): number {
  let score = 30 + sourceBoost + Math.min(currencyCount, 3) * 4;
  if (/(rate decision|fomc|interest rate|monetary policy|central bank)/i.test(text)) score += 20;
  if (/(non-?farm|payroll)/i.test(text)) score += 18;
  if (/\bcpi\b|inflation/i.test(text)) score += 15;
  if (/\bgdp\b/i.test(text)) score += 10;
  if (/(unemployment|jobless)/i.test(text)) score += 8;
  if (/\bpmi\b/i.test(text)) score += 6;
  if (/intervention/i.test(text)) score += 10;
  return clamp(Math.round(score), 0, 100);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// --- Deterministic mock news --------------------------------------------------

type MockNewsTemplate = {
  slug: string;
  title: string;
  text: string;
  currencies: string[];
};

const MOCK_NEWS: MockNewsTemplate[] = [
  { slug: "fed-patience", title: "Fed officials signal patience on rate cuts as inflation cools", text: "Several Federal Reserve policymakers said they are in no rush to cut rates, citing steady inflation progress and a resilient labor market.", currencies: ["USD"] },
  { slug: "ecb-caution", title: "ECB's Lagarde warns against premature easing", text: "President Lagarde said the European Central Bank must see more evidence that inflation is durably heading back to target before easing policy.", currencies: ["EUR"] },
  { slug: "boe-wages", title: "BoE holds Bank Rate, points to wage growth", text: "The Bank of England left rates unchanged and highlighted wage growth as the key upside risk to its inflation outlook.", currencies: ["GBP"] },
  { slug: "boj-normalization", title: "BoJ hints at further policy normalization; yen firms", text: "Bank of Japan officials reiterated they will continue adjusting policy if the economic outlook holds, lifting the yen across the board.", currencies: ["JPY"] },
  { slug: "us-cpi-cool", title: "US CPI comes in cooler than expected; dollar slides", text: "US CPI printed below forecasts, sending the dollar lower against the euro, sterling and the yen as traders priced in earlier Fed cuts.", currencies: ["USD", "EUR", "GBP", "JPY"] },
  { slug: "nfp-preview", title: "NFP preview: economists look for 185K jobs", text: "Consensus expects non-farm payrolls near 185K with unemployment steady at 4.2%; a hot print would revive dollar strength.", currencies: ["USD"] },
  { slug: "gold-real-yields", title: "Gold holds near highs as real yields drift lower", text: "XAUUSD stayed close to record territory as real yields eased and safe-haven demand remained firm amid geopolitical uncertainty.", currencies: ["XAU", "USD"] },
  { slug: "ez-pmi", title: "Eurozone PMI slips; EURUSD presses lower", text: "Flash eurozone manufacturing PMI missed expectations, pushing EURUSD toward the bottom of its recent range.", currencies: ["EUR", "USD"] },
  { slug: "usdjpy-intervention", title: "Intervention fears return as USDJPY tests highs", text: "Traders are on watch for yen intervention as USDJPY approaches levels that previously drew verbal warnings from Japanese officials.", currencies: ["JPY", "USD"] },
  { slug: "uk-cpi-eases", title: "UK inflation eases; pound outperforms G10", text: "British CPI cooled more than forecast, but the pound led G10 gains as BoE rate-cut bets were pushed back.", currencies: ["GBP"] },
  { slug: "fomc-minutes", title: "FOMC minutes show divisions over the pace of cuts", text: "Minutes of the last Federal Reserve meeting revealed a split committee on how quickly to ease policy through the rest of the year.", currencies: ["USD"] },
  { slug: "risk-tone", title: "Risk sentiment improves; yen and gold steady", text: "Equities firmed on softer rate expectations while the yen and gold held firm as hedges against a policy mistake.", currencies: ["JPY", "XAU"] },
];

function generateMockNews(limit: number): NewsItemInput[] {
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  // Anchor at 04:00 UTC today, stepping back 90 minutes per item — fully
  // deterministic for a given UTC day so re-ingests upsert instead of churn.
  const anchorMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 4, 0);
  const out: NewsItemInput[] = [];
  MOCK_NEWS.slice(0, limit).forEach((template, index) => {
    const publishedAt = new Date(anchorMs - index * 90 * 60 * 1000);
    const pairTags = pairsForCodes(template.currencies);
    if (pairTags.length === 0) return;
    out.push({
      url: `mock-news://desk/${dateKey}/${template.slug}`,
      source: "mock",
      title: template.title,
      summary: truncate(template.text, 400),
      rawText: template.text,
      publishedAt,
      currencies: template.currencies,
      pairTags,
      impactScore: 45 + ((index * 7) % 50),
    });
  });
  return out;
}

// --- Live sources -------------------------------------------------------------

const finnhubNewsSchema = z.union([
  z.array(
    z.object({
      headline: z.string(),
      url: z.string(),
      source: z.string().optional(),
      summary: z.string().optional(),
      datetime: z.number().optional(),
    }),
  ),
  z.object({
    news: z.array(
      z.object({
        headline: z.string(),
        url: z.string(),
        source: z.string().optional(),
        summary: z.string().optional(),
        datetime: z.number().optional(),
      }),
    ),
  }),
]);

async function fetchFinnhubNews(apiKey: string): Promise<NewsItemInput[]> {
  // Try the forex category first; free keys often only allow `general`, so
  // fall back to it and filter for macro/forex headlines. If neither yields
  // tagged items, return [] — the ingest layer keeps news on mock and the
  // banner says so. Never scrape random sites.
  for (const category of ["forex", "general"] as const) {
    try {
      const items = await fetchFinnhubNewsCategory(apiKey, category);
      if (items.length > 0) return items;
    } catch (err) {
      logOnce(`[desk] finnhub-news (${category}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return [];
}

async function fetchFinnhubNewsCategory(apiKey: string, category: "forex" | "general"): Promise<NewsItemInput[]> {
  const url = `https://finnhub.io/api/v1/news?category=${category}&token=${apiKey}`;
  const json = await fetchJsonWithRetry(url, { label: "finnhub-news" });
  const parsed = finnhubNewsSchema.safeParse(json);
  if (!parsed.success) throw new Error("finnhub-news: unexpected response shape");
  const rows = Array.isArray(parsed.data) ? parsed.data : parsed.data.news;
  const out: NewsItemInput[] = [];
  for (const row of rows) {
    const text = `${row.headline} ${row.summary ?? ""}`;
    const tagged = tagNews(text);
    if (tagged.pairTags.length === 0) continue; // allow-list means forex/macro only
    const publishedAt = row.datetime ? new Date(row.datetime * 1000) : null;
    if (!publishedAt || Number.isNaN(publishedAt.getTime())) continue;
    out.push({
      url: row.url,
      source: row.source ?? "finnhub",
      title: row.headline,
      summary: truncate(row.summary ?? row.headline, 400),
      rawText: row.summary ?? row.headline,
      publishedAt,
      ...tagged,
      impactScore: scoreImpact(text, 5, tagged.currencies.length),
    });
  }
  return out;
}

const newsApiSchema = z.object({
  articles: z.array(
    z.object({
      title: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      content: z.string().nullable().optional(),
      url: z.string(),
      publishedAt: z.string(),
      source: z.object({ name: z.string().optional() }).optional(),
    }),
  ),
});

async function fetchNewsApi(apiKey: string): Promise<NewsItemInput[]> {
  const url =
    `https://newsapi.org/v2/top-headlines?language=en&category=business&pageSize=50&apiKey=${apiKey}`;
  const json = await fetchJsonWithRetry(url, { label: "newsapi" });
  const parsed = newsApiSchema.safeParse(json);
  if (!parsed.success) throw new Error("newsapi: unexpected response shape");
  const out: NewsItemInput[] = [];
  for (const row of parsed.data.articles) {
    const title = row.title ?? "";
    const description = row.description ?? "";
    if (!title || !row.url) continue;
    const text = `${title} ${description}`;
    const tagged = tagNews(text);
    if (tagged.pairTags.length === 0) continue;
    const publishedAt = new Date(row.publishedAt);
    if (Number.isNaN(publishedAt.getTime())) continue;
    out.push({
      url: row.url,
      source: row.source?.name ?? "newsapi",
      title,
      summary: truncate(description || title, 400),
      rawText: row.content ?? description ?? title,
      publishedAt,
      ...tagged,
      impactScore: scoreImpact(text, 3, tagged.currencies.length),
    });
  }
  return out;
}

function rssToNewsItem(entry: RssFeedEntry): NewsItemInput | null {
  if (!entry.publishedAt) return null;
  const text = `${entry.title} ${entry.description}`;
  const tagged = tagNews(text);
  // Central-bank feeds always map to their own currency as a fallback.
  const currencies = tagged.currencies.length > 0 ? tagged.currencies : [entry.defaultCurrency];
  const pairTags = pairsForCodes(currencies);
  if (pairTags.length === 0) return null;
  return {
    url: entry.link,
    source: entry.source,
    title: entry.title,
    summary: truncate(entry.description || entry.title, 400),
    rawText: entry.description || entry.title,
    publishedAt: entry.publishedAt,
    currencies,
    pairTags,
    impactScore: scoreImpact(text, 10, currencies.length),
  };
}

// --- Aggregation + factory -----------------------------------------------------

async function fetchLiveNews(params: FetchNewsParams): Promise<NewsItemInput[]> {
  const env = getEnv();
  const batches = await Promise.allSettled([
    fetchAllRss().then((entries) => entries.map(rssToNewsItem).filter((i): i is NewsItemInput => i !== null)),
    env.FINNHUB_API_KEY ? fetchFinnhubNews(env.FINNHUB_API_KEY) : Promise.resolve([]),
    env.NEWS_API_KEY ? fetchNewsApi(env.NEWS_API_KEY) : Promise.resolve([]),
  ]);
  const merged: NewsItemInput[] = [];
  for (const batch of batches) {
    if (batch.status === "fulfilled") merged.push(...batch.value);
    else logOnce(`[desk] news source failed: ${String(batch.reason)}`);
  }

  // Dedupe by url, then by (source, title, publishedAt).
  const byUrl = new Set<string>();
  const byComposite = new Set<string>();
  const deduped: NewsItemInput[] = [];
  for (const item of merged) {
    const composite = `${item.source}|${item.title}|${item.publishedAt.toISOString()}`;
    if (byUrl.has(item.url) || byComposite.has(composite)) continue;
    byUrl.add(item.url);
    byComposite.add(composite);
    deduped.push(item);
  }
  deduped.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  return deduped.slice(0, params.limit);
}

export function getNewsProvider(): NewsProvider {
  const selection = resolveNewsProvider();
  if (selection.mode === "live") {
    return { name: selection.name, isMock: false, fetchNews: fetchLiveNews };
  }
  return {
    name: "mock",
    isMock: true,
    fetchNews: async (params) => generateMockNews(params.limit),
  };
}
