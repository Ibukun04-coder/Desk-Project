import { NextResponse } from "next/server";
import { internalError, parseQuery } from "@/lib/api";
import { getNews, newsQuerySchema } from "@/lib/data/queries";

export async function GET(request: Request) {
  const parsed = parseQuery(newsQuerySchema, request);
  if (!parsed.ok) return parsed.data.response;
  try {
    const items = await getNews(parsed.data);
    return NextResponse.json({ data: items, count: items.length });
  } catch (err) {
    return internalError(err);
  }
}
