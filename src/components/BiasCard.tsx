import type { BiasApiResult } from "@/lib/api/bias";
import { PAIRS, PAIR_DISPLAY } from "@/lib/data/universe";

export function BiasChip({ bias }: { bias: BiasApiResult["bias"] }) {
  const styles: Record<BiasApiResult["bias"], string> = {
    bullish: "bg-emerald-500/15 text-emerald-400",
    bearish: "bg-rose-500/15 text-rose-400",
    mixed: "bg-amber-500/15 text-amber-400",
    neutral: "bg-slate-500/15 text-slate-400",
  };
  const labels: Record<BiasApiResult["bias"], string> = {
    bullish: "BULLISH",
    bearish: "BEARISH",
    mixed: "MIXED",
    neutral: "NEUTRAL",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${styles[bias]}`}>
      {labels[bias]}
    </span>
  );
}

export function ConfidenceBar({ confidence }: { confidence: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-400">
        <span>Confidence</span>
        <span>{confidence}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-700/60">
        <div
          className="h-2 rounded-full bg-sky-400 transition-all"
          style={{ width: `${Math.min(100, confidence)}%` }}
        />
      </div>
    </div>
  );
}

export function BiasCard({
  pair,
  biasResult,
  providers,
  llmActive,
}: {
  pair: (typeof PAIRS)[number];
  biasResult: BiasApiResult;
  providers: { price: string; calendar: string; news: string };
  llmActive: boolean;
}) {
  const mock = providers.price === "mock" || providers.calendar === "mock" || providers.news === "mock";

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">{PAIR_DISPLAY[pair]}</h3>
          <p className="text-xs text-slate-400">
            {biasResult.method} · asOf {biasResult.asOf.slice(0, 16).replace("T", " ") || ""} UTC
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BiasChip bias={biasResult.bias} />
          <ConfidenceBar confidence={biasResult.confidence} />
        </div>
      </div>

      {biasResult.drivers.length > 0 && (
        <ul className="mt-4 space-y-2">
          {biasResult.drivers.map((d, i) => (
            <li key={i} className="flex gap-2 text-sm text-slate-300">
              <span className="mt-0.5 text-xs font-medium text-slate-500">[{d.type}]</span>
              <p>{d.text}</p>
            </li>
          ))}
        </ul>
      )}

      {biasResult.nextEvent && (
        <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-sm text-amber-200">
              <span className="font-medium">Next event:</span> {biasResult.nextEvent.title}
            </div>
            <div className="text-xs text-slate-400">
              {biasResult.nextEvent.scheduledAt.slice(0, 16).replace("T", " ") || ""} UTC
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {biasResult.nextEvent.currency} · impact {biasResult.nextEvent.impact} · forecast {biasResult.nextEvent.forecast ?? "—"} · previous {biasResult.nextEvent.previous ?? "—"}
          </p>
        </div>
      )}

      <p className="mt-3 text-sm text-slate-400">
        <span className="font-medium text-slate-300">Invalidation:</span> {biasResult.invalidation}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        {mock && <span className="text-amber-300">MOCK DATA — deterministic sample feed</span>}
        {biasResult.usedLlm && <span className="text-sky-300">LLM overlay (rules + LLM)</span>}
        {!biasResult.usedLlm && llmActive && <span className="text-slate-500">LLM keys present — rules + LLM</span>}
        {!biasResult.usedLlm && !llmActive && <span className="text-slate-600">LLM disabled — rules only</span>}
      </div>
    </section>
  );
}
