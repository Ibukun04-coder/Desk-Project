import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  PRICE_PROVIDER: z.enum(["twelvedata", "polygon", "oanda", "mock"]).optional(),
  TWELVEDATA_API_KEY: z.string().optional(),
  POLYGON_API_KEY: z.string().optional(),
  OANDA_API_KEY: z.string().optional(),
  OANDA_ACCOUNT_ID: z.string().optional(),
  NEWS_API_KEY: z.string().optional(),
  FINNHUB_API_KEY: z.string().optional(),
  INGEST_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;
  // Treat empty strings (KEY= in .env) as unset.
  const raw: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) raw[k] = v === "" ? undefined : v;
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${detail}`);
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}

const warned = new Set<string>();
export function logOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

export type ProviderMode = "live" | "mock";

export type PriceProviderName = "twelvedata" | "polygon" | "oanda" | "mock";

export type ProviderSelection = {
  name: string;
  mode: ProviderMode;
  reason: string;
};

/** Price: explicit PRICE_PROVIDER, else first provider with a key, else mock. */
export function resolvePriceProvider(): ProviderSelection {
  const env = getEnv();
  const keyed: Array<[PriceProviderName, string | undefined]> = [
    ["twelvedata", env.TWELVEDATA_API_KEY],
    ["polygon", env.POLYGON_API_KEY],
    ["oanda", env.OANDA_API_KEY],
  ];
  const explicit = env.PRICE_PROVIDER;
  if (explicit === "mock") {
    return { name: "mock", mode: "mock", reason: "PRICE_PROVIDER=mock" };
  }
  if (explicit) {
    const key = keyed.find(([name]) => name === explicit)?.[1];
    if (key) return { name: explicit, mode: "live", reason: `PRICE_PROVIDER=${explicit}` };
    logOnce(
      `[desk] PRICE_PROVIDER=${explicit} but its API key is missing — falling back to mock mode.`,
    );
    return { name: "mock", mode: "mock", reason: `missing API key for ${explicit}` };
  }
  const auto = keyed.find(([, key]) => key);
  if (auto) return { name: auto[0], mode: "live", reason: "auto-detected API key" };
  logOnce(
    "[desk] No price API keys found (TWELVEDATA_API_KEY / POLYGON_API_KEY / OANDA_API_KEY) — PRICE running in MOCK mode.",
  );
  return { name: "mock", mode: "mock", reason: "no API keys" };
}

/** Calendar: Finnhub economic calendar when keyed, else deterministic mock. */
export function resolveCalendarProvider(): ProviderSelection {
  const env = getEnv();
  if (env.FINNHUB_API_KEY) {
    return { name: "finnhub", mode: "live", reason: "FINNHUB_API_KEY set" };
  }
  logOnce(
    "[desk] FINNHUB_API_KEY not set — CALENDAR running in MOCK mode (synthetic high-impact events).",
  );
  return { name: "mock", mode: "mock", reason: "no FINNHUB_API_KEY" };
}

/** News: API sources + central-bank RSS when keyed, else deterministic mock. */
export function resolveNewsProvider(): ProviderSelection {
  const env = getEnv();
  const sources: string[] = [];
  if (env.FINNHUB_API_KEY) sources.push("finnhub");
  if (env.NEWS_API_KEY) sources.push("newsapi");
  if (sources.length > 0) {
    return { name: [...sources, "rss"].join("+"), mode: "live", reason: "news API key set" };
  }
  logOnce(
    "[desk] No news API keys (FINNHUB_API_KEY / NEWS_API_KEY) — NEWS running in MOCK mode (sample items).",
  );
  return { name: "mock", mode: "mock", reason: "no news API keys" };
}

export type ProviderModes = {
  price: ProviderSelection;
  calendar: ProviderSelection;
  news: ProviderSelection;
  ingestIntervalSeconds: number;
};

export function getProviderModes(): ProviderModes {
  return {
    price: resolvePriceProvider(),
    calendar: resolveCalendarProvider(),
    news: resolveNewsProvider(),
    ingestIntervalSeconds: getEnv().INGEST_INTERVAL_SECONDS,
  };
}
