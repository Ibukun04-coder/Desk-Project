import { NextResponse } from "next/server";
import { getUniverse } from "@/lib/data/queries";

export async function GET() {
  return NextResponse.json({ data: getUniverse() });
}
