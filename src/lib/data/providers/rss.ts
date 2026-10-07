import { XMLParser } from "fast-xml-parser";
import { logOnce } from "../config";
import { parseUtcDateTime } from "./http";

// Legal, no-key RSS sources: central-bank press feeds (allow-listed, no scraping).
// Individual feed failures are isolated so one dead feed never breaks ingestion.

export type RssFeedEntry = {
  source: string;
  defaultCurrency: string;
  title: string;
  link: string;
  description: string;
  publishedAt: Date | null;
};

const RSS_SOURCES: ReadonlyArray<{
  name: string;
  url: string;
  defaultCurrency: string;
}> = [
  { name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml", defaultCurrency: "USD" },
  { name: "European Central Bank", url: "https://www.ecb.europa.eu/rss/press.html?ftype=rss", defaultCurrency: "EUR" },
  { name: "Bank of England", url: "https://www.bankofengland.co.uk/rss/news/rss", defaultCurrency: "GBP" },
  { name: "Bank of Japan", url: "https://www.boj.or.jp/en/rss/whatsnew.xml", defaultCurrency: "JPY" },
];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function nodeText(value: unknown): string {
  if (typeof value === "string") return value;
  const rec = asRecord(value);
  if (rec && typeof rec["#text"] === "string") return rec["#text"];
  return "";
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function entryToFeedEntry(
  raw: unknown,
  source: string,
  defaultCurrency: string,
): RssFeedEntry | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const title = stripHtml(nodeText(rec.title));
  if (!title) return null;

  let link = "";
  if (typeof rec.link === "string") link = rec.link;
  else {
    const linkRec = asRecord(rec.link);
    if (linkRec) link = typeof linkRec["@_href"] === "string" ? linkRec["@_href"] : "";
  }
  if (!link) return null;

  const description = stripHtml(
    nodeText(rec.description) || nodeText(rec.summary) || nodeText(rec.content),
  );
  const publishedRaw =
    nodeText(rec.pubDate) ||
    nodeText(rec["dc:date"]) ||
    nodeText(rec.published) ||
    nodeText(rec.updated);
  let publishedAt: Date | null = null;
  if (publishedRaw) {
    const parsed = parseUtcDateTime(publishedRaw);
    if (parsed) publishedAt = parsed;
    else {
      const fallback = new Date(publishedRaw); // RFC-822 dates ("Tue, 6 Oct 2026 ... GMT")
      publishedAt = Number.isNaN(fallback.getTime()) ? null : fallback;
    }
  }

  return { source, defaultCurrency, title, link, description, publishedAt };
}

function parseFeed(xml: string, source: string, defaultCurrency: string): RssFeedEntry[] {
  const doc = asRecord(parser.parse(xml) as unknown);
  if (!doc) return [];
  let items: unknown[] = [];
  const rss = asRecord(doc.rss);
  const channel = rss ? asRecord(rss.channel) : null;
  if (channel) items = asArray(channel.item);
  if (items.length === 0) {
    const rdf = asRecord(doc["rdf:RDF"]);
    const rdfChannel = rdf ? asRecord(rdf.channel) : null;
    if (rdfChannel) items = asArray(rdfChannel.item);
  }
  if (items.length === 0) {
    const feed = asRecord(doc.feed);
    if (feed) items = asArray(feed.entry); // Atom
  }
  const out: RssFeedEntry[] = [];
  for (const item of items) {
    const parsed = entryToFeedEntry(item, source, defaultCurrency);
    if (parsed) out.push(parsed);
  }
  return out;
}

async function fetchOneSource(source: {
  name: string;
  url: string;
  defaultCurrency: string;
}): Promise<RssFeedEntry[]> {
  try {
    const res = await fetch(source.url, {
      headers: { "User-Agent": "DeskPhase1/1.0 (RSS reader)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    return parseFeed(xml, source.name, source.defaultCurrency);
  } catch (err) {
    logOnce(`[desk] RSS source "${source.name}" unavailable (${source.url}): ${String(err)}`);
    return [];
  }
}

/** Fetch all allow-listed feeds in parallel; failures degrade to []. */
export async function fetchAllRss(): Promise<RssFeedEntry[]> {
  const results = await Promise.all(RSS_SOURCES.map((source) => fetchOneSource(source)));
  return results.flat();
}
