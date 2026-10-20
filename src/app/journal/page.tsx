import type { Metadata } from "next";
import { JournalView, type JournalPrefill } from "@/components/journal/JournalView";

// Phase 5 paper journal. Server shell only — data loads client-side through
// the same routes everything else uses. Analysis records, not orders.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Desk — Journal",
  description: "Phase 5 paper journal: logged setups with log-time snapshots.",
};

type Search = { [key: string]: string | string[] | undefined };

function first(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

/** "Journal this setup" links here with query params from the pair desk. */
function readPrefill(sp: Search): JournalPrefill | null {
  const pair = first(sp.pair);
  const timeframe = first(sp.timeframe);
  if (!pair || !timeframe) return null;
  const num = (k: string): number | undefined => {
    const raw = first(sp[k]);
    if (raw == null || raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const direction = first(sp.direction);
  return {
    pair,
    timeframe,
    direction: direction === "short" ? "short" : direction === "long" ? "long" : null,
    entryPrice: num("entryPrice"),
    stopPrice: num("stopPrice"),
    targetPrice: num("targetPrice"),
    source: first(sp.source) === "from_setup" ? "from_setup" : "manual",
  };
}

export default function JournalPage({ searchParams }: { searchParams: Promise<Search> }) {
  // searchParams is a Promise in the App Router; awaiting it forces dynamic
  // rendering, so the prefill from the pair desk is available on first paint.
  return <JournalPageInner searchParams={searchParams} />;
}

async function JournalPageInner({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  return <JournalView prefill={readPrefill(sp)} />;
}