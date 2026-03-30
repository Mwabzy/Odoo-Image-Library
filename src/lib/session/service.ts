import { randomUUID } from "node:crypto";

import type { MatchStatus, PathMode, UploadMode } from "@/types/domain";
import type {
  AssetProcessingJobRecord,
  ExtractedImageRecord,
  MatchRecord,
  SessionRow,
  SheetRowRecord
} from "@/types/database";

import {
  buildProcessedImageUrl,
  resolveDeliveryUrl,
  warmProcessedImageUrl,
  uploadOriginalImage
} from "@/lib/cloudinary/service";
import {
  countQueuedAssetProcessingJobs,
  createExportRecord,
  createSession,
  deleteSession,
  deleteMatchForSheetRow,
  getExtractedImage,
  getSession,
  getSessionDetail,
  getSheetRow,
  insertExtractedImages,
  insertMatch,
  insertSheetRows,
  listMatchedSheetRowIdsForImage,
  listMatchReviewItems,
  listRecentSessions,
  listRunnableAssetProcessingJobs,
  logProcessing,
  replaceMatches,
  toSessionSummary,
  updateSession,
  updateAssetProcessingJob,
  updateSheetRows,
  upsertExtractedImage,
  upsertAssetProcessingJobs,
  upsertSheetRow
} from "@/lib/db/repositories";
import {
  generateCsvExport,
  generateReviewReport,
  generateWorkbookExport
} from "@/lib/export/generator";
import {
  runDeterministicMatcher,
  summarizeDecisions
} from "@/lib/matching/engine";
import {
  extractZipImages,
  normalizeFolderUpload
} from "@/lib/parsing/images";
import { env } from "@/lib/utils/env";
import { parseSpreadsheetBuffer } from "@/lib/parsing/spreadsheet";
import { assertUploadSize, isSpreadsheetFile } from "@/lib/utils/files";

export async function createSessionFromSheet(args: {
  file: File;
  pathMode: PathMode;
}) {
  assertUploadSize(args.file.size);

  if (!isSpreadsheetFile(args.file.name, args.file.type)) {
    throw new Error("Unsupported spreadsheet type. Use .xlsx, .xls, or .csv.");
  }

  const buffer = Buffer.from(await args.file.arrayBuffer());
  const parsed = parseSpreadsheetBuffer(buffer, args.file.name);
  const session = await createSession({
    status: "draft",
    sheetFilename: args.file.name,
    pathMode: args.pathMode
  });

  await insertSheetRows(
    parsed.rows.map((row) => ({
      id: randomUUID(),
      session_id: session.id,
      row_index: row.row_index,
      product_name: row.product_name,
      sku: row.sku,
      variation: row.variation,
      color: row.color,
      size: row.size,
      parent_sku: row.parent_sku,
      raw_json: row.raw_json,
      final_image_url: row.image_url,
      status: "pending"
    }))
  );

  const updated = await updateSession(session.id, {
    total_rows: parsed.totalRows,
    headers: parsed.headers,
    column_mapping: parsed.columnMapping,
    status: "ready"
  });

  await logProcessing(session.id, "sheet_upload", "Spreadsheet parsed and ingested.", {
    filename: args.file.name,
    totalRows: parsed.totalRows,
    headers: parsed.headers
  });

  return {
    sessionId: updated.id,
    totalRows: parsed.totalRows,
    headers: parsed.headers
  };
}

async function uploadAcceptedImages(
  images: Awaited<ReturnType<typeof normalizeFolderUpload>>["accepted"],
  uploadMode: UploadMode
) {
  const records: ExtractedImageRecord[] = [];
  const failed: Array<{ name: string; reason: string }> = [];

  for (const image of images) {
    try {
      const uploaded = await uploadOriginalImage({
        sessionId: image.sessionId,
        fileName: image.originalName,
        mimeType: image.mimeType,
        buffer: image.buffer
      });

      records.push({
        id: randomUUID(),
        session_id: image.sessionId,
        original_name: image.originalName,
        relative_path: image.relativePath,
        normalized_path: image.normalizedPath,
        extension: image.extension,
        mime_type: image.mimeType,
        bytes: image.bytes,
        inferred_product: image.inferredProduct,
        inferred_variation: image.inferredVariation,
        inferred_sku: image.inferredSku,
        cloudinary_public_id: uploaded.publicId,
        cloudinary_url: uploaded.secureUrl,
        processed_url: null,
        status: "uploaded"
      });
    } catch (error) {
      failed.push({
        name: image.relativePath,
        reason:
          error instanceof Error ? error.message : "Failed to upload image to Cloudinary."
      });
    }
  }

  if (!records.length) {
    const firstFailure = failed[0]?.reason ?? "No images were uploaded successfully.";
    throw new Error(firstFailure);
  }

  await insertExtractedImages(records);
  const current = await getSession(images[0]?.sessionId ?? "");
  await updateSession(current.id, {
    upload_mode: uploadMode,
    total_images: current.total_images + records.length
  });

  return {
    records,
    failed
  };
}

export async function addFolderImagesToSession(args: {
  sessionId: string;
  files: File[];
  relativePaths: string[];
}) {
  const session = await getSession(args.sessionId);
  const normalized = await normalizeFolderUpload({
    sessionId: args.sessionId,
    files: args.files,
    relativePaths: args.relativePaths,
    pathMode: session.path_mode
  });

  if (!normalized.accepted.length) {
    throw new Error("No supported images were accepted from the browser upload.");
  }

  const uploaded = await uploadAcceptedImages(normalized.accepted, "folder");
  await logProcessing(args.sessionId, "image_upload", "Browser-selected images uploaded.", {
    accepted: uploaded.records.length,
    rejected: normalized.rejected.length + uploaded.failed.length,
    uploadFailures: uploaded.failed.length
  });

  return {
    sessionId: args.sessionId,
    accepted: uploaded.records.length,
    rejected: normalized.rejected.length + uploaded.failed.length
  };
}

export async function addZipImagesToSession(args: {
  sessionId: string;
  file: File;
}) {
  const session = await getSession(args.sessionId);
  const buffer = Buffer.from(await args.file.arrayBuffer());
  const extracted = await extractZipImages({
    sessionId: args.sessionId,
    archiveName: args.file.name,
    buffer,
    pathMode: session.path_mode
  });

  const uploaded = await uploadAcceptedImages(extracted.accepted, "zip");
  await logProcessing(
    args.sessionId,
    "image_upload",
    "ZIP images extracted and uploaded.",
    {
      accepted: uploaded.records.length,
      rejected: extracted.rejected.length + uploaded.failed.length,
      uploadFailures: uploaded.failed.length
    }
  );

  return {
    sessionId: args.sessionId,
    extracted: uploaded.records.length,
    rejected: extracted.rejected.length + uploaded.failed.length
  };
}

function buildAssetProcessingJob(
  image: ExtractedImageRecord
): Omit<AssetProcessingJobRecord, "id" | "created_at" | "updated_at"> {
  const now = new Date().toISOString();

  return {
    session_id: image.session_id,
    image_id: image.id,
    cloudinary_public_id: image.cloudinary_public_id ?? "",
    delivery_url: buildProcessedImageUrl(image.cloudinary_public_id ?? ""),
    status: "pending",
    attempt_count: 0,
    max_attempts: env.assetJobMaxAttempts,
    last_error: null,
    scheduled_at: now,
    completed_at: null
  };
}

async function enqueueMatchedAssetProcessing(args: {
  sessionId: string;
  extractedImages: ExtractedImageRecord[];
  matches: MatchRecord[];
}) {
  const imagesById = new Map(args.extractedImages.map((image) => [image.id, image]));
  const matchedImages = [...new Set(
    args.matches
      .filter((match) => match.status === "matched" && match.image_id)
      .map((match) => match.image_id as string)
  )]
    .map((imageId) => imagesById.get(imageId))
    .filter(
      (image): image is ExtractedImageRecord =>
        Boolean(image?.cloudinary_public_id) && !image?.processed_url
    );

  if (!matchedImages.length) {
    return 0;
  }

  await upsertAssetProcessingJobs(matchedImages.map((image) => buildAssetProcessingJob(image)));
  await logProcessing(
    args.sessionId,
    "asset_processing",
    "Matched images queued for background Cloudinary preparation.",
    {
      queued: matchedImages.length
    }
  );

  return matchedImages.length;
}

function buildRetrySchedule(attemptCount: number) {
  const delayMs = Math.min(60_000, 1_500 * 2 ** Math.max(0, attemptCount - 1));
  return new Date(Date.now() + delayMs).toISOString();
}

async function applyProcessedUrlToMatchedRows(args: {
  sessionId: string;
  imageId: string;
  processedUrl: string;
}) {
  const rowIds = await listMatchedSheetRowIdsForImage(args.sessionId, args.imageId);

  await Promise.all([
    upsertExtractedImage(args.imageId, {
      processed_url: args.processedUrl
    }),
    updateSheetRows(rowIds, {
      final_image_url: args.processedUrl
    })
  ]);
}

export async function processQueuedAssetJobs(sessionId: string) {
  const jobs = await listRunnableAssetProcessingJobs({
    sessionId,
    limit: env.assetJobBatchSize
  });
  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    const attemptCount = job.attempt_count + 1;
    await updateAssetProcessingJob(job.id, {
      status: "processing",
      attempt_count: attemptCount,
      last_error: null
    });

    try {
      const warmed = await warmProcessedImageUrl({
        publicId: job.cloudinary_public_id
      });

      await applyProcessedUrlToMatchedRows({
        sessionId: job.session_id,
        imageId: job.image_id,
        processedUrl: warmed.processedUrl
      });
      await updateAssetProcessingJob(job.id, {
        status: "completed",
        completed_at: new Date().toISOString(),
        scheduled_at: new Date().toISOString(),
        last_error: null
      });
      completed += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to warm processed image URL.";
      const exhausted = attemptCount >= job.max_attempts;

      await updateAssetProcessingJob(job.id, {
        status: "failed",
        last_error: message,
        completed_at: null,
        scheduled_at: exhausted
          ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          : buildRetrySchedule(attemptCount)
      });
      await logProcessing(
        sessionId,
        "asset_processing",
        exhausted
          ? "Processed image preparation failed after all retries."
          : "Processed image preparation failed and was scheduled to retry.",
        {
          imageId: job.image_id,
          publicId: job.cloudinary_public_id,
          deliveryUrl: job.delivery_url,
          attemptCount,
          maxAttempts: job.max_attempts,
          error: message
        }
      );
      failed += 1;
    }
  }

  const pendingJobs = await countQueuedAssetProcessingJobs(sessionId);

  if (completed) {
    await logProcessing(
      sessionId,
      "asset_processing",
      "Processed image URLs were prepared in the background.",
      {
        completed,
        failed,
        pendingJobs
      }
    );
  }

  return {
    sessionId,
    started: jobs.length,
    completed,
    failed,
    pendingJobs,
    hasMore: pendingJobs > 0
  };
}

async function applyMatchResults(args: {
  session: SessionRow;
  sheetRows: SheetRowRecord[];
  extractedImages: ExtractedImageRecord[];
  matches: MatchRecord[];
}) {
  const imagesById = new Map(args.extractedImages.map((image) => [image.id, image]));
  const matchesByRowId = new Map(args.matches.map((match) => [match.sheet_row_id, match]));
  const matchedImageIds = new Set<string>();

  for (const row of args.sheetRows) {
    const match = matchesByRowId.get(row.id);
    const status = match?.status ?? "unmatched";

    if (!match?.image_id || status !== "matched") {
      await upsertSheetRow(row.id, {
        final_image_url: null,
        status
      });
      continue;
    }

    const image = imagesById.get(match.image_id);
    const finalImageUrl =
      image
        ? resolveDeliveryUrl({
            cloudinaryUrl: image.cloudinary_url,
            processedUrl: image.processed_url
          })
        : null;

    if (!image?.cloudinary_public_id || !finalImageUrl) {
      await upsertSheetRow(row.id, {
        final_image_url: null,
        status: "needs_review"
      });
      continue;
    }

    matchedImageIds.add(image.id);

    await Promise.all([
      upsertSheetRow(row.id, {
        final_image_url: finalImageUrl,
        status: "matched"
      }),
      upsertExtractedImage(image.id, {
        status: "matched"
      })
    ]);
  }

  for (const image of args.extractedImages) {
    if (matchedImageIds.has(image.id)) {
      continue;
    }

    const relatedMatch = args.matches.find((match) => match.image_id === image.id);
    const status = (relatedMatch?.status ?? "unmatched") as ExtractedImageRecord["status"];

    await upsertExtractedImage(image.id, {
      status
    });
  }
}

export async function processSessionById(sessionId: string) {
  const detail = await getSessionDetail(sessionId);

  if (!detail.sheetRows.length) {
    throw new Error("This session does not contain spreadsheet rows.");
  }

  if (!detail.extractedImages.length) {
    throw new Error("This session does not contain uploaded images.");
  }

  await updateSession(sessionId, {
    status: "processing",
    error_message: null
  });
  await logProcessing(sessionId, "matching", "Session processing started.");

  try {
    const decisions = runDeterministicMatcher({
      sheetRows: detail.sheetRows,
      extractedImages: detail.extractedImages
    });

    const metrics = summarizeDecisions(
      decisions,
      detail.sheetRows.length,
      detail.extractedImages.length
    );
    const semanticMatched = decisions.filter(
      (decision) =>
        decision.matchReason === "product_variation_semantic" &&
        decision.status === "matched"
    ).length;
    const semanticReview = decisions.filter(
      (decision) =>
        decision.matchReason === "product_variation_semantic" &&
        decision.status === "needs_review"
    ).length;
    const duplicateConflicts = decisions.filter(
      (decision) => decision.status === "duplicate_conflict"
    ).length;

    await logProcessing(
      sessionId,
      "matching",
      "Strict and semantic matching completed.",
      {
        ...metrics,
        semanticMatched,
        semanticReview,
        duplicateConflicts
      }
    );

    const matches = await replaceMatches(sessionId, decisions);
    await applyMatchResults({
      session: detail.session,
      sheetRows: detail.sheetRows,
      extractedImages: detail.extractedImages,
      matches
    });
    const queuedAssetJobs = await enqueueMatchedAssetProcessing({
      sessionId,
      extractedImages: detail.extractedImages,
      matches
    });

    await logProcessing(
      sessionId,
      "asset_assignment",
      "Original image URLs assigned immediately; processed variants queued in the background.",
      {
        assigned: metrics.matched,
        pendingReview: metrics.needsReview,
        unmatched: metrics.unmatched,
        queuedAssetJobs
      }
    );

    await updateSession(sessionId, {
      status: "completed",
      matched_count: metrics.matched,
      needs_review_count: metrics.needsReview,
      unmatched_count: metrics.unmatched
    });
    await logProcessing(sessionId, "matching", "Session processing completed.", metrics);

    return {
      sessionId,
      matched: metrics.matched,
      needsReview: metrics.needsReview,
      unmatched: metrics.unmatched,
      queuedAssetJobs,
      status: "completed" as const
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to process session.";

    await updateSession(sessionId, {
      status: "failed",
      error_message: message
    });

    try {
      await logProcessing(sessionId, "error", "Session processing failed.", {
        error: message
      });
    } catch {
      // Ignore follow-up log failures so the original error surfaces cleanly.
    }

    throw error;
  }
}

async function refreshSessionMetrics(sessionId: string) {
  const detail = await getSessionDetail(sessionId);
  const decisions = detail.matches.map((match) => ({
    sheetRowId: match.sheet_row_id,
    imageId: match.image_id,
    confidenceScore: match.confidence_score ?? 0,
    matchReason: match.match_reason ?? "manual_override",
    matchedBy: match.matched_by,
    status: match.status,
    isManual: match.is_manual
  }));

  const metrics = summarizeDecisions(
    decisions,
    detail.sheetRows.length,
    detail.extractedImages.length
  );

  await updateSession(sessionId, {
    matched_count: metrics.matched,
    needs_review_count: metrics.needsReview,
    unmatched_count: metrics.unmatched
  });
}

export async function overrideSessionMatch(args: {
  sessionId: string;
  sheetRowId: string;
  imageId: string;
}) {
  const [sheetRow, image] = await Promise.all([
    getSheetRow(args.sessionId, args.sheetRowId),
    getExtractedImage(args.sessionId, args.imageId)
  ]);

  if (!image.cloudinary_public_id) {
    throw new Error("Selected image is missing its Cloudinary public id.");
  }

  const deliveryUrl = resolveDeliveryUrl({
    cloudinaryUrl: image.cloudinary_url,
    processedUrl: image.processed_url
  });

  if (!deliveryUrl) {
    throw new Error("Selected image is missing a deliverable Cloudinary URL.");
  }

  await deleteMatchForSheetRow(args.sessionId, sheetRow.id);
  await insertMatch({
    id: randomUUID(),
    session_id: args.sessionId,
    sheet_row_id: sheetRow.id,
    image_id: image.id,
    confidence_score: 1,
    match_reason: "manual_override",
    matched_by: "user.override",
    status: "matched",
    is_manual: true
  });

  await Promise.all([
    upsertSheetRow(sheetRow.id, {
      final_image_url: deliveryUrl,
      status: "matched"
    }),
    upsertExtractedImage(image.id, {
      status: "matched"
    })
  ]);
  await enqueueMatchedAssetProcessing({
    sessionId: args.sessionId,
    extractedImages: [image],
    matches: [
      {
        id: randomUUID(),
        session_id: args.sessionId,
        sheet_row_id: sheetRow.id,
        image_id: image.id,
        confidence_score: 1,
        match_reason: "manual_override",
        matched_by: "user.override",
        status: "matched",
        is_manual: true
      }
    ]
  });

  await refreshSessionMetrics(args.sessionId);
  await logProcessing(args.sessionId, "override", "Manual override applied.", args);

  return {
    sessionId: args.sessionId,
    sheetRowId: sheetRow.id,
    imageId: image.id,
    finalImageUrl: deliveryUrl
  };
}

export async function getSessionSummary(sessionId: string) {
  const detail = await getSessionDetail(sessionId);
  return {
    session: toSessionSummary(detail.session),
    sheetRows: detail.sheetRows,
    extractedImages: detail.extractedImages,
    matches: detail.matches,
    exports: detail.exports,
    logs: detail.logs
  };
}

export async function getSessionMatches(args: {
  sessionId: string;
  filter?: MatchStatus | "all";
  page?: number;
  pageSize?: number;
}) {
  return listMatchReviewItems(args.sessionId, args);
}

export async function rematchSession(sessionId: string) {
  return processSessionById(sessionId);
}

export async function generateSessionExport(args: {
  sessionId: string;
  format: "xlsx" | "csv" | "report";
}) {
  const detail = await getSessionDetail(args.sessionId);

  const exportResult =
    args.format === "xlsx"
      ? await generateWorkbookExport({
          session: detail.session,
          sheetRows: detail.sheetRows,
          extractedImages: detail.extractedImages
        })
      : args.format === "csv"
        ? await generateCsvExport({
            session: detail.session,
            sheetRows: detail.sheetRows,
            extractedImages: detail.extractedImages
          })
        : generateReviewReport({
            session: detail.session,
            sheetRows: detail.sheetRows,
            extractedImages: detail.extractedImages,
            matches: detail.matches,
            exports: detail.exports
          });

  await createExportRecord({
    sessionId: args.sessionId,
    exportType: args.format,
    filePath: exportResult.fileName
  });
  await logProcessing(args.sessionId, "export", "Export generated.", {
    format: args.format,
    fileName: exportResult.fileName
  });

  return exportResult;
}

export async function getDashboardData() {
  const sessions = await listRecentSessions();
  return sessions.map((session) => toSessionSummary(session));
}

export async function discardSession(sessionId: string) {
  await deleteSession(sessionId);

  return {
    sessionId,
    deleted: true as const
  };
}
