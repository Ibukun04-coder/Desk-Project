"use client";

// /playbook client: rule list (toggle/edit/delete) + add-rule form with a
// closed dropdown of whenJson kinds (never arbitrary code).

import { useCallback, useEffect, useState } from "react";
import type { PlaybookRuleDto, RuleAppliesTo, RuleSeverity, WhenKind } from "@/lib/playbook/rules";
import { WHEN_KINDS } from "@/lib/playbook/rules";

type RulesResponse = { rules: PlaybookRuleDto[]; count: number };

const KIND_LABELS: Record<WhenKind, string> = {
  ob_overlap: "Block when entry overlaps opposing OB",
  not_aligned: "Fire when alignment is not ALIGNED",
  event_window: "Block before high-impact event",
  premium_discount: "Downgrade premium-long / discount-short",
};

const KIND_HINTS: Record<WhenKind, string> = {
  ob_overlap: "Fires when the entry zone overlaps an unmitigated opposing order block (demand blocks shorts, supply blocks longs).",
  not_aligned: "Fires whenever the SMC/fundamental alignment is anything but ALIGNED.",
  event_window: "Fires when a stored high-impact calendar event on the pair is upcoming within N minutes. Past or distant events never fire.",
  premium_discount: "Fires when a long entry sits in premium (above range midpoint) or a short sits in discount (below). Skipped when range is null.",
};

const SEVERITY_STYLES: Record<RuleSeverity, string> = {
  block: "bg-rose-500/15 text-rose-400",
  downgrade: "bg-amber-500/15 text-amber-400",
};

export function PlaybookView({ initialRules }: { initialRules: PlaybookRuleDto[] }) {
  const [rules, setRules] = useState<PlaybookRuleDto[]>(initialRules);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<RuleSeverity>("block");
  const [appliesTo, setAppliesTo] = useState<RuleAppliesTo>("all");
  const [kind, setKind] = useState<WhenKind>("ob_overlap");
  const [obKind, setObKind] = useState<"demand" | "supply">("demand");
  const [minutes, setMinutes] = useState(30);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/playbook");
    const data = (await res.json()) as RulesResponse;
    setRules(data.rules);
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  function buildWhenJson(): string {
    switch (kind) {
      case "ob_overlap":
        return JSON.stringify({ kind, obKind });
      case "event_window":
        return JSON.stringify({ kind, minutes: Math.max(1, Math.min(1440, minutes || 30)) });
      case "not_aligned":
      case "premium_discount":
        return JSON.stringify({ kind });
    }
  }

  async function withBusy(key: string, fn: () => Promise<void>): Promise<void> {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleAdd(): Promise<void> {
    if (title.trim().length < 3) {
      setError("Title needs at least 3 characters.");
      return;
    }
    await withBusy("add", async () => {
      const res = await fetch("/api/playbook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          severity,
          appliesTo,
          whenJson: buildWhenJson(),
          enabled: true,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setTitle("");
      setBody("");
    });
  }

  async function handleToggle(rule: PlaybookRuleDto): Promise<void> {
    await withBusy(`toggle-${rule.id}`, async () => {
      const res = await fetch(`/api/playbook/${rule.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    });
  }

  async function handleDelete(id: string): Promise<void> {
    await withBusy(`delete-${id}`, async () => {
      const res = await fetch(`/api/playbook/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    });
  }

  function startEdit(rule: PlaybookRuleDto): void {
    setEditingId(rule.id);
    setEditTitle(rule.title);
    setEditBody(rule.body);
  }

  async function handleSaveEdit(id: string): Promise<void> {
    if (editTitle.trim().length < 3) {
      setError("Title needs at least 3 characters.");
      return;
    }
    await withBusy(`save-${id}`, async () => {
      const res = await fetch(`/api/playbook/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: editTitle.trim(), body: editBody.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEditingId(null);
    });
  }


  return (
    <div>
      <header>
        <h1 className="text-2xl font-bold text-white">Playbook — written SMC rules</h1>
        <p className="mt-1 text-sm text-slate-400">
          Phase 4a · text rules, not videos · rules beat the model: an enabled block rejects grade A,
          a downgrade caps A at B · {rules.length} rule{rules.length === 1 ? "" : "s"}
        </p>
      </header>

      {error && (
        <div className="mt-4 rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <section className="mt-4 space-y-3">
        {rules.map((rule) => (
          <article key={rule.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            {editingId === rule.id ? (
              <div className="space-y-2">
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                />
                <textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void handleSaveEdit(rule.id)}
                    className="rounded-md border border-sky-600 bg-sky-600/20 px-3 py-1.5 text-sm text-sky-300 disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-slate-100">{rule.title}</h2>
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${SEVERITY_STYLES[rule.severity]}`}>
                      {rule.severity}
                    </span>
                    <span className="rounded bg-slate-700/40 px-2 py-0.5 text-xs text-slate-300">{rule.appliesTo}</span>
                    {!rule.enabled && (
                      <span className="rounded bg-slate-700/40 px-2 py-0.5 text-xs text-slate-500">disabled</span>
                    )}
                    {rule.when === null && (
                      <span className="rounded bg-rose-500/10 px-2 py-0.5 text-xs text-rose-400">ignored: unknown condition</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-400">{rule.body}</p>
                  <p className="mt-1 font-mono text-xs text-slate-500">
                    when: {rule.when ? rule.when.kind : "unparseable — evaluator skips this rule"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void handleToggle(rule)}
                    className="rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-50"
                  >
                    {rule.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(rule)}
                    className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void handleDelete(rule.id)}
                    className="rounded-md border border-rose-800 px-3 py-1.5 text-xs text-rose-300 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </article>
        ))}
      </section>

      <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-sm font-semibold text-slate-200">Add rule</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-slate-400">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Do not chase extended moves"
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            />
          </label>
          <label className="block text-xs text-slate-400">
            Condition kind
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as WhenKind)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            >
              {WHEN_KINDS.map((k) => (
                <option key={k} value={k}>{KIND_LABELS[k]}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-3 block text-xs text-slate-400">
          Body (one sentence a trader can read)
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
          />
        </label>
        <p className="mt-1 text-xs text-slate-500">{KIND_HINTS[kind]}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <label className="block text-xs text-slate-400">
            Severity
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as RuleSeverity)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            >
              <option value="block">block (reject A)</option>
              <option value="downgrade">downgrade (A → B)</option>
            </select>
          </label>
          <label className="block text-xs text-slate-400">
            Applies to
            <select
              value={appliesTo}
              onChange={(e) => setAppliesTo(e.target.value as RuleAppliesTo)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            >
              <option value="all">all</option>
              <option value="long">long</option>
              <option value="short">short</option>
            </select>
          </label>
          {kind === "ob_overlap" && (
            <label className="block text-xs text-slate-400">
              Opposing OB kind
              <select
                value={obKind}
                onChange={(e) => setObKind(e.target.value as "demand" | "supply")}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
              >
                <option value="demand">demand (blocks shorts)</option>
                <option value="supply">supply (blocks longs)</option>
              </select>
            </label>
          )}
          {kind === "event_window" && (
            <label className="block text-xs text-slate-400">
              Minutes before event
              <input
                type="number"
                min={1}
                max={1440}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
              />
            </label>
          )}
        </div>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void handleAdd()}
          className="mt-3 rounded-md border border-sky-600 bg-sky-600/20 px-4 py-2 text-sm text-sky-300 disabled:opacity-50"
        >
          {busy === "add" ? "Adding…" : "Add rule"}
        </button>
      </section>

      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-500">
        <p><strong className="text-slate-300">Disclaimer.</strong> Not financial advice. The playbook constrains
        informational setups only — no execution exists anywhere in this app. Mock data is still mock.</p>
      </div>
    </div>
  );
}
