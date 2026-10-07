import { NextResponse } from "next/server";
import { internalError, parseQuery } from "@/lib/api";
import { calendarQuerySchema, getCalendar } from "@/lib/data/queries";

export async function GET(request: Request) {
  const parsed = parseQuery(calendarQuerySchema, request);
  if (!parsed.ok) return parsed.data.response;
  try {
    const events = await getCalendar(parsed.data);
    return NextResponse.json({ data: events, count: events.length });
  } catch (err) {
    return internalError(err);
  }
}
