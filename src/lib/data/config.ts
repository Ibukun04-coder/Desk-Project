import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  PRICE_PROVIDER: z.enum(["twelvedata", "polygon", "oanda", "mock"]).optional(),
  TWELVEDATA_API_KEY: z.string().optional(),
  POLYGON_API_KEY: z.string().optional(),
  OANDA_API_KEY: z.string().optional(),
  OANDA_ACCOUNT_ID: z.string().optional(),
  NEWS_PROVIDER: z.enum(["finnhub", "mock"]).optional(),
  CALENDAR_PROVIDER: z.enum(["faireconomy", "finnhub", "mock"]).optional(),
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

/** Calendar: faireconomy (public weekly XML, no key) by default; finnhub when
 *  explicitly requested; mock only when asked. A failed fetch marks the ingest
 *  failed — stored rows keep serving, never a silent mock fallback. */
export function resolveCalendarProvider(): ProviderSelection {
  const env = getEnv();
  const explicit = env.CALENDAR_PROVIDER;
  if (explicit === "mock") {
    return { name: "mock", mode: "mock", reason: "CALENDAR_PROVIDER=mock" };
  }
  if (explicit === "finnhub") {
    if (env.FINNHUB_API_KEY) {
      return { name: "finnhub", mode: "live", reason: "CALENDAR_PROVIDER=finnhub" };
    }
    logOnce(
      "[desk] CALENDAR_PROVIDER=finnhub but FINNHUB_API_KEY missing — using faireconomy (no key required).",
    );
    return { name: "faireconomy", mode: "live", reason: "finnhub key missing; using faireconomy" };
  }
  // Default (and explicit CALENDAR_PROVIDER=faireconomy): keyless public feed.
  return {
    name: "faireconomy",
    mode: "live",
    reason: explicit === "faireconomy" ? "CALENDAR_PROVIDER=faireconomy" : "default (no key required)",
  };
}

/** News: Finnhub when NEWS_PROVIDER=finnhub (default) with a key, else mock.
 *  If Finnhub news returns nothing useful the banner says so (see fetchLiveNews
 *  fallback note); no scraping of random sites, ever. */
export function resolveNewsProvider(): ProviderSelection {
  const env = getEnv();
  const wantLive = (env.NEWS_PROVIDER ?? "finnhub") === "finnhub";
  const sources: string[] = [];
  if (env.FINNHUB_API_KEY && wantLive) sources.push("finnhub");
  if (env.NEWS_API_KEY) sources.push("newsapi");
  if (sources.length > 0) {
    return { name: [...sources, "rss"].join("+"), mode: "live", reason: "news API key set" };
  }
  if (env.FINNHUB_API_KEY && !wantLive) {
    logOnce("[desk] NEWS_PROVIDER=mock — NEWS running in MOCK mode despite FINNHUB_API_KEY.");
    return { name: "mock", mode: "mock", reason: "NEWS_PROVIDER=mock" };
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
