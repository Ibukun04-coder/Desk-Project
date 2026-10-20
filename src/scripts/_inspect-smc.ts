import { detectSmc } from "@/lib/smc/detect";
import { rankSetups } from "@/lib/smc/setups";
import { buildDownImpulseFixture, buildUpImpulseFixture } from "@/lib/smc/fixtures";

for (const [name, build, bias] of [
  ["DOWN", buildDownImpulseFixture, "bearish"] as const,
  ["UP", buildUpImpulseFixture, "bullish"] as const,
]) {
  const smc = detectSmc("EURUSD", "H1", build());
  const { setups, alignment } = rankSetups(smc, { bias, confidence: 70 });
  // eslint-disable-next-line no-console
  console.log(`=== ${name} ===`);
  // eslint-disable-next-line no-console
  console.log("htfBias:", smc.htfBias, "range:", JSON.stringify(smc.range));
  // eslint-disable-next-line no-console
  console.log("choch:", JSON.stringify(smc.choch.map((c) => ({ dir: c.direction, level: c.brokenLevel, index: c.index }))));
  // eslint-disable-next-line no-console
  console.log("bos:", JSON.stringify(smc.bos.map((c) => ({ dir: c.direction, level: c.brokenLevel, index: c.index }))));
  // eslint-disable-next-line no-console
  console.log("fvgs:", JSON.stringify(smc.fvgs.map((f) => ({ dir: f.direction, low: f.low, high: f.high, mit: f.mitigated }))));
  // eslint-disable-next-line no-console
  console.log("obs:", JSON.stringify(smc.orderBlocks.map((o) => ({ kind: o.kind, dir: o.direction, low: o.low, high: o.high, mit: o.mitigated }))));
  // eslint-disable-next-line no-console
  console.log("swings:", JSON.stringify(smc.swings.map((s) => ({ t: s.type, p: s.price, i: s.index }))));
  // eslint-disable-next-line no-console
  console.log("setups:", JSON.stringify(setups.map((s) => ({ grade: s.grade, side: s.side, zone: s.entryZone, inv: s.invalidation }))));
  // eslint-disable-next-line no-console
  console.log("alignment:", alignment);
}
