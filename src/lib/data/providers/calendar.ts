import { z } from "zod";
import { XMLParser } from "fast-xml-parser";
import { getEnv, logOnce, resolveCalendarProvider } from "../config";
import { fnv1a } from "../hash";
import type { CalendarEventInput, CalendarProvider, Impact } from "../types";
import { COUNTRY_CURRENCY, pairsForCodes } from "../universe";
import { fetchJsonWithRetry, fetchTextWithTimeout, parseUtcDateTime } from "./http";

// --- Deterministic mock calendar -------------------------------------------
// Synthetic recurring macro events keyed by (slug, UTC date) so re-ingests are
// idempotent. Covers the spec'd types: NFP, CPI, rate decisions, GDP,
// unemployment, PMI — across USD, EUR, GBP and JPY.

type DayRule =
  | { kind: "dayOfMonth"; day: number }
  | { kind: "weekdayEveryWeek"; weekday: number }
  | { kind: "firstWeekday"; weekday: number }
  | { kind: "secondWeekday"; weekday: number };

type MockEventTemplate = {
  slug: string;
  title: string;
  country: string;
  currency: string;
  impact: Impact;
  forecast: string;
  previous: string;
  rule: DayRule;
  hourUtc: number;
  minuteUtc: number;
};

const MOCK_TEMPLATES: MockEventTemplate[] = [
  { slug: "us-nfp", title: "Non-Farm Payrolls", country: "US", currency: "USD", impact: "high", forecast: "185K", previous: "175K", rule: { kind: "firstWeekday", weekday: 5 }, hourUtc: 13, minuteUtc: 30 },
  { slug: "us-unrate", title: "Unemployment Rate", country: "US", currency: "USD", impact: "high", forecast: "4.2%", previous: "4.2%", rule: { kind: "firstWeekday", weekday: 5 }, hourUtc: 13, minuteUtc: 30 },
  { slug: "us-cpi", title: "CPI y/y", country: "US", currency: "USD", impact: "high", forecast: "3.1%", previous: "3.2%", rule: { kind: "dayOfMonth", day: 15 }, hourUtc: 13, minuteUtc: 30 },
  { slug: "us-fomc", title: "FOMC Rate Decision", country: "US", currency: "USD", impact: "high", forecast: "4.50%", previous: "4.50%", rule: { kind: "secondWeekday", weekday: 3 }, hourUtc: 18, minuteUtc: 0 },
  { slug: "us-gdp", title: "GDP q/q (advance)", country: "US", currency: "USD", impact: "high", forecast: "2.4%", previous: "2.3%", rule: { kind: "dayOfMonth", day: 26 }, hourUtc: 13, minuteUtc: 30 },
  { slug: "us-ism-pmi", title: "ISM Manufacturing PMI", country: "US", currency: "USD", impact: "high", forecast: "49.5", previous: "48.7", rule: { kind: "dayOfMonth", day: 1 }, hourUtc: 14, minuteUtc: 0 },
  { slug: "us-jobless-claims", title: "Initial Jobless Claims", country: "US", currency: "USD", impact: "low", forecast: "220K", previous: "225K", rule: { kind: "weekdayEveryWeek", weekday: 4 }, hourUtc: 13, minuteUtc: 30 },
  { slug: "us-retail-sales", title: "Retail Sales m/m", country: "US", currency: "USD", impact: "medium", forecast: "0.3%", previous: "0.1%", rule: { kind: "dayOfMonth", day: 16 }, hourUtc: 13, minuteUtc: 30 },
  { slug: "eu-ecb-rate", title: "ECB Interest Rate Decision", country: "EU", currency: "EUR", impact: "high", forecast: "3.15%", previous: "3.15%", rule: { kind: "secondWeekday", weekday: 4 }, hourUtc: 12, minuteUtc: 15 },
  { slug: "eu-cpi-flash", title: "CPI y/y (flash)", country: "EU", currency: "EUR", impact: "high", forecast: "2.4%", previous: "2.5%", rule: { kind: "dayOfMonth", day: 17 }, hourUtc: 10, minuteUtc: 0 },
  { slug: "eu-pmi-flash", title: "Manufacturing PMI (flash)", country: "EU", currency: "EUR", impact: "medium", forecast: "47.8", previous: "47.5", rule: { kind: "dayOfMonth", day: 3 }, hourUtc: 9, minuteUtc: 0 },
  { slug: "uk-boe-rate", title: "BoE Interest Rate Decision", country: "GB", currency: "GBP", impact: "high", forecast: "4.00%", previous: "4.00%", rule: { kind: "dayOfMonth", day: 12 }, hourUtc: 11, minuteUtc: 0 },
  { slug: "uk-cpi", title: "CPI y/y", country: "GB", currency: "GBP", impact: "high", forecast: "2.6%", previous: "2.8%", rule: { kind: "dayOfMonth", day: 16 }, hourUtc: 7, minuteUtc: 0 },
  { slug: "uk-retail-sales", title: "Retail Sales m/m", country: "GB", currency: "GBP", impact: "medium", forecast: "0.2%", previous: "-0.3%", rule: { kind: "dayOfMonth", day: 18 }, hourUtc: 7, minuteUtc: 0 },
  { slug: "jp-boj-rate", title: "BoJ Policy Rate Decision", country: "JP", currency: "JPY", impact: "high", forecast: "0.75%", previous: "0.75%", rule: { kind: "secondWeekday", weekday: 5 }, hourUtc: 3, minuteUtc: 0 },
  { slug: "jp-cpi", title: "CPI y/y", country: "JP", currency: "JPY", impact: "high", forecast: "2.8%", previous: "3.0%", rule: { kind: "dayOfMonth", day: 17 }, hourUtc: 23, minuteUtc: 30 },
  { slug: "jp-unemployment", title: "Unemployment Rate", country: "JP", currency: "JPY", impact: "medium", forecast: "2.5%", previous: "2.5%", rule: { kind: "dayOfMonth", day: 28 }, hourUtc: 23, minuteUtc: 30 },
];

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): number {
  // 1-based day of month of the n-th `weekday` (0=Sun) in the given UTC month.
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const firstHit = 1 + ((weekday - first + 7) % 7);
  return firstHit + (n - 1) * 7;
}

function ruleMatches(rule: DayRule, date: Date): boolean {
  const day = date.getUTCDate();
  const weekday = date.getUTCDay();
  switch (rule.kind) {
    case "dayOfMonth":
      return day === rule.day;
    case "weekdayEveryWeek":
      return weekday === rule.weekday;
    case "firstWeekday":
      return day === nthWeekdayOfMonth(date.getUTCFullYear(), date.getUTCMonth(), rule.weekday, 1);
    case "secondWeekday":
      return day === nthWeekdayOfMonth(date.getUTCFullYear(), date.getUTCMonth(), rule.weekday, 2);
  }
}

function generateMockCalendar(from: Date, to: Date): CalendarEventInput[] {
  const now = Date.now();
  const out: CalendarEventInput[] = [];
  const startDay = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const endDay = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  for (let dayMs = startDay; dayMs <= endDay; dayMs += 86_400_000) {
    const date = new Date(dayMs);
    for (const template of MOCK_TEMPLATES) {
      if (!ruleMatches(template.rule, date)) continue;
      const scheduledAt = new Date(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          template.hourUtc,
          template.minuteUtc,
        ),
      );
      const dateKey = scheduledAt.toISOString().slice(0, 10);
      const seed = fnv1a(template.slug, dateKey);
      // Past events get a plausible synthetic actual; future ones stay null.
      const actual =
        scheduledAt.getTime() < now
          ? seed % 4 === 0
            ? null
            : seed % 2 === 0
              ? template.forecast
              : template.previous
          : null;
      out.push({
        externalId: `mock-${template.slug}-${dateKey}`,
        title: template.title,
        country: template.country,
        currency: template.currency,
        impact: template.impact,
        scheduledAt,
        actual,
        forecast: template.forecast,
        previous: template.previous,
        source: "mock",
        affectedPairs: pairsForCodes([template.currency]),
      });
    }
  }
  out.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  return out;
}

// --- Finnhub economic calendar (live) ---------------------------------------

const finnhubCalendarSchema = z.object({
  economicCalendar: z
    .array(
      z.object({
        event: z.string(),
        country: z.string(),
        time: z.union([z.string(), z.number()]),
        actual: z.union([z.string(), z.number()]).nullable().optional(),
        forecast: z.union([z.string(), z.number()]).nullable().optional(),
        previous: z.union([z.string(), z.number()]).nullable().optional(),
        impact: z.string().optional(),
      }),
    )
    .optional(),
});

function toStringOrNull(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === "" || text === "-" ? null : text;
}

function normalizeImpact(raw: string | undefined, title: string): Impact {
  const value = raw?.trim().toLowerCase();
  if (value === "low") return "low";
  if (value === "med" || value === "medium") return "medium";
  if (value === "high") return "high";
  // Fallback classifier when the feed does not label impact.
  if (/(payroll|non-?farm|nonfarm|\bcpi\b|inflation|interest rate|rate decision|fomc|monetary policy|\bgdp\b|unemployment|employment change|pce)/i.test(title)) {
    return "high";
  }
  return "medium";
}

function dateOnlyUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function fetchFinnhubCalendar(
  from: Date,
  to: Date,
  apiKey: string,
): Promise<CalendarEventInput[]> {
  const url =
    `https://finnhub.io/api/v1/calendar/economic?from=${dateOnlyUtc(from)}` +
    `&to=${dateOnlyUtc(to)}&token=${apiKey}`;
  const json = await fetchJsonWithRetry(url, { label: "finnhub-calendar" });
  const parsed = finnhubCalendarSchema.safeParse(json);
  if (!parsed.success) throw new Error("finnhub-calendar: unexpected response shape");

  const out: CalendarEventInput[] = [];
  for (const row of parsed.data.economicCalendar ?? []) {
    const currency = COUNTRY_CURRENCY[row.country.toUpperCase()];
    if (!currency) continue; // only store events we can map onto the universe
    const scheduledAt =
      typeof row.time === "number"
        ? new Date(row.time * 1000)
        : parseUtcDateTime(row.time);
    if (!scheduledAt) continue;
    const affectedPairs = pairsForCodes([currency]);
    out.push({
      externalId: `finnhub-${row.country}-${scheduledAt.getTime()}-${row.event}`
        .toLowerCase()
        .replace(/\s+/g, "-")
        .slice(0, 200),
      title: row.event,
      country: row.country.toUpperCase(),
      currency,
      impact: normalizeImpact(row.impact, row.event),
      scheduledAt,
      actual: toStringOrNull(row.actual),
      forecast: toStringOrNull(row.forecast),
      previous: toStringOrNull(row.previous),
      source: "finnhub",
      affectedPairs,
    });
  }
  out.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  return out;
}

// --- Faireconomy (ForexFactory) weekly XML calendar ---------------------------
// Public, keyless feed. Times in the feed are US Eastern wall-clock; we convert
// to UTC with deterministic US DST rules (2nd Sun Mar 2am → 1st Sun Nov 2am).
// thisweek first; nextweek only as a fetch fallback. A total failure throws so
// the ingest run is marked failed — never a silent mock fallback.

const FAIRECONOMY_URLS = [
  "https://nfs.faireconomy.media/ff_calendar_thisweek.xml",
  "https://nfs.faireconomy.media/ff_calendar_nextweek.xml",
] as const;

const ffParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function ffRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function ffArray(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function ffText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  const rec = ffRecord(value);
  if (rec && typeof rec["#text"] === "string") return rec["#text"];
  return "";
}

/** Second Sunday of March / first Sunday of November, 2am local (US DST rules). */
function dstBoundaries(year: number): { start: number; end: number } {
  const nthSunday = (month: number, nth: number): number => {
    const first = new Date(Date.UTC(year, month, 1));
    const firstDow = first.getUTCDay(); // 0=Sun
    const firstSunday = 1 + ((7 - firstDow) % 7);
    return firstSunday + (nth - 1) * 7;
  };
  return {
    start: Date.UTC(year, 2, nthSunday(2, 2), 2), // March, 2nd Sunday, 2am ET
    end: Date.UTC(year, 10, nthSunday(10, 1), 2), // November, 1st Sunday, 2am ET
  };
}

/** Convert an Eastern wall-clock date (MM-DD-YYYY) + time ("12:30pm") to UTC. */
function easternToUtc(dateText: string, timeText: string): Date | null {
  const dm = dateText.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  const tm = timeText.trim().toLowerCase().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (!dm || !tm) return null;
  let hour = Number(tm[1]);
  const minute = Number(tm[2]);
  const meridiem = tm[3];
  if (meridiem === "pm" && hour !== 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const year = Number(dm[3]);
  // Treat the Eastern wall-clock as if it were UTC, then ADD the offset:
  // EDT is UTC-4, so 12:30pm ET → 16:30Z. (EST → 17:30Z.)
  const wallUtc = Date.UTC(year, Number(dm[1]) - 1, Number(dm[2]), hour, minute);
  const { start, end } = dstBoundaries(year);
  const offsetHours = wallUtc >= start && wallUtc < end ? 4 : 5; // EDT : EST
  return new Date(wallUtc + offsetHours * 3_600_000);
}

function ffImpact(raw: string): Impact | null {
  const v = raw.trim().toLowerCase();
  if (v === "high") return "high";
  if (v === "medium") return "medium";
  return null; // low, holiday, or anything else is dropped
}

/** Feed "country" holds a currency code (USD/GBP/…) or "All"; map to ours. */
function ffCurrency(raw: string): string | null {
  const cc = raw.trim().toUpperCase();
  const mapped = COUNTRY_CURRENCY[cc];
  if (mapped) return mapped;
  if (cc.length === 3 && pairsForCodes([cc]).length > 0) return cc; // already USD/EUR/…
  return null; // "All", AUD, CAD, … — not in the starter universe
}

function parseFaireCalendarXml(xml: string): CalendarEventInput[] {
  const doc = ffRecord(ffParser.parse(xml) as unknown);
  const weekly = doc ? ffRecord(doc.weeklyevents) : null;
  const rawEvents = weekly ? ffArray(weekly.event) : [];
  const out: CalendarEventInput[] = [];
  for (const raw of rawEvents) {
    const rec = ffRecord(raw);
    if (!rec) continue;
    const title = ffText(rec.title).trim();
    const currency = ffCurrency(ffText(rec.country));
    const impact = ffImpact(ffText(rec.impact));
    if (!title || !currency || !impact) continue;
    const scheduledAt = easternToUtc(ffText(rec.date), ffText(rec.time));
    if (!scheduledAt) continue;
    const affectedPairs = pairsForCodes([currency]);
    if (affectedPairs.length === 0) continue;
    // Stable id: currency + title + scheduled time — same event ⇒ same id across weeks.
    const scheduledKey = scheduledAt.toISOString().slice(0, 16).replace(/[-:T]/g, "");
    out.push({
      externalId: `ff-${currency}-${title}-${scheduledKey}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 200),
      title,
      country: currency,
      currency,
      impact,
      scheduledAt,
      actual: toStringOrNull(ffText(rec.actual)),
      forecast: toStringOrNull(ffText(rec.forecast)),
      previous: toStringOrNull(ffText(rec.previous)),
      source: "faireconomy",
      affectedPairs,
    });
  }
  out.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  return out;
}

async function fetchFaireEconomyCalendar(): Promise<CalendarEventInput[]> {
  let lastError: unknown = null;
  for (const url of FAIRECONOMY_URLS) {
    try {
      const xml = await fetchTextWithTimeout(url, { timeoutMs: 15_000 });
      const events = parseFaireCalendarXml(xml);
      if (events.length === 0) throw new Error("faireconomy-calendar: feed parsed to zero usable events");
      return events;
    } catch (err) {
      lastError = err;
      logOnce(`[desk] faireconomy-calendar: ${url} failed (${String(err)}) — trying fallback`);
    }
  }
  throw new Error(
    `faireconomy-calendar: all feeds failed (${lastError instanceof Error ? lastError.message : String(lastError)})`,
  );
}

// --- Factory ----------------------------------------------------------------

export function getCalendarProvider(): CalendarProvider {
  const selection = resolveCalendarProvider();
  if (selection.mode === "live" && selection.name === "faireconomy") {
    return {
      name: "faireconomy",
      isMock: false,
      fetchEvents: () => fetchFaireEconomyCalendar(),
    };
  }
  if (selection.mode === "live") {
    const apiKey = getEnv().FINNHUB_API_KEY ?? "";
    return {
      name: selection.name,
      isMock: false,
      fetchEvents: (params) => fetchFinnhubCalendar(params.from, params.to, apiKey),
    };
  }
  return {
    name: "mock",
    isMock: true,
    fetchEvents: async (params) => generateMockCalendar(params.from, params.to),
  };
}

export type { CalendarProvider };

