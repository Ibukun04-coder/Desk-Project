// Starter universe for Phase 1. Pair names are always "EURUSD" internally;
// human display like "EUR/USD" only happens at the UI edge.

export const PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD"] as const;
export type Pair = (typeof PAIRS)[number];

export const TIMEFRAMES = ["M15", "H1", "H4", "D1"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  M15: 15 * 60 * 1000,
  H1: 60 * 60 * 1000,
  H4: 4 * 60 * 60 * 1000,
  D1: 24 * 60 * 60 * 1000,
};

export const PAIR_DECIMALS: Record<Pair, number> = {
  EURUSD: 5,
  GBPUSD: 5,
  USDJPY: 3,
  XAUUSD: 2,
};

/** Display only — convert at the edge, never store this form. */
export const PAIR_DISPLAY: Record<Pair, string> = {
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  XAUUSD: "XAU/USD",
};

/** Currency (or metal) code -> pairs affected when that code moves. */
const CODE_TO_PAIRS: Record<string, readonly Pair[]> = {
  USD: PAIRS, // every starter pair quotes against USD
  EUR: ["EURUSD"],
  GBP: ["GBPUSD"],
  JPY: ["USDJPY"],
  XAU: ["XAUUSD"],
};

export function pairsForCodes(codes: readonly string[]): Pair[] {
  const found = new Set<Pair>();
  for (const raw of codes) {
    const hits = CODE_TO_PAIRS[raw.toUpperCase()];
    if (hits) for (const p of hits) found.add(p);
  }
  // canonical order
  return PAIRS.filter((p) => found.has(p));
}

/** Country code (ISO-3166 alpha-2, as used by calendar feeds) -> currency code. */
export const COUNTRY_CURRENCY: Record<string, string> = {
  US: "USD", EU: "EUR", GB: "GBP", JP: "JPY",
  DE: "EUR", FR: "EUR", IT: "EUR", ES: "EUR", NL: "EUR", IE: "EUR",
  PT: "EUR", AT: "EUR", FI: "EUR", BE: "EUR", GR: "EUR", SK: "EUR",
  SI: "EUR", HR: "EUR", LT: "EUR", LV: "EUR", EE: "EUR", CY: "EUR",
  LU: "EUR", CH: "CHF", CA: "CAD", AU: "AUD", NZ: "NZD", CN: "CNY",
  HK: "HKD", SG: "SGD", IN: "INR", KR: "KRW", SE: "SEK", NO: "NOK",
  DK: "DKK", PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON", TR: "TRY",
  ZA: "ZAR", MX: "MXN", BR: "BRL", IL: "ILS", SA: "SAR", AE: "AED",
};

export interface UniverseInfo {
  pairs: readonly Pair[];
  timeframes: readonly Timeframe[];
  pairDisplay: Record<Pair, string>;
}
