import { NextResponse } from "next/server";
import { z } from "zod";
import { internalError, parseQuery } from "@/lib/api";
import { serializeBiasResult } from "@/lib/api/bias";
import { getLatestBias } from "@/lib/data/bias";
import { getCandles } from "@/lib/data/queries";
import { getProviderModes } from "@/lib/data/config";
import { PAIRS, TIMEFRAMES } from "@/lib/data/universe";
import { MIN_CANDLES_FOR_SMC, detectSmc } from "@/lib/smc/detect";
import { applyPlaybookConstraint, rankSetups } from "@/lib/smc/setups";

// GET /api/smc?symbol=EURUSD&timeframe=H1 → { smc, setups, bias }.
// Candles are read through the existing getCandles (no second reader).
// Bias is fetched from stored Phase 2 snapshots (scoring never duplicated).
// Computed live on read — no persistence (no SmcCache table in v1).

const smcQuerySchema = z.object({
  symbol: z.enum(PAIRS),
  timeframe: z.enum(TIMEFRAMES),
  limit: z.coerce.number().int().min(1).max(500).default(300),
});

export async function GET(request: Request) {
  const parsed = parseQuery(smcQuerySchema, request);
  if (!parsed.ok) return parsed.data.response;
  try {
    const { symbol, timeframe, limit } = parsed.data;
    const modes = getProviderModes();
    const [candles, bias] = await Promise.all([
      getCandles({ symbol, timeframe, limit }),
      getLatestBias(symbol),
    ]);
    const smc = detectSmc(symbol, timeframe, candles);
    const { setups, alignment } = rankSetups(
      smc,
      bias ? { bias: bias.bias, confidence: bias.confidence } : null,
    );
    return NextResponse.json({
      smc,
      setups: applyPlaybookConstraint(setups),
      alignment,
      bias: bias ? serializeBiasResult(bias) : null,
      mock: modes.price.mode === "mock",
      message: candles.length < MIN_CANDLES_FOR_SMC ? "insufficient candles" : null,
    });
  } catch (err) {
    return internalError(err);
  }
}
