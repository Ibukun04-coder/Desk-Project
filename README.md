# Desk — Phase 1: Data Layer

Working name **Desk** — an AI forex analysis product. This repository currently contains
**Phase 1 only**: the data layer. There is no trading, no LLM/SMC analysis, no charting,
no signals, and no user accounts — by design.

## What Phase 1 does

- Ingests & stores OHLC candles for `EURUSD, GBPUSD, USDJPY, XAUUSD` × `M15, H1, H4, D1`,
  upserted by the unique key `(symbol, timeframe, openTime)` — never duplicated.
- Ingests & stores an economic calendar (NFP, CPI, FOMC/rate decisions, GDP, unemployment,
  PMI) with country/currency → affected-pairs mapping.
- Ingests & stores tagged news from an **allow-list of sources** only (central-bank RSS:
  Fed, ECB, BoE, BoJ — plus Finnhub/NewsAPI when keyed), deduplicated by `url` and by
  `(source, title, publishedAt)`.
- Exposes typed, Zod-validated read APIs that later phases will consume.
- **Survives slow/down feeds**: reads always come from the database, so the app serves the
  last stored data when a provider fails. Failures are recorded in `IngestRun`.
- Runs with **zero API keys** in deterministic mock mode (candles + sample calendar + sample news).

## Stack

Next.js (App Router) · TypeScript (strict) · Prisma + **SQLite** (no Postgres configured; the
schema is portable to Postgres by changing `datasource` + `DATABASE_URL`) · Zod · date-fns ·
Tailwind CSS 4 · npm.

## Setup

```bash
npm install
copy .env.example .env        # Windows; use `cp` on macOS/Linux
npx prisma migrate dev --name init   # creates prisma/migrations + prisma/dev.db, runs prisma generate
npm run dev                   # http://localhost:3000  → Data Health page
```

All keys go in `.env` (gitignored) — **never commit real keys**. With no keys the app boots
in mock mode and logs that clearly.

## Running ingestion

```bash
npm run ingest                # one-shot: price + calendar + news
npm run ingest -- --watch     # loop every INGEST_INTERVAL_SECONDS (default 60)
```

Or over HTTP:

```bash
curl -X POST http://localhost:3000/api/ingest/price
curl -X POST http://localhost:3000/api/ingest/calendar
curl -X POST http://localhost:3000/api/ingest/news
curl -X POST http://localhost:3000/api/ingest/all
curl http://localhost:3000/api/health/data
```

The runner is idempotent, rate-limits provider calls (per-provider delays in
`src/lib/data/providers/price.ts`), retries once on 429/5xx with backoff, writes an
`IngestRun` row per attempt, and logs `fetched / inserted / updated / skipped / failed`.
Partial failure never deletes existing rows.

## Providers (selected via env)

| Kind    | Live when…                         | Sources | Mock when |
|---------|------------------------------------|---------|-----------|
| price   | `PRICE_PROVIDER` or any price key  | Twelve Data, Polygon (`api.massive.com`, tickers like `C:EURUSD`), OANDA (practice host) | no price keys / provider key missing |
| calendar| `FINNHUB_API_KEY`                  | Finnhub economic calendar | no `FINNHUB_API_KEY` |
| news    | `FINNHUB_API_KEY` or `NEWS_API_KEY`| Finnhub forex news, NewsAPI, central-bank RSS | no news keys |

Notes:
- `PRICE_PROVIDER=twelvedata|polygon|oanda|mock`; when unset, the first provider with a key wins.
- Free-tier rate limits make a full live price universe take ~2–3 minutes (16 calls with
  inter-call delays). Mock mode is instant.
- OANDA defaults to the practice host (`api-fxpractice.oanda.com`); live accounts must change
  the host in `src/lib/data/providers/price.ts`.

## Read APIs (what Phase 2+ hooks into)

```
GET /api/candles?symbol=EURUSD&timeframe=H1&limit=500   → { data: Candle[], count }
GET /api/calendar?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z&impact=high
GET /api/news?pair=EURUSD&limit=50
GET /api/universe                                       → pairs, timeframes, active providers
GET /api/health/data                                    → last run per kind, candle counts, modes
```

Invalid query params return **400** with Zod issues; prices are decimal **strings**; all
timestamps are ISO-8601 **UTC**. Internally pairs are always `EURUSD` (display `EUR/USD`
only at the UI edge).

## Phase 2 — Fundamental bias (rules-v1)

Deterministic per-pair bias scored from **stored** news + calendar rows (no fresh fetch,
no LLM required). Currency legs per pair (`EURUSD/GBPUSD/USDJPY/XAUUSD`, USD leg
inverted via base-minus-quote); news tagged hawkish/dovish/risk-on/risk-off; recency
decay (24h full, 24–72h half, older ignored); high/medium calendar events within 48h
adjust confidence; snapshots capped at 20/pair.

```
GET  /api/bias              → { pairs: BiasResult[], providers, llmActive }
GET  /api/bias?pair=EURUSD  → one BiasResult (404 when never computed)
POST /api/bias              → recompute all pairs, persist BiasSnapshot rows
POST /api/bias/recompute    → recompute [{ pairs?: [...] }] (400 on bad input)
POST /api/ingest/all        → ingest + recompute; { data: { ingest, bias }, ingestStatus, biasSnapshots }
```

LLM overlay is active only when one of `OPENAI_API_KEY` / `XAI_API_KEY` / `GROK_API_KEY`
is set; it may only rewrite driver wording + invalidation and never changes bias or
confidence. Failures fall back to the rules output. Without keys every result carries
`usedLlm: false` and no LLM is ever called. `/bias` renders the four `BiasCard`s plus a
Recompute button.

Exact Phase 3 hook points: `scorePair` / `recomputeAllPairs` in `src/lib/data/bias.ts`
and the `/api/bias` responses above.

## Phase 3 — Pair desk (deterministic SMC, no LLM, no execution)

Human analysis only: candlestick chart + rules-computed SMC structure overlay +
the existing Phase 2 fundamental bias card. No trade buttons, no orders.

```
GET  /api/smc?symbol=EURUSD&timeframe=H1  → { smc, setups, alignment, bias, mock, message }
/pair/EURUSD?timeframe=H1                  → chart + overlays + bias + setups
```

Detector (`src/lib/smc/`, pure functions, no I/O):
- `types.ts` — SmcSnapshot / swings / BOS+CHOCH / FVG / order block /
  liquidity / range / htfBias / Setup shapes.
- `swings.ts` — fractal swings n=2 (strict; last 2 candles unconfirmed),
  ATR helper, decimal-string → number parsing at the edge.
- `structure.ts` — BOS/CHOCH trend walk (close beyond last opposite swing;
  first counter-break labels CHOCH then flips trend; htfBias = last break).
- `structure-zones.ts` — FVG (3-candle gap, ≥50% wick fill = mitigated) and
  order blocks (last opposite candle before the BOS leg, 50% trade-through =
  mitigated).
- `liquidity.ts` — equal-high/low clusters within 0.15×ATR + most recent
  swing high/low; last confirmed swing range (premium = upper half, discount
  = lower half).
- `detect.ts` — `detectSmc(symbol, timeframe, candles)` orchestrator; empty /
  short series → empty arrays, never a crash. Caps: 60 swings, 12 BOS, 12
  CHOCH, 8 OBs, 12 FVGs, 6 liquidity levels.
- `setups.ts` — `rankSetups(smc, bias)` → 0–2 setups. A-setup only when SMC
  direction AND fundamental bias agree; B-setup for mixed/missing/conflict
  (conflict carries “SMC vs news mismatch — do not treat as aligned” and
  alignment DO_NOT_TRADE). `applyPlaybookConstraint` is the Phase 4 hook.
- `fixtures.ts` + `src/scripts/smc-check.ts` (`npx tsx src/scripts/smc-check.ts`).

Overlays (`src/components/pair/`): FVG rectangles (green/red), order-block
rectangles (blue demand / purple supply), last-3 BOS + CHOCH markers, dashed
premium/discount midpoint price line — all from `detectSmc`, never the LLM.
`/bias` cards link to `/pair/[symbol]`. Nav: Data health | Bias desk | Pair desk.

Mock ≠ live: with no price keys the chart draws deterministic mock candles and
shows a MOCK DATA banner; overlays are still real rules output on that data.

Phase 4 hook: strategy-video / playbook RAG should constrain setups inside
`applyPlaybookConstraint` in `src/lib/smc/setups.ts` (filter or downgrade —
never touch the detector or the fundamental scorer).

## Data model (`prisma/schema.prisma`)

- `Candle` — unique `(symbol, timeframe, openTime)`
- `CalendarEvent` — unique `externalId`, `affectedPairs` JSON
- `NewsItem` — unique `url`, `currencies`/`pairTags` JSON, `impactScore` 0–100
- `IngestRun` — `kind`, `status`, timings, `error`, `stats` JSON

Prices are stored as **strings** (providers return decimal strings; stored verbatim — no
float rounding, and identical behaviour on SQLite and Postgres).

## Not included (later phases)

Broker execution · strategy-video RAG ·
user accounts & payments · signal generation · pairs beyond the starter universe.
