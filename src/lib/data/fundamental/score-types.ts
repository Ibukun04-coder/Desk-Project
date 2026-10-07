import type { Pair } from "../universe";

export type CurrencyDir = "bullish" | "bearish" | "neutral";
export type BiasDir = "bullish" | "bearish" | "mixed" | "neutral";

export interface BiasFilters {
  newsWindowMs?: number;
  calendarWindowMs?: number;
  eventDepth?: number;
}

export const DEFAULT_BIAS_FILTERS: Required<BiasFilters> = {
  newsWindowMs: 7 * 24 * 60 * 60 * 1000,
  calendarWindowMs: 48 * 60 * 60 * 1000,
  eventDepth: 2,
};

export interface NewsSignal {
  currency: string | null;
  dir: CurrencyDir;
  headline: string;
  source: string;
  publishedAt: Date;
  pairTags: readonly Pair[];
}

export interface CalendarSignal {
  currency: string;
  dir: CurrencyDir;
  headline: string;
  impact: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  scheduledAt: Date;
  actualPrinted: boolean;
  surprise: number | null;
}

export interface RawBiasResult {
  pair: Pair;
  bias: BiasDir;
  confidence: number;
  drivers: Array<{ type: "news" | "calendar"; text: string }>;
  nextEvent: CalendarSignal | null;
  invalidation: string;
  asOf: Date;
  method: "rules-v1";
  usedLlm: boolean;
}

export interface BiasScore {
  pair: Pair;
  currencyDirs: Map<string, CurrencyDir>;
  score: number;
  newsSignals: NewsSignal[];
  events: CalendarSignal[];
  asOf: Date;
}
