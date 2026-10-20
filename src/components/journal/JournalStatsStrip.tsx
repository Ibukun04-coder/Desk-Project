"use client";

// Stats strip: closed-trade numbers + breakdowns. Empty state when there are
// no rows — we never show 0% as if it were a record. Numbers only; this
// component never suggests tuning anything.

import type { JournalStatsResponse } from "@/lib/journal/types";

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function r(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-emerald-300" : tone === "down" ? "text-rose-300" : "text-slate-100";
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: Array<{ key: string; trades: number; winRate: number; expectancyR: number }> }) {
  if (rows.length === 0) return null;
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{title}</p>
      <ul className="mt-1 space-y-0.5 text-xs text-slate-400">
        {rows.map((row) => (
          <li key={row.key} className="flex justify-between gap-3">
            <span className="truncate text-slate-300">{row.key}</span>
            <span className="whitespace-nowrap">
              {row.trades} · {pct(row.winRate)} · {r(row.expectancyR)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function JournalStatsStrip({
  stats,
  totalEntries,
  includeOverrides,
  onToggleOverrides,
}: {
  stats: JournalStatsResponse | null;
  totalEntries: number;
  includeOverrides: boolean;
  onToggleOverrides: () => void;
}) {
  if (totalEntries === 0) {
    return (
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="text-sm font-semibold text-slate-200">Journal stats</p>
        <p className="mt-1 text-sm text-slate-400">
          No paper setups logged yet. Log one above — stats appear once there are rows.
        </p>
      </section>
    );
  }

  if (!stats) {
    return (
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="text-sm text-slate-500">Loading stats…</p>
      </section>
    );
  }

  const emptyTrades = stats.trades === 0;
  const bucketRows = (rec: Record<string, { trades: number; wins: number; winRate: number; expectancyR: number }>) =>
    Object.entries(rec)
      .map(([key, b]) => ({ key, trades: b.trades, winRate: b.winRate, expectancyR: b.expectancyR }))
      .sort((a, b) => b.trades - a.trades);

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-200">Journal stats</p>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={includeOverrides}
            onChange={onToggleOverrides}
            className="h-3.5 w-3.5 accent-amber-500"
          />
          Include blocked-idea overrides
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Open" value={String(stats.openCount)} />
        <Stat label="Closed" value={String(stats.trades)} />
        <Stat
          label="Win rate"
          value={emptyTrades ? "—" : pct(stats.winRate)}
          tone={emptyTrades ? undefined : stats.winRate >= 0.5 ? "up" : "down"}
        />
        <Stat
          label="Expectancy"
          value={emptyTrades ? "—" : r(stats.expectancyR)}
          tone={emptyTrades ? undefined : stats.expectancyR > 0 ? "up" : stats.expectancyR < 0 ? "down" : undefined}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
        <span>{emptyTrades ? "No scored closes yet" : `${stats.wins}W · ${stats.losses}L · ${stats.breakevens}BE`}</span>
        {!emptyTrades && <span>avgWin {r(stats.avgWinR)}</span>}
        {!emptyTrades && <span>avgLoss {r(-stats.avgLossR)}</span>}
        <span className="text-slate-500">
          {stats.includeOverrides ? "overrides included" : "overrides excluded"}
        </span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Breakdown title="By pair" rows={bucketRows(stats.breakdowns.byPair)} />
        <Breakdown title="By timeframe" rows={bucketRows(stats.breakdowns.byTimeframe)} />
        <Breakdown title="By direction" rows={bucketRows(stats.breakdowns.byDirection)} />
        <Breakdown title="By grade" rows={bucketRows(stats.breakdowns.byGrade)} />
        <Breakdown title="By verdict" rows={bucketRows(stats.breakdowns.byVerdict)} />
      </div>
    </section>
  );
}