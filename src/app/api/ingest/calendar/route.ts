import { NextResponse } from "next/server";
import { internalError } from "@/lib/api";
import { runCalendarIngest } from "@/lib/data/ingest";

export async function POST() {
  try {
    return NextResponse.json({ data: await runCalendarIngest() });
  } catch (err) {
    return internalError(err);
  }
}
