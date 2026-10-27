import Link from "next/link";
import { BiasCard } from "@/components/BiasCard";
import { PAIRS } from "@/lib/data/universe";
import { getProviderModes } from "@/lib/data/config";
import { getBiasSnapshots } from "@/lib/data/bias";
import { getAllDailyBias } from "@/lib/data/daily-bias";
import { serializeDailyBias } from "@/lib/api/daily-bias";
import { serializeBiasResult } from "@/lib/api/bias";
import { RecomputeButton } from "./RecomputeButton";

export const dynamic = "force-dynamic";

export default async function BiasPage() {
  const modes = getProviderModes();
  const providers = { price: modes.price.name, calendar: modes.calendar.name, news: modes.news.name };
  const llmActive = Boolean(process.env.OPENAI_API_KEY || process.env.XAI_API_KEY || process.env.GROK_API_KEY);
  const snapshots = await getBiasSnapshots();
  const byPair = new Map(snapshots.map((s) => [s.pair, s]));
  const allDaily = await getAllDailyBias();
  const dailyByPair = new Map(allDaily.map((d) => [d.pair, d]));

  return (
    <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Desk — Bias Desk</h1>
            <p className="mt-1 text-sm text-slate-400">
              Phase 2 fundamentals · rules-v1 · deterministic · scored from stored news + calendar
            </p>
          </div>
          <RecomputeButton />
        </header>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PAIRS.map((pair) => {
            const s = byPair.get(pair);
            return (
              <Link key={pair} href={`/pair/${pair}`} className="block rounded-xl transition hover:-translate-y-0.5 hover:border-slate-600">
                <BiasCard
                  pair={pair}
                  biasResult={
                    s
                      ? serializeBiasResult(s, dailyByPair.get(pair) ? serializeDailyBias(dailyByPair.get(pair)!) : null)
                      : {
                          pair,
                          bias: "neutral",
                          confidence: 0,
                          drivers: [],
                          nextEvent: null,
                          invalidation: "Not yet computed — press Recompute bias.",
                          asOf: new Date().toISOString(),
                          method: "rules-v1",
                          usedLlm: false,
                          dailyBias: null,
                        }
                  }
                  providers={providers}
                  llmActive={llmActive}
                />
              </Link>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-slate-500">Click a card to open its Pair desk chart (structure overlays + setups).</p>

        <div className="mt-6 rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
          <strong className="text-amber-100">Settings</strong> · price={providers.price} · calendar={providers.calendar} · news={providers.news}
        </div>

        <div className="mt-6 rounded-md border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
          <p className="font-medium text-slate-300">How bias is computed</p>
          <ul className="mt-2 space-y-1 text-slate-400">
            <li>• News tagged hawkish/dovish/risk-on/risk-off; each currency leg scored.</li>
            <li>• Calendar high/medium events within 48h adjust event risk and confidence.</li>
            <li>• Recency decay: last 24h full weight, 24–72h half weight, older ignored.</li>
            <li>• Base-minus-quote legs decide bullish/bearish; thin data stays neutral.</li>
            <li>• Drivers quote stored headlines; no LLM required. LLM rewrite is optional and key-gated.</li>
          </ul>
        </div>

        <div className="mt-6 rounded-md border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
          <p className="font-medium text-slate-300">Disclaimer</p>
          <p className="mt-1 text-slate-400">
            Not financial advice. Phase 2 fundamental bias only. Signals are derived from stored news and
            calendar data and are for informational purposes only.
          </p>
        </div>
      </div>
    </div>
  );
}
