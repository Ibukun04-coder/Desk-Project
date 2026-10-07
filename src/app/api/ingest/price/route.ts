import { NextResponse } from "next/server";
import { internalError } from "@/lib/api";
import { runPriceIngest } from "@/lib/data/ingest";

export async function POST() {
  try {
    return NextResponse.json({ data: await runPriceIngest() });
  } catch (err) {
    return internalError(err);
  }
}
