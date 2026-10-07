import { notFound } from "next/navigation";
import { PAIRS, TIMEFRAMES, type Pair, type Timeframe } from "@/lib/data/universe";
import { PairView } from "@/components/pair/PairView";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ timeframe?: string }>;
};

function isPair(s: string): s is Pair {
  return (PAIRS as readonly string[]).includes(s.toUpperCase());
}

function isTimeframe(s: string | undefined): s is Timeframe {
  return !!s && (TIMEFRAMES as readonly string[]).includes(s.toUpperCase());
}

export default async function PairPage({ params, searchParams }: PageProps) {
  const { symbol: raw } = await params;
  const query = await searchParams;
  const upper = raw.toUpperCase();
  if (!isPair(upper)) notFound();
  const tf = isTimeframe(query.timeframe) ? (query.timeframe.toUpperCase() as Timeframe) : "H1";
  return <PairView symbol={upper} initialTimeframe={tf} />;
}
