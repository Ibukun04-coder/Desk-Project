import { formatDistanceToNow } from "date-fns";
import type { ReactNode } from "react";
import { RunIngestButton } from "./components/RunIngestButton";
import { getCalendar, getDataHealth, getNews } from "@/lib/data/queries";
import { PAIRS, PAIR_DISPLAY, TIMEFRAMES } from "@/lib/data/universe";

export const dynamic = "force-dynamic";

function utc(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

const STATUS_STYLES: Record<string, string> = {
  success: "bg-emerald-500/15 text-emerald-400",
  partial: "bg-amber-500/15 text-amber-400",
  failed: "bg-rose-500/15 text-rose-400",
  running: "bg-sky-500/15 text-sky-400",
};

const IMPACT_STYLES: Record<string, string> = {
  high: "bg-rose-500/15 text-rose-400",
  medium: "bg-amber-500/15 text-amber-400",
  low: "bg-slate-500/15 text-slate-400",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-semibold text-slate-100">{title}</h2>
      {children}
    </section>
  );
}

const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400";
const TD = "px-3 py-2 text-sm text-slate-200";

export default async function DataHealthPage() {
  const [health, upcoming, latestNews] = await Promise.all([
    getDataHealth(),
    getCalendar({ from: new Date(), to: new Date(Date.now() + 30 * 86_400_000), impact: "high" }),
    getNews({ limit: 10 }),
  ]);
  const events = upcoming.slice(0, 10);
  const modes = health.modes;
  const mockKinds = (["price", "calendar", "news"] as const).filter(
    (kind) => modes[kind].mode === "mock",
  );
  const runsByKind = new Map(health.lastRuns.map((run) => [run.kind, run]));
  const countMap = new Map(
    health.candleCounts.map((c) => [`${c.symbol}|${c.timeframe}`, c.count] as const),
  );

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Desk — Data Health</h1>
          <p className="mt-1 text-sm text-slate-400">
            Phase 1 · data layer only · generated {utc(health.generatedAt)}
          </p>
        </div>
        <RunIngestButton />
      </header>

      {mockKinds.length > 0 && (
        <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <strong>Mock feeds:</strong> {mockKinds.join(", ")} — add the matching key to{" "}
          <code>.env</code> and restart to go live. Feeds with keys already run live;
          stored data is served normally if a provider fails.
        </div>
      )}
      {mockKinds.length === 0 && (
        <div className="mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <strong>All feeds live</strong> — price, calendar, and news are ingesting from real providers.
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        {([["price", "Price"], ["calendar", "Calendar"], ["news", "News"]] as const).map(([kind, label]) => (
          <span key={kind} className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-slate-300">
            {label}: <span className="font-semibold">{modes[kind].name}</span>{" "}
            <span className={modes[kind].mode === "live" ? "text-emerald-400" : "text-amber-300"}>
              {modes[kind].mode === "live" ? "LIVE" : "MOCK"}
            </span>{" "}
            — {modes[kind].reason}
          </span>
        ))}
        <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-slate-300">
          interval: {modes.ingestIntervalSeconds}s
        </span>
      </div>

      <Section title="Last ingest per kind">
        <div className="overflow-x-auto rounded-md border border-slate-800">
          <table className="w-full">
            <thead className="bg-slate-900">
              <tr>
                <th className={TH}>Kind</th>
                <th className={TH}>Status</th>
                <th className={TH}>Started</th>
                <th className={TH}>Fetched</th>
                <th className={TH}>Inserted</th>
                <th className={TH}>Updated</th>
                <th className={TH}>Skipped</th>
                <th className={TH}>Provider</th>
                <th className={TH}>Error</th>
              </tr>
            </thead>
            <tbody>
              {(["price", "calendar", "news"] as const).map((kind) => {
                const run = runsByKind.get(kind);
                if (!run) {
                  return (
                    <tr key={kind} className="border-t border-slate-800">
                      <td className={TD}>{kind}</td>
                      <td className={`${TD} text-slate-500`} colSpan={8}>
                        never run — click “Run ingest now”
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={kind} className="border-t border-slate-800">
                    <td className={TD}>{kind}</td>
                    <td className={TD}>
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[run.status] ?? ""}`}>
                        {run.status}
                      </span>
                    </td>
                    <td className={TD} title={utc(run.startedAt)}>
                      {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
                    </td>
                    <td className={TD}>{run.stats.fetched ?? "—"}</td>
                    <td className={TD}>{run.stats.inserted ?? "—"}</td>
                    <td className={TD}>{run.stats.updated ?? "—"}</td>
                    <td className={TD}>{run.stats.skipped ?? "—"}</td>
                    <td className={TD}>{run.stats.provider ?? "—"}</td>
                    <td className={`${TD} max-w-xs truncate text-rose-400`} title={run.error ?? ""}>
                      {run.error ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Candle counts per symbol / timeframe">
        <div className="overflow-x-auto rounded-md border border-slate-800">
          <table className="w-full">
            <thead className="bg-slate-900">
              <tr>
                <th className={TH}>Symbol</th>
                {TIMEFRAMES.map((tf) => (
                  <th key={tf} className={TH}>{tf}</th>
                ))}
                <th className={TH}>Total</th>
              </tr>
            </thead>
            <tbody>
              {PAIRS.map((symbol) => {
                const rowTotal = TIMEFRAMES.reduce(
                  (sum, tf) => sum + (countMap.get(`${symbol}|${tf}`) ?? 0),
                  0,
                );
                return (
                  <tr key={symbol} className="border-t border-slate-800">
                    <td className={TD}>{PAIR_DISPLAY[symbol]}</td>
                    {TIMEFRAMES.map((tf) => (
                      <td key={tf} className={TD}>
                        {countMap.get(`${symbol}|${tf}`) ?? 0}
                      </td>
                    ))}
                    <td className={`${TD} font-semibold`}>{rowTotal}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-700 bg-slate-900">
                <td className={TD}>All</td>
                <td className={TD} colSpan={TIMEFRAMES.length + 1}>
                  {health.totalCandles} candles stored
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      <Section title="Next 10 high-impact calendar events">
        {events.length === 0 ? (
          <p className="text-sm text-slate-500">No upcoming high-impact events stored yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-800">
            <table className="w-full">
              <thead className="bg-slate-900">
                <tr>
                  <th className={TH}>Scheduled (UTC)</th>
                  <th className={TH}>Event</th>
                  <th className={TH}>Ccy</th>
                  <th className={TH}>Impact</th>
                  <th className={TH}>Actual / Forecast / Previous</th>
                  <th className={TH}>Affected pairs</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-t border-slate-800">
                    <td className={TD} title={utc(event.scheduledAt)}>
                      {event.scheduledAt.slice(0, 16).replace("T", " ")}
                    </td>
                    <td className={TD}>{event.title}</td>
                    <td className={TD}>{event.currency}</td>
                    <td className={TD}>
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${IMPACT_STYLES[event.impact] ?? ""}`}>
                        {event.impact}
                      </span>
                    </td>
                    <td className={TD}>
                      {event.actual ?? "—"} / {event.forecast ?? "—"} / {event.previous ?? "—"}
                    </td>
                    <td className={TD}>
                      {event.affectedPairs.map((p) => PAIR_DISPLAY[p]).join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Latest 10 news items">
        {latestNews.length === 0 ? (
          <p className="text-sm text-slate-500">No news items stored yet.</p>
        ) : (
          <ul className="space-y-2">
            {latestNews.map((item) => (
              <li key={item.id} className="rounded-md border border-slate-800 bg-slate-900/60 px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-sky-400 hover:underline"
                  >
                    {item.title}
                  </a>
                  <span className="text-xs text-slate-500" title={utc(item.publishedAt)}>
                    {item.source} · {item.publishedAt.slice(0, 16).replace("T", " ")} UTC · score{" "}
                    {item.impactScore}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-slate-400">{item.summary}</p>
                <p className="mt-1 text-xs text-slate-500">
                  tags: {item.pairTags.map((p) => PAIR_DISPLAY[p]).join(", ") || "—"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

