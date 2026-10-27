import type { BiasApiResult } from "@/lib/api/bias";
import type { DailyBiasApiResult } from "@/lib/api/daily-bias";
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

/** Per-feed LIVE/MOCK badge — never labels live candles as mock. */
export function FeedBadge({ label, name }: { label: string; name: string }) {
  const live = name !== "mock";
  return (
    <span className={live ? "text-emerald-400" : "text-amber-300"}>
      {label}: {live ? `LIVE (${name})` : "MOCK"}
    </span>
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
  const daily = biasResult.dailyBias;
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

      {daily && (
        <section className="mt-4 rounded-md border border-sky-500/30 bg-sky-500/5 px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-sm text-sky-200">
              <span className="font-medium">Daily Bias:</span>
              <span
                className={`ml-2 px-2 py-0.5 rounded text-xs font-semibold uppercase ${
                  daily.bias === "bullish"
                    ? "bg-emerald-500/20 text-emerald-400"
                    : daily.bias === "bearish"
                      ? "bg-rose-500/20 text-rose-400"
                      : "bg-slate-500/20 text-slate-400"
                }`}
              >
                {daily.bias === "bullish" ? "BULLISH" : daily.bias === "bearish" ? "BEARISH" : "NEUTRAL"}
              </span>
              <span className="text-slate-400">· strength {daily.strength}%</span>
            </div>
            <div className="text-xs text-slate-400">
              {daily.asOf.slice(0, 10)} UTC
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Prev day: O {daily.previousDay.open} H {daily.previousDay.high} L {daily.previousDay.low} C {daily.previousDay.close}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Liquidity taken: {daily.liquidity.liquidityTaken} · left: {daily.liquidity.liquidityLeft}
          </p>
          <p className="mt-1 text-xs text-slate-500">{daily.invalidation}</p>
        </section>
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
        <FeedBadge label="Price" name={providers.price} />
        <FeedBadge label="News" name={providers.news} />
        {biasResult.usedLlm && <span className="text-sky-300">LLM overlay (rules + LLM)</span>}
        {!biasResult.usedLlm && llmActive && <span className="text-slate-500">LLM keys present — rules + LLM</span>}
        {!biasResult.usedLlm && !llmActive && <span className="text-slate-600">LLM disabled — rules only</span>}
      </div>
    </section>
  );
}
