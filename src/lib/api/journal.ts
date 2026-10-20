import type {
  JournalEntryDto,
  JournalListResponse,
  JournalStatsResponse,
} from "@/lib/journal/types";

// Thin typed fetch wrapper for the journal routes — plain fetch like the rest
// of the desk's client code. Errors surface as thrown Error with the server's
// { error } message so forms can show them inline.

export type PreviewResponse = {
  /** "no_setup" is unreachable for previews (a proposal always exists) but kept for parity */
  verdict: "allow" | "downgrade" | "block" | "no_setup";
  /** "rejected" is a legacy v1 grade; the v2 evaluator writes A/B/C */
  grade: "A" | "B" | "C" | "rejected" | null;
  originalGrade: "A" | "B" | null;
  fired: Array<{ ruleId: string; title: string; severity: "block" | "downgrade" }>;
  alignment: string;
  biasLoaded: boolean;
  biasDirection: string | null;
  biasConfidence: number | null;
  smcLoaded: boolean;
  htfBias: string | null;
};

async function unwrap<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string; issues?: Array<{ message: string }> };
  if (!res.ok) {
    const msg =
      body.error ??
      (body.issues && body.issues.length > 0 ? body.issues.map((i) => i.message).join("; ") : `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return body;
}

export async function fetchJournalList(query: URLSearchParams): Promise<JournalListResponse> {
  const res = await fetch(`/api/journal?${query.toString()}`);
  return unwrap<JournalListResponse>(res);
}

export async function fetchJournalStats(query: URLSearchParams): Promise<JournalStatsResponse> {
  const res = await fetch(`/api/journal/stats?${query.toString()}`);
  return unwrap<JournalStatsResponse>(res);
}

export async function createJournalEntry(body: unknown): Promise<JournalEntryDto> {
  const res = await fetch("/api/journal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap<JournalEntryDto>(res);
}

export async function updateJournalEntry(id: string, body: unknown): Promise<JournalEntryDto> {
  const res = await fetch(`/api/journal/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap<JournalEntryDto>(res);
}

export async function closeJournalEntry(id: string, body: unknown): Promise<JournalEntryDto> {
  const res = await fetch(`/api/journal/${id}/close`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap<JournalEntryDto>(res);
}

export async function previewJournalEntry(body: unknown): Promise<PreviewResponse> {
  const res = await fetch("/api/journal/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap<PreviewResponse>(res);
}