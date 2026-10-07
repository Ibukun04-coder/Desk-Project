"use client";

import { useState } from "react";
import type { RecomputeResponse } from "@/lib/api/bias";

export function RecomputeButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/bias/recompute", { method: "POST" });
      const body = (await res.json()) as RecomputeResponse & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMessage(`Recomputed ${body.computed} pairs — bias updated.`);
    } catch (err) {
      setMessage(err instanceof Error ? `Recompute failed: ${err.message}` : "Recompute failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="rounded-md border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
      >
        {busy ? "Recomputing…" : "Recompute bias"}
      </button>
      {message && <p className="max-w-md text-right text-xs text-emerald-400">{message}</p>}
    </div>
  );
}
