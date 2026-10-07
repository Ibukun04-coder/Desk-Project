"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { IngestResult } from "@/lib/data/types";

/** POSTs /api/ingest/all then refreshes the server-rendered health data. */
export function RunIngestButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(): Promise<void> {
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/ingest/all", { method: "POST" });
      const body = (await res.json()) as { data?: IngestResult[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const results = body.data ?? [];
      setSummary(
        results
          .map(
            (r) =>
              `${r.kind}: ${r.status} (+${r.stats.inserted} ~${r.stats.updated} =${r.stats.skipped})`,
          )
          .join("  ·  "),
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
        className="rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Running…" : "Run ingest now"}
      </button>
      {summary && <p className="max-w-md text-right text-xs text-emerald-400">{summary}</p>}
      {error && <p className="max-w-md text-right text-xs text-rose-400">{error}</p>}
    </div>
  );
}
