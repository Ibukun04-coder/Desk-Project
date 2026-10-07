// Small deterministic hash helpers shared by the mock providers so repeated
// ingests generate byte-identical data (idempotent upserts, no churn).

export function fnv1a(...parts: (string | number)[]): number {
  const input = parts.join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic value in [-1, 1). */
export function unitNoise(...parts: (string | number)[]): number {
  return (fnv1a(...parts) / 0xffffffff) * 2 - 1;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
