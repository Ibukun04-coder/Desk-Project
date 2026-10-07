import { NextResponse } from "next/server";
import type { ZodTypeAny, z } from "zod";

// Shared helpers for App Router route handlers: Zod-validated query parsing,
// 400 on bad input, 500 with a logged error otherwise (never leak internals).

export function parseQuery<S extends ZodTypeAny>(
  schema: S,
  request: Request,
): { ok: true; data: z.infer<S> } | { ok: false; data: { response: NextResponse } } {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = schema.safeParse(params);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issues = parsed.error.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
  return {
    ok: false,
    data: {
      response: NextResponse.json(
        { error: "Invalid query parameters", issues },
        { status: 400 },
      ),
    },
  };
}

export async function parseBody<S extends ZodTypeAny>(
  schema: S,
  request: Request,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; data: { response: NextResponse } }> {
  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? (JSON.parse(text) as unknown) : {};
  } catch {
    return {
      ok: false,
      data: { response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) },
    };
  }
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  return {
    ok: false,
    data: { response: NextResponse.json({ error: "Invalid request body", issues }, { status: 400 }) },
  };
}

export function internalError(err: unknown): NextResponse {
  console.error("[desk] API error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
