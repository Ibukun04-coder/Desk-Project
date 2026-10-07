import { logOnce } from "../config";

export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

/**
 * GET JSON with a single retry on 429/5xx (or a network error), honoring
 * Retry-After when present. Returns unvalidated JSON — callers parse with Zod.
 */
export async function fetchJsonWithRetry(
  url: string,
  options: { headers?: Record<string, string>; timeoutMs?: number; label?: string } = {},
): Promise<unknown> {
  const label = options.label ?? "provider request";
  const timeoutMs = options.timeoutMs ?? 15_000;
  const attempt = async (isRetry: boolean): Promise<unknown> => {
    try {
      const res = await fetch(url, {
        headers: options.headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        if (isRetry && isRetryableStatus(res.status)) {
          const waitMs = parseRetryAfterMs(res.headers.get("retry-after")) ?? 1_500;
          logOnce(`[desk] ${label}: HTTP ${res.status}, retrying once after ${waitMs}ms`);
          await sleep(waitMs);
          return attempt(false);
        }
        throw new ProviderHttpError(res.status, `${label}: HTTP ${res.status}`);
      }
      return (await res.json()) as unknown;
    } catch (err) {
      if (err instanceof ProviderHttpError) throw err;
      if (isRetry) {
        // Network failure / timeout — retry once after a short backoff.
        logOnce(`[desk] ${label}: network error, retrying once (${String(err)})`);
        await sleep(1_500);
        return attempt(false);
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  };
  return attempt(true);
}

export async function fetchTextWithTimeout(
  url: string,
  options: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<string> {
  const res = await fetch(url, {
    headers: options.headers,
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
  });
  if (!res.ok) throw new ProviderHttpError(res.status, `HTTP ${res.status} for ${url}`);
  return res.text();
}

/** Parse "2026-10-06 12:15:00" / ISO strings as UTC when no zone is present. */
export function parseUtcDateTime(value: string): Date | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  let iso = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) iso += "Z";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}
