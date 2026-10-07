# Changelog

## Phase 1: data layer

- Prisma schema + migration: `Candle`, `CalendarEvent`, `NewsItem`, `IngestRun` (SQLite).
- Provider adapters behind stable interfaces: price (TwelveData / Polygon / OANDA / deterministic
  mock), calendar (Finnhub economic calendar / mock), news (central-bank RSS + Finnhub / NewsAPI /
  mock) — selected by env keys, mock logged clearly when keys are missing.
- Idempotent ingest runner: upserts by natural keys, per-provider rate limiting, one retry on
  429/5xx with backoff, `IngestRun` bookkeeping, fetched/inserted/updated/skipped logging,
  partial failure never wipes stored data.
- Ingest entry points: `npm run ingest` (+ `-- --watch`), `POST /api/ingest/{price,calendar,news,all}`.
- Read APIs: `GET /api/candles`, `/api/calendar`, `/api/news`, `/api/universe`, `/api/health/data`
  (Zod-validated, 400 on bad input, typed JSON).
- Minimal Data Health page at `/`: mock-mode banner, last ingest per kind, candle counts per
  symbol/timeframe, next 10 high-impact events, latest 10 news, "Run ingest now" button.
