"use client";

// New-entry form: prices → live planned R (client-side preview of the same
// formula the server stores) + playbook verdict preview from
// /api/journal/preview BEFORE save. The server re-runs the same gate on POST;
// nothing here decides the verdict or recommends anything.

import { useEffect, useRef, useState } from "react";
import { PAIRS, PAIR_DISPLAY, TIMEFRAMES, type Pair, type Timeframe } from "@/lib/data/universe";
import {
  computePlannedR,
  JOURNAL_DIRECTIONS,
  type JournalDirection,
  type JournalEntryDto,
} from "@/lib/journal/types";
import { previewJournalEntry, createJournalEntry, type PreviewResponse } from "@/lib/api/journal";

export type JournalPrefill = {
  pair: string;
  timeframe: string;
  direction: JournalDirection | null;
  entryPrice?: number;
  stopPrice?: number;
  targetPrice?: number;
  source: "from_setup" | "manual";
};

const VERDICT_STYLES: Record<string, string> = {
  allow: "bg-emerald-500/15 text-emerald-300",
  downgrade: "bg-amber-500/15 text-amber-300",
  block: "bg-rose-500/15 text-rose-300",
};

function toNum(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function JournalNewEntry({
  prefill,
  onSaved,
}: {
  prefill: JournalPrefill | null;
  onSaved: (entry: JournalEntryDto) => void;
}) {
  const [pair, setPair] = useState<Pair>(
    prefill && (PAIRS as readonly string[]).includes(prefill.pair) ? (prefill.pair as Pair) : "EURUSD",
  );
  const [timeframe, setTimeframe] = useState<Timeframe>(
    prefill && (TIMEFRAMES as readonly string[]).includes(prefill.timeframe)
      ? (prefill.timeframe as Timeframe)
      : "H1",
  );
  const [direction, setDirection] = useState<JournalDirection>(prefill?.direction ?? "long");
  const [entry, setEntry] = useState(prefill?.entryPrice != null ? String(prefill.entryPrice) : "");
  const [stop, setStop] = useState(prefill?.stopPrice != null ? String(prefill.stopPrice) : "");
  const [target, setTarget] = useState(prefill?.targetPrice != null ? String(prefill.targetPrice) : "");
  const [target2, setTarget2] = useState("");
  const [thesis, setThesis] = useState("");
  const [tags, setTags] = useState("");
  const [status, setStatus] = useState<"idea" | "active">("idea");
  const [overrideReason, setOverrideReason] = useState("");
  const [biasNote, setBiasNote] = useState("");
  const source = prefill?.source ?? "manual";

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  const entryN = toNum(entry);
  const stopN = toNum(stop);
  const targetN = toNum(target);
  const plannedR =
    entryN !== null && stopN !== null && targetN !== null
      ? computePlannedR(entryN, stopN, targetN)
      : null;
  const inputsValid = entryN !== null && stopN !== null && targetN !== null && stopN !== entryN;

  // Live verdict preview — debounced; the server re-runs it on save.
  useEffect(() => {
    if (!inputsValid || entryN === null || stopN === null || targetN === null) {
      setPreview(null);
      return;
    }
    const mySeq = ++seq.current;
    const timer = setTimeout(() => {
      setPreviewing(true);
      previewJournalEntry({
        pair,
        timeframe,
        direction,
        entryPrice: entryN,
        stopPrice: stopN,
        targetPrice: targetN,
      })
        .then((res) => {
          if (seq.current === mySeq) setPreview(res);
        })
        .catch(() => undefined)
        .finally(() => {
          if (seq.current === mySeq) setPreviewing(false);
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [pair, timeframe, direction, entryN, stopN, targetN, inputsValid]);

  // Blocked setups can only be saved as ideas; force it and surface the reason.
  useEffect(() => {
    if (preview?.verdict === "block") setStatus("idea");
  }, [preview?.verdict]);

  const blocked = preview?.verdict === "block";
  const biasMissing = preview !== null && !preview.biasLoaded;

  async function handleSave(): Promise<void> {
    setError(null);
    if (!inputsValid || plannedR === null) {
      setError("Entry, stop and target must be positive numbers, and stop cannot equal entry.");
      return;
    }
    if (thesis.trim().length === 0) {
      setError("Thesis is required — this is an analysis journal.");
      return;
    }
    if (blocked && overrideReason.trim().length === 0) {
      setError("This setup is blocked by the playbook. An override reason is required, and it saves as an idea.");
      return;
    }
    if (biasMissing && biasNote.trim().length === 0) {
      setError("No bias snapshot could be loaded. Add a bias note explaining the gap.");
      return;
    }
    setSaving(true);
    try {
      const created = await createJournalEntry({
        pair,
        timeframe,
        direction,
        status,
        entryPrice: entryN,
        stopPrice: stopN,
        targetPrice: targetN,
        target2Price: target2.trim() === "" ? null : toNum(target2),
        thesis: thesis.trim(),
        tags: tags.split(",").map((t) => t.trim()).filter((t) => t.length > 0),
        source,
        overrideReason: overrideReason.trim() === "" ? undefined : overrideReason.trim(),
        biasNote: biasNote.trim() === "" ? undefined : biasNote.trim(),
      });
      setThesis("");
      setTags("");
      setOverrideReason("");
      setBiasNote("");
      setPreview(null);
      onSaved(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the entry.");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none";
  const labelCls = "block text-xs text-slate-400";

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">Log a paper setup</h2>
        <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] uppercase tracking-wide text-slate-400">
          {source === "from_setup" ? "from setup" : "manual"} · analysis only
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Idea or active paper trade — never an order. Snapshots freeze at save time.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className={labelCls}>Pair</label>
          <select className={inputCls} value={pair} onChange={(e) => setPair(e.target.value as Pair)}>
            {PAIRS.map((p) => (
              <option key={p} value={p}>{PAIR_DISPLAY[p]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Timeframe</label>
          <select className={inputCls} value={timeframe} onChange={(e) => setTimeframe(e.target.value as Timeframe)}>
            {TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>{tf}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Direction</label>
          <select
            className={inputCls}
            value={direction}
            onChange={(e) => setDirection(e.target.value as JournalDirection)}
          >
            {JOURNAL_DIRECTIONS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Entry price</label>
          <input className={inputCls} inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="1.0850" />
        </div>
        <div>
          <label className={labelCls}>Stop price</label>
          <input className={inputCls} inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} placeholder="1.0820" />
        </div>
        <div>
          <label className={labelCls}>Target price</label>
          <input className={inputCls} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="1.0910" />
        </div>
        <div>
          <label className={labelCls}>Second target (optional)</label>
          <input className={inputCls} inputMode="decimal" value={target2} onChange={(e) => setTarget2(e.target.value)} placeholder="—" />
        </div>
        <div>
          <label className={labelCls}>Save as</label>
          <select
            className={inputCls}
            value={status}
            disabled={blocked}
            onChange={(e) => setStatus(e.target.value as "idea" | "active")}
          >
            <option value="idea">idea</option>
            <option value="active">active</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Tags (comma separated)</label>
          <input className={inputCls} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="london-open, range" />
        </div>
      </div>

      <div className="mt-3">
        <label className={labelCls}>Thesis — why this setup exists</label>
        <textarea
          className={`${inputCls} min-h-20 resize-y`}
          value={thesis}
          maxLength={1000}
          onChange={(e) => setThesis(e.target.value)}
          placeholder="Structure, bias and what would invalidate the idea."
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5">
          <span className="text-xs text-slate-500">Planned R</span>{" "}
          <span className={`font-semibold ${plannedR !== null && plannedR > 0 ? "text-emerald-300" : "text-slate-300"}`}>
            {plannedR !== null ? `${plannedR.toFixed(2)}R` : "—"}
          </span>
        </span>
        {preview && (
          <span className={`rounded-md px-3 py-1.5 text-xs font-semibold ${VERDICT_STYLES[preview.verdict] ?? "bg-slate-800 text-slate-300"}`}>
            playbook: {preview.verdict}
            {preview.grade ? ` · grade ${preview.grade}` : ""}
            {previewing ? " (checking…)" : ""}
          </span>
        )}
        {!preview && previewing && <span className="text-xs text-slate-500">Checking playbook…</span>}
        {preview && preview.biasDirection && (
          <span className="text-xs text-slate-500">
            bias {preview.biasDirection} ({preview.biasConfidence}%)
          </span>
        )}
        {preview && !preview.biasLoaded && <span className="text-xs text-amber-300">no bias snapshot</span>}
      </div>

      {preview && preview.fired.length > 0 && (
        <p className="mt-2 text-xs text-amber-300">
          {preview.verdict === "block" ? "Blocked by: " : "Playbook: "}
          {preview.fired.map((f) => f.title).join("; ")}
        </p>
      )}
      {preview && preview.verdict === "downgrade" && (
        <p className="mt-2 text-xs text-amber-300">Downgraded — visible here, saved as-is.</p>
      )}
      {blocked && (
        <div className="mt-3">
          <label className={labelCls}>Override reason (required — saves as idea, excluded from stats by default)</label>
          <input
            className={inputCls}
            value={overrideReason}
            maxLength={1000}
            onChange={(e) => setOverrideReason(e.target.value)}
            placeholder="Why log a blocked setup anyway"
          />
        </div>
      )}
      {biasMissing && (
        <div className="mt-3">
          <label className={labelCls}>Bias note (required — no bias snapshot could be loaded)</label>
          <input
            className={inputCls}
            value={biasNote}
            maxLength={1000}
            onChange={(e) => setBiasNote(e.target.value)}
            placeholder="Why bias is missing for this pair"
          />
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>
      )}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={saving || !inputsValid}
        className="mt-3 rounded-md border border-sky-500 bg-sky-500/15 px-4 py-2 text-sm font-medium text-sky-200 hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save paper setup"}
      </button>
      <span className="ml-3 text-xs text-slate-500">
        Not financial advice. No execution — this form cannot place orders.
      </span>
    </section>
  );
}
