import { NextResponse } from "next/server";
import { internalError } from "@/lib/api";
import { getDataHealth } from "@/lib/data/queries";

export async function GET() {
  try {
    return NextResponse.json({ data: await getDataHealth() });
  } catch (err) {
    return internalError(err);
  }
}
