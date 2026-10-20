import { z } from "zod";
import { PAIRS, TIMEFRAMES } from "@/lib/data/universe";
import {
  JOURNAL_CREATABLE_STATUSES,
  JOURNAL_DIRECTIONS,
  JOURNAL_EXIT_REASONS,
  JOURNAL_RESULTS,
  JOURNAL_SOURCES,
  JOURNAL_STATUSES,
} from "./types";

// Phase 5 journal request schemas. Zod is the same library the rest of Desk
// validates with; unknown pairs/timeframes are rejected by z.enum.

const isoDateTime = z.union([
  z.string().datetime({ offset: true }),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected ISO date or date-time (UTC)"),
]);

const price = z
  .number({ invalid_type_error: "price must be a number" })
  .finite()
  .positive("price must be greater than zero");

const thesis = z
  .string({ required_error: "thesis is required" })
  .trim()
  .min(1, "thesis is required")
  .max(1000, "thesis max 1000 characters");

const tags = z
  .array(z.string().trim().min(1).max(40))
  .max(20, "max 20 tags")
  .default([]);

const overrideReason = z
  .string()
  .trim()
  .max(1000, "override reason max 1000 characters")
  .optional();

const toOptionalDate = (v: string | undefined): Date | undefined => (v ? new Date(v) : undefined);

/** POST /api/journal — status can only start as idea or active. */
export const createJournalSchema = z
  .object({
    pair: z.enum(PAIRS),
    timeframe: z.enum(TIMEFRAMES),
    direction: z.enum(JOURNAL_DIRECTIONS),
    status: z.enum(JOURNAL_CREATABLE_STATUSES).default("idea"),
    entryPrice: price,
    stopPrice: price,
    targetPrice: price,
    target2Price: price.nullable().optional(),
    thesis,
    tags,
    source: z.enum(JOURNAL_SOURCES).default("manual"),
    overrideReason,
    /** required only when the server could not load a bias snapshot */
    biasNote: z.string().trim().max(1000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.entryPrice === v.stopPrice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stopPrice"],
        message: "stop price cannot equal entry price",
      });
    }
  });

export type CreateJournalInput = z.infer<typeof createJournalSchema>;

/** POST /api/journal/preview — verdict check only, nothing is written. */
export const previewJournalSchema = z
  .object({
    pair: z.enum(PAIRS),
    timeframe: z.enum(TIMEFRAMES),
    direction: z.enum(JOURNAL_DIRECTIONS),
    entryPrice: price,
    stopPrice: price,
    targetPrice: price,
  })
  .superRefine((v, ctx) => {
    if (v.entryPrice === v.stopPrice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stopPrice"],
        message: "stop price cannot equal entry price",
      });
    }
  });

/** PATCH /api/journal/:id — thesis, tags, prices, status. Never snapshots, never close fields. */
export const updateJournalSchema = z
  .object({
    thesis: thesis.optional(),
    tags: tags.optional(),
    entryPrice: price.optional(),
    stopPrice: price.optional(),
    targetPrice: price.optional(),
    target2Price: price.nullable().optional(),
    status: z.enum(JOURNAL_CREATABLE_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field to update" });

/**
 * POST /api/journal/:id/close — exitPrice OR exitReason. realizedR and result
 * are always computed server-side from the stored entry/stop, never trusted
 * from the client.
 */
export const closeJournalSchema = z.object({
  exitPrice: price.optional(),
  exitReason: z.enum(JOURNAL_EXIT_REASONS),
  reviewNote: z.string().trim().max(2000).optional(),
});

/** GET /api/journal — filters + pagination, newest first. */
export const listJournalSchema = z.object({
  pair: z.enum(PAIRS).optional(),
  timeframe: z.enum(TIMEFRAMES).optional(),
  status: z.enum(JOURNAL_STATUSES).optional(),
  result: z.enum(JOURNAL_RESULTS).optional(),
  from: isoDateTime.optional().transform(toOptionalDate),
  to: isoDateTime.optional().transform(toOptionalDate),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

/** GET /api/journal/stats — includeOverrides=true counts blocked-idea overrides. */
export const statsJournalSchema = z.object({
  from: isoDateTime.optional().transform(toOptionalDate),
  to: isoDateTime.optional().transform(toOptionalDate),
  includeOverrides: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type PreviewJournalInput = z.infer<typeof previewJournalSchema>;
export type UpdateJournalInput = z.infer<typeof updateJournalSchema>;
export type CloseJournalInput = z.infer<typeof closeJournalSchema>;
export type ListJournalInput = z.infer<typeof listJournalSchema>;
export type StatsJournalInput = z.infer<typeof statsJournalSchema>;
