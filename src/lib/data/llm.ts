import type { BiasFilters } from "./fundamental/score-types";
import type { RawBiasResult } from "./fundamental/score-types";

export function llmKeysPresent(): boolean {
  return Boolean(process.env.OPENAI_API_KEY || process.env.XAI_API_KEY || process.env.GROK_API_KEY);
}

export async function rewriteWithLlm(result: RawBiasResult, newsSnippets: string[], eventSnippets: string[], _filters: BiasFilters): Promise<RawBiasResult> {
  const key = process.env.OPENAI_API_KEY || process.env.XAI_API_KEY || process.env.GROK_API_KEY;
  if (!key) return result;
  const prompt = [
    "Rewrite bias drivers in clear trader English. Keep JSON shape.",
    `Bias: ${result.bias} (${result.confidence})`,
    `Drivers: ${result.drivers.map((d) => d.text).join(" | ")}`,
    `News: ${newsSnippets.slice(0, 8).join(" | ")}`,
    `Events: ${eventSnippets.slice(0, 6).join(" | ")}`,
    'Reply ONLY as JSON: {"drivers":[{"type":"news","text":"..."}],"invalidation":"..."}',
  ].join("\n");
  try {
    const endpoint = process.env.OPENAI_API_KEY ? "https://api.openai.com/v1/chat/completions" : "https://api.x.ai/v1/chat/completions";
    const model = process.env.OPENAI_API_KEY ? "gpt-4o-mini" : "grok-2-latest";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, temperature: 0.2, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) return result;
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content ?? "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return result;
    const parsed = JSON.parse(text.slice(start, end + 1)) as { drivers?: Array<{ type?: string; text?: string }>; invalidation?: string };
    if (!Array.isArray(parsed.drivers) || typeof parsed.invalidation !== "string") return result;
    if (parsed.drivers.length === 0 || parsed.drivers.length > 5) return result;
    const drivers = parsed.drivers
      .filter((d) => typeof d.text === "string" && d.text.length > 0)
      .map((d) => ({ type: d.type === "calendar" ? ("calendar" as const) : ("news" as const), text: d.text as string }));
    if (drivers.length === 0) return result;
    return { ...result, drivers, invalidation: parsed.invalidation.slice(0, 500), usedLlm: true };
  } catch {
    return result;
  }
}
