import type { Pair, Timeframe } from "./universe";

export type Impact = "low" | "medium" | "high";
export type IngestKind = "price" | "calendar" | "news";
export type IngestStatus = "running" | "success" | "partial" | "failed";

/** Normalized candle. Prices are decimal strings exactly as received/generated. */
export type CandleInput = {
  symbol: Pair;
  timeframe: Timeframe;
  openTime: Date; // UTC
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string | null;
};

export type CalendarEventInput = {
  externalId: string;
  title: string;
  country: string;
  currency: string;
  impact: Impact;
  scheduledAt: Date; // UTC
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  source: string;
  affectedPairs: Pair[];
};

export type NewsItemInput = {
  url: string;
  source: string;
  title: string;
  summary: string;
  rawText: string;
  publishedAt: Date; // UTC
  currencies: string[];
  pairTags: Pair[];
  impactScore: number; // 0-100
};

export type FetchCandlesParams = { symbol: Pair; timeframe: Timeframe; limit: number };
export type FetchCalendarParams = { from: Date; to: Date };
export type FetchNewsParams = { limit: number };

export type PriceProvider = {
  readonly name: string;
  readonly isMock: boolean;
  fetchCandles(params: FetchCandlesParams): Promise<CandleInput[]>;
};

export type CalendarProvider = {
  readonly name: string;
  readonly isMock: boolean;
  fetchEvents(params: FetchCalendarParams): Promise<CalendarEventInput[]>;
};

export type NewsProvider = {
  readonly name: string;
  readonly isMock: boolean;
  fetchNews(params: FetchNewsParams): Promise<NewsItemInput[]>;
};

export type IngestStats = {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  failedCalls: number;
  errors: string[];
};

export type IngestResult = {
  runId: string;
  kind: IngestKind;
  status: IngestStatus;
  provider: string;
  mock: boolean;
  startedAt: string; // ISO
  finishedAt: string; // ISO
  stats: IngestStats;
};
