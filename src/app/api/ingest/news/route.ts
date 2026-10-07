import { NextResponse } from "next/server";
import { internalError } from "@/lib/api";
import { runNewsIngest } from "@/lib/data/ingest";

export async function POST() {
  try {
    return NextResponse.json({ data: await runNewsIngest() });
  } catch (err) {
    return internalError(err);
  }
}
