import { z } from "zod";

import { pathModeSchema } from "@/lib/utils/files";

export const sessionIdSchema = z.string().uuid();

export const processSessionSchema = z.object({
  sessionId: sessionIdSchema
});

export const overrideSchema = z.object({
  sheetRowId: sessionIdSchema,
  imageId: sessionIdSchema
});

export const exportSchema = z.object({
  format: z.enum(["xlsx", "csv", "report"]).default("xlsx")
});

export const matchQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  filter: z
    .enum(["all", "matched", "unmatched", "needs_review", "duplicate_conflict"])
    .default("all")
});

export const uploadSheetSchema = z.object({
  pathMode: pathModeSchema.default("auto")
});
