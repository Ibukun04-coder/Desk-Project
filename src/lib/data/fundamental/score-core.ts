import type { CalendarEventInput } from "../types";
import type { Pair } from "../universe";
import type { CalendarSignal, CurrencyDir, NewsSignal } from "./score-types";

export const PAIR_CURRENCY_LEGS: Record<Pair, readonly [string, string]> = {
  EURUSD: ["EUR", "USD"],
  GBPUSD: ["GBP", "USD"],
  USDJPY: ["USD", "JPY"],
  XAUUSD: ["XAU", "USD"],
};

const HAWKISH = ["rate hike", "hikes rates", "raises rates", "tighten", "hawkish", "higher for longer", "restrictive"];
const DOVISH = ["rate cut", "cuts rates", "lowers rates", "easing", "dovish", "stimulus", "quantitative easing"];
const RISK_ON = ["risk appetite", "risk-on", "stocks rally", "record high", "optimism", "beats expectations"];
const RISK_OFF = ["risk-off", "risk aversion", "safe haven", "selloff", "recession", "misses expectations", "fears"];

function has(hay: string, words: readonly string[]): boolean {
  return words.some((w) => hay.includes(w));
}

function signalDir(raw: string): CurrencyDir {
  const hay = raw.toLowerCase();
  const h = has(hay, HAWKISH);
  const d = has(hay, DOVISH);
  if (h && !d) return "bullish";
  if (d && !h) return "bearish";
  const on = has(hay, RISK_ON);
  const off = has(hay, RISK_OFF);
  if (on && !off) return "bullish";
  if (off && !on) return "bearish";
  return "neutral";
}

function currencyOf(text: string, currencies: readonly string[]): string | null {
  const hay = ` ${text.toLowerCase()} `;
  for (const c of currencies) {
    const t = c.toLowerCase();
    if (hay.includes(` ${t} `)) return c;
  }
  if (hay.includes("gold") || hay.includes("xau")) return "XAU";
  if (hay.includes("dollar")) return "USD";
  if (hay.includes(" euro")) return "EUR";
  if (hay.includes(" pound") || hay.includes("sterling")) return "GBP";
  if (hay.includes(" yen")) return "JPY";
  return null;
}

export function tagNews(title: string, summary: string, source: string, publishedAt: Date, pairTags: readonly Pair[], currencies: readonly string[]): NewsSignal | null {
  const text = `${title} ${summary}`.trim();
  if (text.length < 12) return null;
  return { currency: currencyOf(text, currencies), dir: signalDir(text), headline: title.slice(0, 300), source, publishedAt, pairTags };
}

export function tagCalendarEvent(e: CalendarEventInput): CalendarSignal {
  const hay = `${e.title} ${e.actual ?? ""} ${e.forecast ?? ""} ${e.previous ?? ""}`;
  let dir = signalDir(hay);
  let surprise: number | null = null;
  const a = e.actual != null ? Number(e.actual) : NaN;
  const f = e.forecast != null ? Number(e.forecast) : NaN;
  if (Number.isFinite(a) && Number.isFinite(f) && f !== 0) {
    surprise = (a - f) / Math.abs(f);
    if (surprise > 0.005) dir = "bullish";
    else if (surprise < -0.005) dir = "bearish";
  }
  return { currency: e.currency, dir, headline: e.title, impact: e.impact, actual: e.actual, forecast: e.forecast, previous: e.previous, scheduledAt: e.scheduledAt, actualPrinted: e.actual != null && e.actual !== "", surprise };
}

export function legsToBias(pair: Pair, dirs: Map<string, CurrencyDir>): { bias: "bullish" | "bearish" | "mixed" | "neutral"; score: number } {
  const [base, quote] = PAIR_CURRENCY_LEGS[pair];
  const v = (d: CurrencyDir | undefined): number => (d === "bullish" ? 1 : d === "bearish" ? -1 : 0);
  const score = v(dirs.get(base)) - v(dirs.get(quote));
  if (score >= 1) return { bias: "bullish", score };
  if (score <= -1) return { bias: "bearish", score };
  return { bias: dirs.size === 0 ? "neutral" : "mixed", score };
}
