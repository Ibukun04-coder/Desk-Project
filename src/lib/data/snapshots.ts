import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { Pair } from "./universe";
import type { BiasDir } from "./fundamental/score-types";
import type { RawBiasResult } from "./fundamental/score-types";

export const MAX_SNAPSHOTS_PER_PAIR = 20;

export interface SnapshotRow {
  id: string;
  pair: string;
  bias: string;
  confidence: number;
  drivers: unknown;
  nextEvent: unknown;
  invalidation: string;
  method: string;
  usedLlm: boolean;
  asOf: Date;
  createdAt: Date;
}

export async function saveBiasSnapshot(result: RawBiasResult): Promise<void> {
  await prisma.biasSnapshot.create({
    data: {
      pair: result.pair,
      bias: result.bias,
      confidence: result.confidence,
      drivers: result.drivers as unknown as object,
      nextEvent: result.nextEvent
        ? {
            title: result.nextEvent.headline,
            scheduledAt: result.nextEvent.scheduledAt.toISOString(),
            currency: result.nextEvent.currency,
            impact: result.nextEvent.impact,
            forecast: result.nextEvent.forecast,
            previous: result.nextEvent.previous,
            actual: result.nextEvent.actual,
          }
        : Prisma.JsonNull,
      invalidation: result.invalidation,
      method: result.method,
      usedLlm: result.usedLlm,
      asOf: result.asOf,
    },
  });
  const recent = await prisma.biasSnapshot.findMany({
    where: { pair: result.pair },
    orderBy: { asOf: "desc" },
    select: { id: true },
    take: MAX_SNAPSHOTS_PER_PAIR,
  });
  if (recent.length < MAX_SNAPSHOTS_PER_PAIR) return;
  const keep = new Set(recent.map((r) => r.id));
  await prisma.biasSnapshot.deleteMany({ where: { pair: result.pair, id: { notIn: [...keep] } } });
}

export async function getLatestBiasRow(pair: Pair): Promise<SnapshotRow | null> {
  const row = await prisma.biasSnapshot.findFirst({ where: { pair }, orderBy: { asOf: "desc" } });
  if (!row) return null;
  return row as unknown as SnapshotRow;
}

export async function getBiasSnapshotRows(limit = 80): Promise<SnapshotRow[]> {
  const rows = await prisma.biasSnapshot.findMany({ orderBy: { asOf: "desc" }, take: limit });
  return rows as unknown as SnapshotRow[];
}

export type { BiasDir };
