"use client";

// /journal client: stats strip, filters, entry table (newest first), detail
// with snapshots + close form, and the new-entry form. Analysis records only —
// no execution language anywhere on this desk.

import { useCallback, useEffect, useState } from "react";
import { PAIRS, PAIR_DISPLAY, TIMEFRAMES } from "@/lib/data/universe";
import {
  JOURNAL_RESULTS,
  JOURNAL_STATUSES,
  type JournalEntryDto,
  type JournalStatsResponse,
} from "@/lib/journal/types";
import { fetchJournalList, fetchJournalStats } from "@/lib/api/journal";
import { JournalStatsStrip } from "./JournalStatsStrip";
import { JournalNewEntry, type JournalPrefill } from "./JournalNewEntry";
import { JournalEntryDetail } from "./JournalEntryDetail";

export type { JournalPrefill };

const STATUS_STYLES: Record<string, string> = {
  idea: "bg-slate-500/15 text-slate-300",
  active: "bg-sky-500/15 text-sky-300",
  closed: "bg-emerald-500/15 text-emerald-300",
  invalidated: "bg-rose-500/15 text-rose-300",
  expired: "bg-amber-500/15 text-amber-300",
};

const VERDICT_STYLES: Record<string, string> = {
  allow: "bg-emerald-500/15 text-emerald-300",
  downgrade: "bg-amber-500/15 text-amber-300",
  block: "bg-rose-500/15 text-rose-300",
};

const TH_STYLES = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500";
const TD_STYLES = "px-3 py-2 text-sm text-slate-300";

export function JournalView({ prefill }: { prefill: JournalPrefill | null }) {
  const [entries, setEntries] = useState<JournalEntryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [stats, setStats] = useState<JournalStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(prefill !== null);

  const [pair, setPair] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState("");
  const [includeOverrides, setIncludeOverrides] = useState(false);
  const [pageSize] = useState(25);

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
        if (pair) q.set("pair", pair);
        if (timeframe) q.set("timeframe", timeframe);
        if (status) q.set("status", status);
        if (result) q.set("result", result);
        const sq = new URLSearchParams();
        if (includeOverrides) sq.set("includeOverrides", "true");
        const [list, st] = await Promise.all([
          fetchJournalList(q),
          fetchJournalStats(sq),
        ]);
        setEntries(list.entries);
        setTotal(list.total);
        setPage(list.page);
        setHasMore(list.hasMore);
        setStats(st);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load the journal.");
      } finally {
        setLoading(false);
      }
    },
    [pair, timeframe, status, result, includeOverrides, pageSize],
  );

  useEffect(() => {
    void load(1).catch(() => undefined);
  }, [load]);

  const selected = entries.find((e) => e.id === selectedId) ?? null;

  function handleUpdated(updated: JournalEntryDto): void {
    setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    // Stats shift after any close — refetch in place.
    void load(page).catch(() => undefined);
  }

  function handleSaved(created: JournalEntryDto): void {
    setEntries((prev) => [created, ...prev]);
    setTotal((t) => t + 1);
    setShowForm(false);
    setSelectedId(created.id);
    void load(1).catch(() => undefined);
  }

  const filterCls =
    "rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-300 focus:border-sky-500 focus:outline-none";

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Journal</h1>
          <p className="mt-1 text-sm text-slate-400">
            Phase 5 · paper setups with log-time snapshots · human analysis only
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md border border-sky-500 bg-sky-500/15 px-4 py-2 text-sm font-medium text-sky-200 hover:bg-sky-500/25"
        >
          {showForm ? "Hide form" : "Log a setup"}
        </button>
      </header>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-xs text-slate-500">
        <strong className="text-slate-300">Disclaimer.</strong> Not financial advice. Analysis journal for playbook
        tuning — no execution, this desk cannot place orders.
      </div>

      {showForm && <JournalNewEntry prefill={prefill} onSaved={handleSaved} />}

      <JournalStatsStrip
        stats={stats}
        totalEntries={total}
        includeOverrides={includeOverrides}
        onToggleOverrides={() => setIncludeOverrides((v) => !v)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <select className={filterCls} value={pair} onChange={(e) => setPair(e.target.value)}>
          <option value="">All pairs</option>
          {PAIRS.map((p) => (
            <option key={p} value={p}>{PAIR_DISPLAY[p]}</option>
          ))}
        </select>
        <select className={filterCls} value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
          <option value="">All timeframes</option>
          {TIMEFRAMES.map((tf) => (
            <option key={tf} value={tf}>{tf}</option>
          ))}
        </select>
        <select className={filterCls} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {JOURNAL_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select className={filterCls} value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="">All results</option>
          {JOURNAL_RESULTS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        {(pair || timeframe || status || result) && (
          <button
            type="button"
            onClick={() => {
              setPair("");
              setTimeframe("");
              setStatus("");
              setResult("");
            }}
            className="text-xs text-sky-400 hover:underline"
          >
            clear filters
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <section className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60">
        {loading ? (
          <p className="py-16 text-center text-sm text-slate-500">Loading journal…</p>
        ) : entries.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <p className="text-sm font-medium text-slate-300">
              {total === 0 ? "No paper setups logged yet." : "No entries match these filters."}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {total === 0
                ? "Log a setup above, or hit “Journal this setup” on the pair desk."
                : "Clear a filter to see the rest."}
            </p>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-slate-800">
            <thead>
              <tr>
                <th className={TH_STYLES}>Logged</th>
                <th className={TH_STYLES}>Pair</th>
                <th className={TH_STYLES}>TF</th>
                <th className={TH_STYLES}>Side</th>
                <th className={TH_STYLES}>Playbook</th>
                <th className={TH_STYLES}>Status</th>
                <th className={`${TH_STYLES} text-right`}>Planned R</th>
                <th className={`${TH_STYLES} text-right`}>Realized R</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {entries.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => setSelectedId((cur) => (cur === e.id ? null : e.id))}
                  className={`cursor-pointer transition-colors hover:bg-slate-800/40 ${selectedId === e.id ? "bg-sky-500/10" : ""}`}
                >
                  <td className={`${TD_STYLES} whitespace-nowrap text-slate-400`}>
                    {e.createdAt.slice(0, 16).replace("T", " ")}
                  </td>
                  <td className={TD_STYLES}>{e.pair}</td>
                  <td className={TD_STYLES}>{e.timeframe}</td>
                  <td className={TD_STYLES}>
                    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${e.direction === "long" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
                      {e.direction}
                    </span>
                  </td>
                  <td className={TD_STYLES}>
                    {e.playbookSnapshot ? (
                      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${VERDICT_STYLES[e.playbookSnapshot.verdict] ?? "bg-slate-800 text-slate-300"}`}>
                        {e.playbookSnapshot.verdict}
                        {e.playbookSnapshot.grade ? ` ${e.playbookSnapshot.grade}` : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                  <td className={TD_STYLES}>
                    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${STATUS_STYLES[e.status] ?? "bg-slate-800 text-slate-300"}`}>
                      {e.status}
                    </span>
                  </td>
                  <td className={`${TD_STYLES} text-right`}>{e.plannedR.toFixed(2)}R</td>
                  <td
                    className={`${TD_STYLES} text-right font-semibold ${
                      e.realizedR === null
                        ? "text-slate-600"
                        : e.realizedR > 0.1
                          ? "text-emerald-300"
                          : e.realizedR < -0.1
                            ? "text-rose-300"
                            : "text-slate-300"
                    }`}
                  >
                    {e.realizedR !== null ? `${e.realizedR > 0 ? "+" : ""}${e.realizedR.toFixed(2)}R` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {(page > 1 || hasMore) && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => void load(page - 1)}
            disabled={page <= 1 || loading}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-slate-500 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-slate-500">page {page}</span>
          <button
            type="button"
            onClick={() => void load(page + 1)}
            disabled={!hasMore || loading}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-slate-500 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {selected && (
        <div className="rounded-xl border border-sky-500/40 bg-slate-950/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-200">Entry detail</p>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="text-xs text-slate-400 hover:text-white"
            >
              close
            </button>
          </div>
          <JournalEntryDetail key={selected.id} entry={selected} onUpdated={handleUpdated} />
        </div>
      )}
    </div>
  );
}
