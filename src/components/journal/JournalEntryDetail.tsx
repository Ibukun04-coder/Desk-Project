"use client";

// Entry detail: log-time snapshots (bias, playbook, SMC), the close form, and
// the review note. The close form shows the computed realized R BEFORE the
// confirm — the server recomputes it from the stored entry/stop regardless.

import { useState } from "react";
import {
  classifyResult,
  computeRealizedR,
  JOURNAL_EXIT_REASONS,
  type JournalEntryDto,
  type JournalExitReason,
} from "@/lib/journal/types";
import { closeJournalEntry, updateJournalEntry } from "@/lib/api/journal";

const VERDICT_STYLES: Record<string, string> = {
  allow: "bg-emerald-500/15 text-emerald-300",
  downgrade: "bg-amber-500/15 text-amber-300",
  block: "bg-rose-500/15 text-rose-300",
};

const STATUS_STYLES: Record<string, string> = {
  idea: "bg-slate-500/15 text-slate-300",
  active: "bg-sky-500/15 text-sky-300",
  closed: "bg-emerald-500/15 text-emerald-300",
  invalidated: "bg-rose-500/15 text-rose-300",
  expired: "bg-amber-500/15 text-amber-300",
};

const RESULT_STYLES: Record<string, string> = {
  win: "text-emerald-300",
  loss: "text-rose-300",
  breakeven: "text-slate-300",
  scratched: "text-slate-500",
};

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`text-right text-slate-300 ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}

export function JournalEntryDetail({
  entry,
  onUpdated,
}: {
  entry: JournalEntryDto;
  onUpdated: (entry: JournalEntryDto) => void;
}) {
  const isOpen = entry.status === "idea" || entry.status === "active";
  const [exitPrice, setExitPrice] = useState("");
  const [exitReason, setExitReason] = useState<JournalExitReason>("manual");
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit-in-place for thesis/tags while open — snapshots are never editable.
  const [editing, setEditing] = useState(false);
  const [editThesis, setEditThesis] = useState(entry.thesis);
  const [editTags, setEditTags] = useState(entry.tags.join(", "));

  const exitN = exitPrice.trim() === "" ? null : Number(exitPrice);
  const validExit = exitN !== null && Number.isFinite(exitN) && exitN > 0;
  const previewR = validExit
    ? computeRealizedR(entry.direction, entry.entryPrice, entry.stopPrice, exitN as number)
    : null;
  const previewResult = previewR !== null ? classifyResult(previewR) : "scratched";

  async function handleClose(): Promise<void> {
    setError(null);
    const reasonSkipsPrice = exitReason === "invalidated" || exitReason === "expired";
    if (!reasonSkipsPrice && !validExit) {
      setError("This close reason needs an exit price to compute realized R.");
      return;
    }
    setBusy(true);
    try {
      const updated = await closeJournalEntry(entry.id, {
        exitReason,
        ...(validExit ? { exitPrice: exitN } : {}),
        ...(reviewNote.trim() !== "" ? { reviewNote: reviewNote.trim() } : {}),
      });
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not close the entry.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdits(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const updated = await updateJournalEntry(entry.id, {
        thesis: editThesis.trim(),
        tags: editTags.split(",").map((t) => t.trim()).filter((t) => t.length > 0),
      });
      onUpdated(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the edits.");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none";

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${STATUS_STYLES[entry.status]}`}>
              {entry.status}
            </span>
            <span className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${entry.direction === "long" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
              {entry.direction}
            </span>
            {entry.playbookSnapshot && (
              <span className={`rounded px-2 py-0.5 text-xs font-semibold ${VERDICT_STYLES[entry.playbookSnapshot.verdict]}`}>
                {entry.playbookSnapshot.verdict}
              </span>
            )}
            {entry.result && (
              <span className={`text-xs font-semibold uppercase ${RESULT_STYLES[entry.result]}`}>{entry.result}</span>
            )}
            {entry.realizedR !== null && (
              <span className={`text-sm font-semibold ${entry.realizedR > 0.1 ? "text-emerald-300" : entry.realizedR < -0.1 ? "text-rose-300" : "text-slate-300"}`}>
                {entry.realizedR > 0 ? "+" : ""}
                {entry.realizedR.toFixed(2)}R
              </span>
            )}
          </div>
          <span className="text-xs text-slate-500">
            {entry.source === "from_setup" ? "from setup" : "manual"} · logged {entry.createdAt.slice(0, 16).replace("T", " ")} UTC
          </span>
        </div>

        <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          <Row label="Pair / timeframe" value={`${entry.pair} ${entry.timeframe}`} />
          <Row label="Planned R" value={`${entry.plannedR.toFixed(2)}R`} />
          <Row label="Entry" value={String(entry.entryPrice)} />
          <Row label="Stop" value={String(entry.stopPrice)} />
          <Row label="Target" value={String(entry.targetPrice)} />
          <Row label="Target 2" value={entry.target2Price != null ? String(entry.target2Price) : "—"} />
        </dl>

        {entry.overrideReason && (
          <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <strong>Override:</strong> {entry.overrideReason}
          </p>
        )}
        {entry.biasNote && (
          <p className="mt-2 text-xs text-slate-400">
            <strong className="text-slate-300">Bias note:</strong> {entry.biasNote}
          </p>
        )}

        {editing ? (
          <div className="mt-3 space-y-2">
            <textarea
              className={`${inputCls} min-h-20 resize-y`}
              value={editThesis}
              maxLength={1000}
              onChange={(e) => setEditThesis(e.target.value)}
            />
            <input
              className={inputCls}
              value={editTags}
              onChange={(e) => setEditTags(e.target.value)}
              placeholder="tags, comma, separated"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleSaveEdits()}
                disabled={busy || editThesis.trim().length === 0}
                className="rounded-md border border-sky-500 bg-sky-500/15 px-3 py-1.5 text-sm text-sky-200 disabled:opacity-40"
              >
                {busy ? "Saving…" : "Save edits"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-400"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-slate-300">{entry.thesis}</p>
              {isOpen && (
                <button
                  type="button"
                  onClick={() => {
                    setEditThesis(entry.thesis);
                    setEditTags(entry.tags.join(", "));
                    setEditing(true);
                  }}
                  className="shrink-0 text-xs text-sky-400 hover:underline"
                >
                  edit
                </button>
              )}
            </div>
            {entry.tags.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {entry.tags.map((t) => (
                  <li key={t} className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
                    {t}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Log-time snapshots — read-only, never refreshed. */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-sm font-semibold text-slate-200">Snapshots at log time</h3>
        <p className="mt-0.5 text-xs text-slate-500">Frozen when saved — later bias or playbook edits never rewrite this.</p>
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Bias</p>
            {entry.biasSnapshot ? (
              <ul className="mt-1 space-y-0.5 text-xs text-slate-400">
                <li className="text-slate-300">
                  {entry.biasSnapshot.direction} · {entry.biasSnapshot.confidence}%
                </li>
                {entry.biasSnapshot.drivers.slice(0, 5).map((d, i) => (
                  <li key={i}>· {d.text}</li>
                ))}
                <li className="text-slate-500">invalidation: {entry.biasSnapshot.invalidation}</li>
                <li className="text-slate-600">{entry.biasSnapshot.asOf.slice(0, 16).replace("T", " ")} UTC</li>
              </ul>
            ) : (
              <p className="mt-1 text-xs text-slate-500">No bias snapshot — see bias note above.</p>
            )}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Playbook</p>
            {entry.playbookSnapshot ? (
              <ul className="mt-1 space-y-0.5 text-xs text-slate-400">
                <li className="text-slate-300">
                  {entry.playbookSnapshot.verdict}
                  {entry.playbookSnapshot.grade ? ` · grade ${entry.playbookSnapshot.grade}` : " · no grade"}
                  {entry.playbookSnapshot.originalGrade && entry.playbookSnapshot.originalGrade !== entry.playbookSnapshot.grade
                    ? ` (was ${entry.playbookSnapshot.originalGrade})`
                    : ""}
                </li>
                <li>alignment {entry.playbookSnapshot.alignment}</li>
                {entry.playbookSnapshot.fired.length > 0 ? (
                  entry.playbookSnapshot.fired.map((f) => (
                    <li key={f.ruleId}>
                      {f.severity === "block" ? "blocked" : "downgraded"}: {f.title}
                    </li>
                  ))
                ) : (
                  <li className="text-slate-500">no rules fired</li>
                )}
                <li className="text-slate-600">{entry.playbookSnapshot.asOf.slice(0, 16).replace("T", " ")} UTC</li>
              </ul>
            ) : (
              <p className="mt-1 text-xs text-slate-500">No playbook snapshot.</p>
            )}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">SMC</p>
            {entry.smcSnapshot ? (
              <ul className="mt-1 space-y-0.5 text-xs text-slate-400">
                <li className="text-slate-300">htf {entry.smcSnapshot.htfBias}</li>
                <li>
                  {entry.smcSnapshot.bos.length} BOS · {entry.smcSnapshot.choch.length} CHOCH ·{" "}
                  {entry.smcSnapshot.fvgs.length} FVG · {entry.smcSnapshot.orderBlocks.length} OB
                </li>
                {entry.smcSnapshot.range && (
                  <li>
                    range {entry.smcSnapshot.range.low}–{entry.smcSnapshot.range.high}
                  </li>
                )}
                {entry.smcSnapshot.entryContext && <li className="text-slate-500">{entry.smcSnapshot.entryContext}</li>}
                <li className="text-slate-600">{entry.smcSnapshot.asOf.slice(0, 16).replace("T", " ")} UTC</li>
              </ul>
            ) : (
              <p className="mt-1 text-xs text-slate-500">No SMC snapshot — insufficient candles at log time.</p>
            )}
          </div>
        </div>
      </section>

      {isOpen ? (
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h3 className="text-sm font-semibold text-slate-200">Close the paper setup</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Realized R is computed on the server from the stored entry/stop and your exit.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs text-slate-400">Exit price</label>
              <input
                className={inputCls}
                inputMode="decimal"
                value={exitPrice}
                onChange={(e) => setExitPrice(e.target.value)}
                placeholder="leave blank if invalidated/expired"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400">Exit reason</label>
              <select
                className={inputCls}
                value={exitReason}
                onChange={(e) => setExitReason(e.target.value as JournalExitReason)}
              >
                {JOURNAL_EXIT_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400">Review note (optional)</label>
              <input
                className={inputCls}
                value={reviewNote}
                maxLength={2000}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="What you learned"
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5">
              <span className="text-xs text-slate-500">Computed at close</span>{" "}
              <span className={`font-semibold ${previewR !== null ? (previewR > 0.1 ? "text-emerald-300" : previewR < -0.1 ? "text-rose-300" : "text-slate-300") : "text-slate-500"}`}>
                {previewR !== null ? `${previewR > 0 ? "+" : ""}${previewR.toFixed(2)}R` : "no price → scratch"}
              </span>
              {previewR !== null && (
                <span className="ml-2 text-xs uppercase text-slate-500">{previewResult}</span>
              )}
            </span>
          </div>

          {error && (
            <p className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => void handleClose()}
            disabled={busy}
            className="mt-3 rounded-md border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:border-slate-500 disabled:opacity-40"
          >
            {busy ? "Closing…" : "Confirm close"}
          </button>
          <span className="ml-3 text-xs text-slate-500">Analysis close — no order was ever placed.</span>
        </section>
      ) : (
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h3 className="text-sm font-semibold text-slate-200">Closed</h3>
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <Row label="Exit reason" value={entry.exitReason ?? "—"} />
            <Row label="Exit price" value={entry.exitPrice != null ? String(entry.exitPrice) : "—"} />
            <Row
              label="Realized R"
              value={entry.realizedR !== null ? `${entry.realizedR > 0 ? "+" : ""}${entry.realizedR.toFixed(2)}R` : "not scored"}
            />
            <Row label="Closed at" value={entry.closedAt ? `${entry.closedAt.slice(0, 16).replace("T", " ")} UTC` : "—"} />
          </dl>
          {entry.reviewNote && (
            <p className="mt-2 text-xs text-slate-400">
              <strong className="text-slate-300">Review:</strong> {entry.reviewNote}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
