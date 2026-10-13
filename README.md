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

## Live data (keys optional — mock is the default)

Free keys:
- Twelve Data (price): https://twelvedata.com — free plan covers forex time_series.
- Finnhub (calendar + news): https://finnhub.io — free plan covers the economic
  calendar and general news.

Env vars (in `.env`, never committed — `.env` is gitignored):
```
PRICE_PROVIDER=twelvedata
TWELVEDATA_API_KEY=<your key>   # empty → price stays mock even with PRICE_PROVIDER=twelvedata
FINNHUB_API_KEY=<your key>      # enables live calendar; enables live news via NEWS_PROVIDER
NEWS_PROVIDER=finnhub           # or "mock" to force mock news despite a Finnhub key
```
Restart `npm run dev` after editing `.env` (env is read at boot).

Behaviour:
- Each feed resolves independently: a keyed feed runs live, a keyless feed stays
  mock, and Data Health names each feed (`twelvedata` / `finnhub` / `mock`) with
  a LIVE/MOCK badge plus the last error string — never one blanket label.
- `/bias` and `/pair` show LIVE or MOCK per section (price vs news); live
  candles are never labelled mock.
- A failed live call logs on its `IngestRun`, keeps last stored rows, and never
  invents prices or headlines. If free Finnhub news yields no tagged forex
  items, news stays on mock and the banner says so (no scraping).
- Warn: free tiers are delayed and rate-limited (Twelve Data free ≈ 8 req/min —
  a full 16-call price ingest takes ~2 min); not for live order execution.
- Not financial advice.

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

## Phase 4a — Playbook (written rules, not videos)

The playbook is text rules that BLOCK or DOWNGRADE setups. Rules beat the model:
an enabled `block` rule turns a grade-A setup into `rejected` (a block on a B
also rejects it); a `downgrade` caps A at B. B otherwise stays B.

- Prisma model `PlaybookRule` (title, body, enabled, severity block|downgrade,
  appliesTo all|long|short, machine-readable `whenJson`, sortOrder).
- Evaluator `src/lib/playbook/evaluate.ts` switches on `whenJson.kind`
  (`ob_overlap` | `not_aligned` | `event_window` | `premium_discount`);
  unknown kinds are ignored, never crash. `/api/smc` returns evaluated setups
  (`originalGrade`, `finalGrade`, `fired[]`) — raw SMC detection unchanged.
- APIs: `GET/POST /api/playbook`, `PATCH/DELETE /api/playbook/[id]`
  (Zod-validated, 400 on bad body, no auth).
- `/playbook` lists the 5 seeded rules with enable toggle, edit, delete, plus
  an add-rule form with a closed kind dropdown (no arbitrary code, no eval).
- How to add a rule: open `/playbook`, fill title + one-sentence body, pick
  severity / appliesTo / condition kind, Add rule. Toggle persists in the DB.
- Mock data still mock; not financial advice; no execution anywhere.

## Data model (`prisma/schema.prisma`)

- `Candle` — unique `(symbol, timeframe, openTime)`
- `CalendarEvent` — unique `externalId`, `affectedPairs` JSON
- `NewsItem` — unique `url`, `currencies`/`pairTags` JSON, `impactScore` 0–100
- `IngestRun` — `kind`, `status`, timings, `error`, `stats` JSON
- `PlaybookRule` — Phase 4a written rules (severity, appliesTo, whenJson, sortOrder)

Prices are stored as **strings** (providers return decimal strings; stored verbatim — no
float rounding, and identical behaviour on SQLite and Postgres).

## Not included (later phases)

Broker execution · strategy-video RAG ·
user accounts & payments · signal generation · pairs beyond the starter universe.
