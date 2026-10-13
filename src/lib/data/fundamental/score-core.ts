import type { CalendarEventInput } from "../types";
import type { Pair } from "../universe";
import type { CalendarSignal, CurrencyDir, NewsSignal } from "./score-types";

export const PAIR_CURRENCY_LEGS: Record<Pair, readonly [string, string]> = {
  EURUSD: ["EUR", "USD"],
  GBPUSD: ["GBP", "USD"],
  USDJPY: ["USD", "JPY"],
  XAUUSD: ["XAU", "USD"],
};

const HAWKISH = [
  // Policy actions.
  "rate hike", "rate hikes", "hikes rates", "hiked rates", "hiking rates",
  "raise rates", "raises rates", "raised rates", "raising rates",
  "hike interest rates", "raises interest rates", "raise interest rates", "raising interest rates",
  // Stance / guidance.
  "hawkish", "higher for longer", "restrictive", "tighten", "tightening",
  "keep rates elevated", "keeps rates elevated", "rates stay elevated", "rates elevated",
  "push back against cuts", "pushes back against cuts", "warns against cuts", "warns on inflation",
  "no rate cut", "no cuts", "not rushing to cut", "in no rush to cut",
  // Inflation fight.
  "combat inflation", "fight inflation", "fighting inflation", "inflation fight",
  "sticky inflation", "inflation remains", "inflation is still", "inflation stays", "inflation persists",
  "above target", "over target",
];
const DOVISH = [
  // Policy actions.
  "rate cut", "rate cuts", "cuts rates", "cut rates", "cut interest rates", "cuts interest rates",
  "lowers rates", "lower rates", "lowering rates", "lowered rates", "reduce rates", "reduces rates",
  "rate reduction", "rate reductions",
  // Stance / guidance.
  "easing", "dovish", "stimulus", "quantitative easing",
  "open the door to cuts", "opens the door to cuts", "paves the way for cuts", "paving the way for cuts",
  "signal cuts", "signals cuts", "shift toward cuts", "door open to cuts",
  // Cooling inflation.
  "cooling inflation", "inflation cools", "inflation cooling", "inflation eases", "inflation slows",
  "inflation easing", "inflation eases", "below target", "under target",
];
const RISK_ON = [
  "risk appetite", "risk-on", "risk on", "risk sentiment", "risk mood",
  "stocks rally", "stocks climb", "stocks rise", "equities rally", "equities gain",
  "record high", "record highs", "optimism", "optimistic", "risk sentiment improves",
  "beats expectations", "beat expectations",
];
const RISK_OFF = [
  "risk-off", "risk off", "risk aversion", "safe haven", "safe-haven", "haven demand",
  "flight to safety", "selloff", "sell-off", "slump", "slumps",
  "recession", "misses expectations", "missed expectations", "fears", "geopolitical tensions",
];

// Data-surprise contexts: a macro data word near a hot/soft word gives a
// deterministic hawkish/dovish lean (e.g. "CPI hotter than expected",
// "yields fall", "jobs miss"). Checked only when the policy lists disagree/neither.
const HOT_WORDS = ["hotter", "higher", "above", "exceed", "exceeds", "beat", "beats", "strong", "stronger", "rise", "rises", "rising", "rose", "jump", "jumps", "jumped", "surge", "surges", "surged", "accelerat", "sticky", "rebounds", "rebound", "firm"];
const SOFT_WORDS = ["cooler", "lower", "below", "miss", "misses", "weak", "weaker", "fall", "falls", "falling", "fell", "drop", "drops", "dropped", "slowed", "slow", "eased", "eases", "easing", "decelerat", "soft", "softens", "soften"];
const MACRO_WORDS = /\b(cpi|inflation|prices?|pce|wages|payrolls?|jobs?|nfp|unemployment|retail sales|gdp|yields?|borrowing costs?|consumer prices?)\b/;

function contextLean(hay: string, words: readonly string[]): boolean {
  if (!MACRO_WORDS.test(hay)) return false;
  return words.some((w) => hay.includes(w));
}

// Per-currency FX/gold move phrases: "dollar firms", "yen slides", "gold climbs".
const MOVE_ASSETS: ReadonlyArray<{ currency: string; names: readonly string[] }> = [
  { currency: "XAU", names: ["gold", "bullion"] },
  { currency: "USD", names: ["dollar", "greenback"] },
  { currency: "EUR", names: ["euro"] },
  { currency: "GBP", names: ["pound", "sterling"] },
  { currency: "JPY", names: ["yen"] },
];
const MOVE_UP = ["firm", "firms", "firming", "rise", "rises", "rising", "rose", "gain", "gains", "gaining", "gained", "climb", "climbs", "climbing", "climbed", "advance", "advances", "strengthen", "strengthens", "strengthening", "rally", "rallies", "rallied", "buoyed", "extends gains", "pushes higher"];
const MOVE_DOWN = ["weaken", "weakens", "weakening", "weakened", "fall", "falls", "falling", "fell", "drop", "drops", "dropping", "dropped", "slip", "slips", "slipping", "slid", "slide", "slides", "slump", "slumps", "decline", "declines", "retreat", "retreats", "edges lower", "extends losses", "pushes lower"];

function phraseNearAsset(hay: string, names: readonly string[], words: readonly string[], span: number): boolean {
  for (const name of names) {
    let idx = hay.indexOf(name);
    while (idx !== -1) {
      const window = hay.slice(Math.max(0, idx - span), idx + name.length + span);
      if (words.some((w) => window.includes(w))) return true;
      idx = hay.indexOf(name, idx + name.length);
    }
  }
  return false;
}

function fxMoveSignal(hay: string): { currency: string; dir: "bullish" | "bearish" } | null {
  for (const asset of MOVE_ASSETS) {
    if (phraseNearAsset(hay, asset.names, MOVE_UP, 40)) return { currency: asset.currency, dir: "bullish" };
    if (phraseNearAsset(hay, asset.names, MOVE_DOWN, 40)) return { currency: asset.currency, dir: "bearish" };
  }
  return null;
}

function has(hay: string, words: readonly string[]): boolean {
  return words.some((w) => hay.includes(w));
}

/** True when any stored signal row is synthetic — used to keep mock drivers out of live results. */
export function isMockSignal(source: string, headline: string): boolean {
  return source.trim().toLowerCase() === "mock" || /^\s*\[mock\]/i.test(headline);
}

// Phrases that contain a dovish keyword but negate it ("no rate cut",
// "warns against premature easing") — stripped before DOVISH matching.
const DOVISH_NEUTRALIZERS = ["no rate cut", "no cuts", "against cuts", "against premature easing", "premature easing", "premature cuts", "not cutting", "before cutting", "rates on hold", "hold rates", "holds rates", "holds fire"];

function signalDir(raw: string): CurrencyDir {
  const hay = raw.toLowerCase();
  const h = has(hay, HAWKISH);
  const doveHay = DOVISH_NEUTRALIZERS.reduce((acc, phrase) => acc.split(phrase).join(" "), hay);
  const d = has(doveHay, DOVISH);
  if (h && !d) return "bullish";
  if (d && !h) return "bearish";
  const on = has(hay, RISK_ON);
  const off = has(hay, RISK_OFF);
  if (on && !off) return "bullish";
  if (off && !on) return "bearish";
  // Macro data surprise: "CPI hotter than expected", "yields fall", "jobs miss".
  const hot = contextLean(hay, HOT_WORDS);
  const soft = contextLean(hay, SOFT_WORDS);
  if (hot && !soft) return "bullish";
  if (soft && !hot) return "bearish";
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
  const hay = text.toLowerCase();
  const move = fxMoveSignal(hay);
  const generic = currencyOf(text, currencies);
  const dir = signalDir(text);
  // An explicit asset move ("gold climbs", "dollar falls") beats the generic
  // lean when it names the same/only asset, or when nothing else classified.
  if (move && (dir === "neutral" || move.currency === generic)) {
    return { currency: move.currency, dir: move.dir, headline: title.slice(0, 300), source, publishedAt, pairTags };
  }
  return { currency: generic, dir, headline: title.slice(0, 300), source, publishedAt, pairTags };
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
