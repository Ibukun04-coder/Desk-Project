// SMC self-check: detective fixtures → detectSmc → rankSetups assertions.
// Run: npx tsx src/scripts/smc-check.ts (no test framework, no network, no keys).

import { detectSmc } from "@/lib/smc/detect";
import { rankSetups } from "@/lib/smc/setups";
import { buildDownImpulseFixture, buildShortFixture, buildUpImpulseFixture } from "@/lib/smc/fixtures";

let failures = 0;

function check(name: string, cond: boolean, detail: string = ""): void {
  if (cond) console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  else { console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); failures++; }
}

const up = detectSmc("EURUSD", "H1", buildUpImpulseFixture());
check("up-impulse: bullish BOS", up.bos.some((b) => b.direction === "bullish"), `bos=${up.bos.length}`);
check(
  "up-impulse: bullish FVG or demand OB",
  up.fvgs.some((f) => f.direction === "bullish") ||
    up.orderBlocks.some((o) => o.kind === "demand"),
  `fvgs=${up.fvgs.length} obs=${up.orderBlocks.length}`,
);
check("up-impulse: htfBias bullish", up.htfBias === "bullish", `htfBias=${up.htfBias}`);
check("up-impulse: range present", up.range !== null);

const down = detectSmc("EURUSD", "H1", buildDownImpulseFixture());
check("down-impulse: bearish BOS", down.bos.some((b) => b.direction === "bearish"), `bos=${down.bos.length}`);
check("down-impulse: htfBias bearish", down.htfBias === "bearish", `htfBias=${down.htfBias}`);

const empty = detectSmc("EURUSD", "H1", []);
check("empty: no crash, empty arrays", empty.swings.length === 0 && empty.bos.length === 0 &&
  empty.fvgs.length === 0 && empty.orderBlocks.length === 0 && empty.range === null &&
  empty.htfBias === "range" && empty.candleCount === 0);

const short = detectSmc("EURUSD", "H1", buildShortFixture());
check("short: no crash, empty arrays", short.swings.length === 0 && short.bos.length === 0 &&
  short.range === null && short.candleCount === 5);

const aligned = rankSetups(up, { bias: "bullish", confidence: 72 });
check("agree: A long", aligned.setups.length === 1 && aligned.setups[0].grade === "A" &&
  aligned.setups[0].side === "long" && aligned.alignment === "ALIGNED",
  JSON.stringify(aligned.setups.map((s) => s.grade + s.side)));

const conflicted = rankSetups(up, { bias: "bearish", confidence: 65 });
check("conflict: B only + mismatch note", conflicted.setups.every((s) => s.grade === "B") &&
  conflicted.setups.some((s) => s.why.some((w) => w.includes("SMC vs news mismatch"))) &&
  conflicted.alignment === "DO_NOT_TRADE",
  JSON.stringify(conflicted.setups.map((s) => s.grade + s.side)));

const noBias = rankSetups(up, null);
check("missing bias: htfBias-only B", noBias.setups.length <= 1 &&
  noBias.setups.every((s) => s.grade === "B") && noBias.alignment !== "ALIGNED");

const mixed = rankSetups(up, { bias: "mixed", confidence: 40 });
check("mixed fund: B at most", mixed.setups.every((s) => s.grade === "B"));

if (failures > 0) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("smc-check: all green");
