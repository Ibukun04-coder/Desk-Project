"use client";

// /pair/[symbol] client view: TF pills, chart, right rail (bias + SMC +
// alignment + setups). Fetches /api/candles and /api/smc in parallel.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PAIRS, PAIR_DISPLAY, TIMEFRAMES, type Pair, type Timeframe } from "@/lib/data/universe";
import type { BiasApiResult } from "@/lib/api/bias";
import type { Alignment, SmcSnapshot } from "@/lib/smc/types";
import type { EvaluatedSetup } from "@/lib/playbook/evaluate";
import { BiasCard } from "@/components/BiasCard";
import { PairChart, type ChartCandle } from "@/components/pair/PairChart";

export type SmcResponse = {
  smc: SmcSnapshot;
  setups: EvaluatedSetup[];
  alignment: Alignment;
  bias: BiasApiResult | null;
  mock: boolean;
  providers: { price: string; calendar: string; news: string };
  message: string | null;
};

export type CandlesResponse = {
  data: ChartCandle[];
  count: number;
};

export const ALIGNMENT_STYLES: Record<Alignment, string> = {
  ALIGNED: "bg-emerald-500/15 text-emerald-400",
  MIXED: "bg-amber-500/15 text-amber-400",
  DO_NOT_TRADE: "bg-rose-500/15 text-rose-400",
};

export const HTF_STYLES: Record<string, string> = {
  bullish: "bg-emerald-500/15 text-emerald-400",
  bearish: "bg-rose-500/15 text-rose-400",
  range: "bg-slate-500/15 text-slate-400",
};

export function PairView({ symbol, initialTimeframe }: { symbol: Pair; initialTimeframe: Timeframe }) {
  const [timeframe, setTimeframe] = useState<Timeframe>(initialTimeframe);
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [smc, setSmc] = useState<SmcSnapshot | null>(null);
  const [setups, setSetups] = useState<EvaluatedSetup[]>([]);
  const [alignment, setAlignment] = useState<Alignment>("DO_NOT_TRADE");
  const [bias, setBias] = useState<BiasApiResult | null>(null);
  const [mock, setMock] = useState(false);
  const [providers, setProviders] = useState({ price: "mock", calendar: "mock", news: "mock" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (tf: Timeframe) => {
    setLoading(true);
    setError(null);
    try {
      const [cRes, sRes] = await Promise.all([
        fetch(`/api/candles?symbol=${symbol}&timeframe=${tf}&limit=300`),
        fetch(`/api/smc?symbol=${symbol}&timeframe=${tf}`),
      ]);
      if (!cRes.ok) throw new Error(`candles HTTP ${cRes.status}`);
      if (!sRes.ok) throw new Error(`smc HTTP ${sRes.status}`);
      const cBody = (await cRes.json()) as CandlesResponse;
      const sBody = (await sRes.json()) as SmcResponse;
      setCandles(cBody.data);
      setSmc(sBody.smc);
      setSetups(sBody.setups);
      setAlignment(sBody.alignment);
      setBias(sBody.bias);
      setMock(sBody.mock);
      if (sBody.providers) setProviders(sBody.providers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pair data.");
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    void load(timeframe);
  }, [load, timeframe]);


  return (
    <div>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">{PAIR_DISPLAY[symbol]} — Pair Desk</h1>
          <p className="mt-1 text-sm text-slate-400">Phase 3 · deterministic SMC structure + Phase 2 fundamental bias · human analysis only</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {PAIRS.map((p) => (
            <Link
              key={p}
              href={`/pair/${p}?timeframe=${timeframe}`}
              className={`rounded-md border px-3 py-1.5 text-sm ${p === symbol ? "border-sky-500 bg-sky-500/15 text-sky-300" : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"}`}
            >
              {PAIR_DISPLAY[p]}
            </Link>
          ))}
        </div>
      </header>

      <div className="mt-4 flex flex-wrap gap-2">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            type="button"
            onClick={() => setTimeframe(tf)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${tf === timeframe ? "border-sky-500 bg-sky-500/15 text-sky-300" : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"}`}
          >
            {tf}
          </button>
        ))}
      </div>

      {mock && (
        <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <strong>MOCK DATA</strong> — price feed ({providers.price}) is deterministic sample data, not live.
          Structure overlays are still computed from those candles by rules (no LLM).
        </div>
      )}
      {!mock && (
        <div className="mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <strong>LIVE price</strong> — candles from {providers.price}. Overlays recomputed from live data by rules.
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          {loading ? (
            <p className="py-24 text-center text-sm text-slate-500">Loading {timeframe} candles…</p>
          ) : candles.length === 0 ? (
            <p className="py-24 text-center text-sm text-slate-500">No candles stored for {symbol} {timeframe}. Run ingest first.</p>
          ) : (
            <PairChart candles={candles} smc={smc} />
          )}
          {smc && (
            <p className="mt-2 text-xs text-slate-500">
              {smc.candleCount} candles · {smc.swings.length} swings · {smc.bos.length} BOS · {smc.choch.length} CHOCH · {smc.fvgs.length} FVG · {smc.orderBlocks.length} OB · asOf {smc.asOf.slice(0, 16).replace("T", " ")} UTC
            </p>
          )}
        </div>

        <aside className="min-w-0 space-y-4">
          {bias ? (
            <BiasCard pair={symbol} biasResult={bias} providers={providers} llmActive={bias.usedLlm} />
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
              No fundamental bias snapshot for {symbol} yet — press Recompute bias on the <Link href="/bias" className="text-sky-400 hover:underline">Bias desk</Link>.
            </div>
          )}

          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-sm font-semibold text-slate-200">SMC structure (not news)</h2>
            <div className="mt-2 flex items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${HTF_STYLES[smc?.htfBias ?? "range"]}`}>
                {smc?.htfBias ?? "…"}
              </span>
              <span className={`rounded px-2 py-0.5 text-xs font-semibold ${ALIGNMENT_STYLES[alignment]}`}>
                {alignment.replace("_", " ")}
              </span>
            </div>
            {smc?.range && (
              <dl className="mt-3 space-y-1 text-xs text-slate-400">
                <div className="flex justify-between"><dt>Range high (premium)</dt><dd className="text-slate-200">{smc.range.high}</dd></div>
                <div className="flex justify-between"><dt>Midpoint</dt><dd className="text-slate-200">{smc.range.midpoint}</dd></div>
                <div className="flex justify-between"><dt>Range low (discount)</dt><dd className="text-slate-200">{smc.range.low}</dd></div>
              </dl>
            )}
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-sm font-semibold text-slate-200">Setups (rules + playbook)</h2>
            {setups.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">No setup — standing aside is the position.</p>
            ) : setups.every((s) => s.finalGrade === "rejected") ? (
              <p className="mt-2 text-sm text-rose-300">No setup — playbook blocked.</p>
            ) : null}
            {setups.length > 0 && !setups.every((s) => s.finalGrade === "rejected") ? (
              <ul className="mt-2 space-y-3">
                {setups.map((s, i) => (
                  <li key={i} className="rounded-md border border-slate-700 bg-slate-950/60 p-3">
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-bold ${s.finalGrade === "A" ? "bg-emerald-500/15 text-emerald-300" : s.finalGrade === "B" ? "bg-amber-500/15 text-amber-300" : "bg-rose-500/15 text-rose-300"}`}>{s.finalGrade === "rejected" ? "Rejected" : `${s.finalGrade}-setup`}</span>
                      <span className="text-sm font-medium text-slate-200">{s.side.toUpperCase()}</span>
                      {s.originalGrade !== s.finalGrade && s.finalGrade !== "rejected" && (
                        <span className="text-xs text-slate-500">(was {s.originalGrade})</span>
                      )}
                    </div>
                    {s.fired.length > 0 && (
                      <p className="mt-1 text-xs text-amber-300">
                        {s.finalGrade === "rejected" ? "Blocked by: " : "Playbook: "}
                        {s.fired.map((f) => f.title).join("; ")}
                      </p>
                    )}
                    <dl className="mt-2 space-y-1 text-xs text-slate-400">
                      <div className="flex justify-between"><dt>Entry zone</dt><dd className="text-slate-200">{s.entryZone.low} – {s.entryZone.high}</dd></div>
                      <div className="flex justify-between"><dt>Invalidation</dt><dd className="text-rose-300">{s.invalidation}</dd></div>
                      <div className="flex justify-between"><dt>Target hint</dt><dd className="text-slate-200">{s.targetHint}</dd></div>
                    </dl>
                    <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
                      {s.why.map((w, j) => <li key={j}>· {w}</li>)}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : null}
            {setups.length > 0 && setups.every((s) => s.finalGrade === "rejected") && (
              <ul className="mt-2 space-y-3">
                {setups.map((s, i) => (
                  <li key={i} className="rounded-md border border-rose-900/60 bg-slate-950/60 p-3 opacity-80">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-rose-500/15 px-2 py-0.5 text-xs font-bold text-rose-300">Rejected</span>
                      <span className="text-sm font-medium text-slate-200">{s.side.toUpperCase()}</span>
                      <span className="text-xs text-slate-500">(was {s.originalGrade})</span>
                    </div>
                    <p className="mt-1 text-xs text-amber-300">Blocked by: {s.fired.map((f) => f.title).join("; ")}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-500">
            <p><strong className="text-slate-300">Disclaimer.</strong> Not financial advice. Phase 3 structure + Phase 2 bias for human analysis only. No execution — this page cannot place orders.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
