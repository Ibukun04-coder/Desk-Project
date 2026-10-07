import { recomputeAllPairs, getBiasSnapshots } from "../lib/data/bias";

async function main(): Promise<void> {
  const results = await recomputeAllPairs();
  for (const r of results) {
    console.log(`${r.pair}: ${r.bias} (${r.confidence}) usedLlm=${r.usedLlm} drivers=${r.drivers.length}`);
  }
  const snaps = await getBiasSnapshots();
  console.log(`snapshots read back: ${snaps.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
