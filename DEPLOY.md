# Desk Deployment Guide

This guide explains how to deploy the Desk app on Render (or Railway) with a persistent SQLite database.

## Prerequisites

- A GitHub account with the repository accessible
- A Render (or Railway) account

## Step 1: Create the service from this repo

1. Log in to [Render](https://render.com) (or [Railway](https://railway.app)).
2. Click **New → Web Service**.
3. Connect your GitHub repository.
4. Select the `Desk-Project` repository.
5. Render will auto-detect the `render.yaml` (or `package.json` scripts).

## Step 2: Attach a persistent disk mounted at /data

1. In the service settings, add a **Persistent Disk**.
2. Name it `data`.
3. Mount path: `/data`.
4. Size: at least `1 GB` (or larger if you expect lots of data).
5. Make sure the disk is **writable** and persists across deploys.

## Step 3: Set DATABASE_URL env var

Add the following environment variable to the service:

```
DATABASE_URL=file:/data/desk.db
```

This tells the app to store the SQLite database on the persistent disk, not inside the repo and not in `/tmp`.

(Optional) You can also set `PRICE_PROVIDER=mock` so the app boots immediately without API keys. The mock mode works with zero configured keys.

## Step 4: Deploy and verify

1. Click **Deploy** (Render will auto-deploy on main branch push).
2. Wait for the build to complete. The build log will show:
   - `npm ci && npx prisma generate && npm run build`
   - `npx prisma migrate deploy` — this creates the SQLite tables on the persistent disk.
   - `npm run start` — the Next.js server starts.
3. After the first successful deploy, open the service URL (not github.io).
4. Confirm that **“Desk — Data Health”** renders at the root URL.

## Step 5 (Optional): Run ingest once

To populate the database with initial data, run the ingest script via the Render dashboard or CLI:

```
npm run ingest -- --once
```

This will fill the candles, calendar events, and news items so the tables are not empty on first load.

---

## Environment Variables (from .env.example)

The following variables are recognized from `.env.example`. Most are only needed for live price providers; mock mode works with empty values.

### Required for mock mode (zero API keys)

| Variable | Purpose | Example |
|---|---|---|
| `DATABASE_URL` | Points SQLite to the persistent disk | `file:/data/desk.db` |
| `PRICE_PROVIDER` | Selects price provider | `mock` |
| `TWELVEDATA_API_KEY` | Twelvedata API key | (leave empty for mock) |
| `POLYGON_API_KEY` | Polygon API key | (leave empty for mock) |
| `OANDA_API_KEY` | OANDA API key | (leave empty for mock) |
| `OANDA_ACCOUNT_ID` | OANDA account ID | (leave empty for mock) |
| `NEWS_PROVIDER` | News provider | `mock` |
| `FINNHUB_API_KEY` | Finnhub API key | (leave empty for mock) |
| `NEWS_API_KEY` | NewsAPI key | (leave empty for mock) |
| `INGEST_INTERVAL_SECONDS` | Ingest interval | `60` |

### Optional (for live providers)

| Variable | Purpose |
|---|---|
| `CALENDAR_PROVIDER` | Calendar provider (`faireconomy`, `finnhub`, `mock`) |
| `OPENAI_API_KEY` | LLM key for bias desk (not required for Phase 1) |
| `XAI_API_KEY` | LLM key for bias desk |
| `GROK_API_KEY` | LLM key for bias desk |

> **Note:** Leave all API key variables empty if you want the app to run in pure mock mode. The app will boot with `usedLlm=false` on every result, and `POST /api/bias/recompute` + `POST /api/ingest/all` will not call an LLM.

---

## Disabling GitHub Pages (important)

The GitHub Pages site at `ibukun04-coder.github.io/Desk-Project/` serves the `README.md` because there is no `index.html` in the root. To stop Pages from publishing the README and instead deploy the live Node server:

1. Go to **GitHub** → your repository → **Settings**.
2. In the left sidebar, click **Pages** (under "Code & automation").
3. Under "Build and deployment", find **Source**.
4. Change **Source** from `Deploy from a branch` to **Disable**.
5. Click **Save**.

Alternatively, the new GitHub Actions workflow `.github/workflows/disable-pages.yml` will automatically disable Pages on every push to main or master.

The `README.md` will remain the repo landing page on `github.com`, but `github.io` will no longer serve it as a static site. The live app will be available at your Render/Railway URL instead.

---

## Directory structure note

- `prisma/*.db` files are gitignored and must never be committed. The SQLite database lives on the persistent disk only.
- `src/app/page.tsx` is force-dynamic and queries Prisma — it must remain server-side.
- `src/app/api/*` routes must stay server-side (they are `NextResponse` handlers).
- Do **not** set `output: 'export'` in `next.config.ts` — the app uses traditional Next.js server rendering.