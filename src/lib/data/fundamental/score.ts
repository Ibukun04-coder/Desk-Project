import type { CalendarEventInput, NewsItemInput } from "../types";
import type { Pair } from "../universe";
import { legsToBias, tagCalendarEvent, tagNews } from "./score-core";
import type { BiasFilters, BiasScore, CalendarSignal, CurrencyDir, NewsSignal, RawBiasResult } from "./score-types";

export type { BiasFilters, BiasScore, CalendarSignal, CurrencyDir, NewsSignal, RawBiasResult };
export { DEFAULT_BIAS_FILTERS } from "./score-types";

const FULL_NEWS_MS = 24 * 60 * 60 * 1000;
const HALF_NEWS_MS = 72 * 60 * 60 * 1000;

export function scoreBias(pair: Pair, news: readonly NewsItemInput[], events: readonly CalendarEventInput[], filters: BiasFilters, now = new Date()): BiasScore {
  const newsWindow = filters.newsWindowMs ?? 7 * 24 * 60 * 60 * 1000;
  const signals: NewsSignal[] = [];
  for (const n of news) {
    const age = now.getTime() - n.publishedAt.getTime();
    if (age < 0 || age > newsWindow) continue;
    if (age > HALF_NEWS_MS) continue;
    if (!n.pairTags.includes(pair)) continue;
    const s = tagNews(n.title, n.summary, n.source, n.publishedAt, n.pairTags, n.currencies);
    if (s) signals.push(s);
  }
  const cal: CalendarSignal[] = [];
  const calWindow = filters.calendarWindowMs ?? 48 * 60 * 60 * 1000;
  for (const e of events) {
    const dt = e.scheduledAt.getTime() - now.getTime();
    if (Math.abs(dt) > calWindow && dt > calWindow) continue;
    if (dt < -calWindow) continue;
    cal.push(tagCalendarEvent(e));
  }
  const dirs = new Map<string, CurrencyDir>();
  const votes = new Map<string, number>();
  for (const s of signals) {
    if (!s.currency || s.dir === "neutral") continue;
    const age = now.getTime() - s.publishedAt.getTime();
    const w = age <= FULL_NEWS_MS ? 1 : 0.5;
    votes.set(s.currency, (votes.get(s.currency) ?? 0) + (s.dir === "bullish" ? w : -w));
  }
  for (const c of cal) {
    if (c.impact !== "high" && c.impact !== "medium") continue;
    if (c.dir === "neutral") continue;
    votes.set(c.currency, (votes.get(c.currency) ?? 0) + (c.dir === "bullish" ? 0.75 : -0.75));
  }
  for (const [ccy, v] of votes) dirs.set(ccy, v > 0.25 ? "bullish" : v < -0.25 ? "bearish" : "neutral");
  const { score } = legsToBias(pair, dirs);
  return { pair, currencyDirs: dirs, score, newsSignals: signals, events: cal, asOf: now };
}

export function buildBiasResult(pair: Pair, scored: BiasScore): RawBiasResult {
  const { bias } = legsToBias(pair, scored.currencyDirs);
  const drivers: RawBiasResult["drivers"] = [];
  for (const s of scored.newsSignals.filter((x) => x.dir !== "neutral").slice(0, 3)) {
    drivers.push({ type: "news", text: `${s.headline} (${s.source})` });
  }
  for (const c of scored.events.filter((x) => x.dir !== "neutral").slice(0, 2)) {
    drivers.push({ type: "calendar", text: `${c.headline} [${c.impact}]` });
  }
  if (drivers.length === 0) drivers.push({ type: "news", text: "No directional drivers in window; bias is neutral on stored data." });
  const upcoming = scored.events.filter((e) => e.scheduledAt.getTime() >= scored.asOf.getTime()).sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0] ?? null;
  const confidence = Math.max(0, Math.min(100, Math.round(Math.abs(scored.score) * 35 + Math.min(30, drivers.length * 8))));
  const inval = upcoming ? `Invalidated if ${upcoming.headline} surprises against the ${bias} bias.` : "Invalidated by fresh hawkish/dovish headlines on either leg.";
  return { pair, bias, confidence: bias === "neutral" ? 0 : confidence, drivers: drivers.slice(0, 5), nextEvent: upcoming, invalidation: inval, asOf: scored.asOf, method: "rules-v1", usedLlm: false };
}
