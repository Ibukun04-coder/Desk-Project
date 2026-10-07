import { NextResponse } from "next/server";
import { internalError, parseQuery } from "@/lib/api";
import { candlesQuerySchema, getCandles } from "@/lib/data/queries";

export async function GET(request: Request) {
  const parsed = parseQuery(candlesQuerySchema, request);
  if (!parsed.ok) return parsed.data.response;
  try {
    const candles = await getCandles(parsed.data);
    return NextResponse.json({ data: candles, count: candles.length });
  } catch (err) {
    return internalError(err);
  }
}
