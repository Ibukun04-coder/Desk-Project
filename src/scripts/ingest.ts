import type { IngestResult } from "../lib/data/types";

// Load .env before any module reads process.env (Prisma needs DATABASE_URL).
try {
  process.loadEnvFile();
} catch {
  // No .env file — rely on the inherited environment.
}

function printResult(result: IngestResult): void {
  const s = result.stats;
  console.log(
    `[desk] ${result.kind}: ${result.status} provider=${result.provider}${result.mock ? " (mock)" : ""}` +
      ` fetched=${s.fetched} inserted=${s.inserted} updated=${s.updated} skipped=${s.skipped} failed=${s.failedCalls}`,
  );
  for (const error of s.errors) console.log(`       ! ${error}`);
}

async function main(): Promise<void> {
  const { getProviderModes } = await import("../lib/data/config");
  const { runAllIngest } = await import("../lib/data/ingest");

  const modes = getProviderModes();
  console.log(
    `[desk] providers: price=${modes.price.name} calendar=${modes.calendar.name} news=${modes.news.name}`,
  );

  const watch = process.argv.includes("--watch");
  if (!watch) {
    const results = await runAllIngest();
    results.forEach(printResult);
    const allFailed = results.every((r) => r.status === "failed");
    process.exit(allFailed ? 1 : 0);
  }

  console.log(
    `[desk] watch mode: ingesting every ${modes.ingestIntervalSeconds}s (INGEST_INTERVAL_SECONDS) — Ctrl+C to stop`,
  );
  for (;;) {
    const results = await runAllIngest();
    results.forEach(printResult);
    await new Promise((resolve) => setTimeout(resolve, modes.ingestIntervalSeconds * 1000));
  }
}

main().catch((err) => {
  console.error("[desk] ingest crashed:", err);
  process.exit(1);
});
