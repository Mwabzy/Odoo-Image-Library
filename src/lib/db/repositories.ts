import { randomUUID } from "node:crypto";

import type {
  ColumnMapping,
  MatchCandidate,
  MatchReviewItem,
  MatchStatus,
  PathMode,
  SessionSummary,
  SessionStatus
} from "@/types/domain";
import type {
  AssetProcessingJobRecord,
  ExportRecord,
  ExtractedImageRecord,
  MatchRecord,
  ProcessingLogRecord,
  SessionRow,
  SheetRowRecord
} from "@/types/database";

import { getSupabaseAdmin } from "@/lib/db/client";

function assertData<T>(
  data: T | null,
  error: { message: string } | null,
  fallbackMessage: string
) {
  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error(fallbackMessage);
  }

  return data;
}

export async function createSession(input: {
  status: SessionStatus;
  sheetFilename: string | null;
  pathMode: PathMode;
}) {
  const supabase = getSupabaseAdmin();
  const emptyColumnMapping: ColumnMapping = {
    product_name: null,
    sku: null,
    variation: null,
    color: null,
    size: null,
    image_url: null,
    parent_sku: null
  };
  const payload: SessionRow = {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    status: input.status,
    sheet_filename: input.sheetFilename,
    sheet_storage_path: null,
    upload_mode: null,
    path_mode: input.pathMode,
    total_rows: 0,
    total_images: 0,
    matched_count: 0,
    needs_review_count: 0,
    unmatched_count: 0,
    error_message: null,
    headers: [],
    column_mapping: emptyColumnMapping
  };

  const { data, error } = await supabase
    .from("sessions")
    .insert(payload)
    .select("*")
    .single();

  return assertData(data, error, "Failed to create session.");
}

export async function updateSession(
  sessionId: string,
  patch: Partial<SessionRow>
) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("sessions")
    .update(patch)
    .eq("id", sessionId)
    .select("*")
    .single();

  return assertData(data, error, "Failed to update session.");
}

export async function getSession(sessionId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  return assertData(data, error, "Session not found.");
}

export async function deleteSession(sessionId: string) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("sessions").delete().eq("id", sessionId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function listRecentSessions(limit = 6) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function insertSheetRows(rows: SheetRowRecord[]) {
  if (!rows.length) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("sheet_rows")
    .insert(rows)
    .select("*");

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function insertExtractedImages(images: ExtractedImageRecord[]) {
  if (!images.length) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("extracted_images")
    .insert(images)
    .select("*");

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function replaceMatches(sessionId: string, matches: MatchCandidate[]) {
  const supabase = getSupabaseAdmin();
  const { error: deleteError } = await supabase
    .from("matches")
    .delete()
    .eq("session_id", sessionId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  if (!matches.length) {
    return [];
  }

  const payload: MatchRecord[] = matches.map((match) => ({
    id: randomUUID(),
    session_id: sessionId,
    sheet_row_id: match.sheetRowId,
    image_id: match.imageId,
    confidence_score: match.confidenceScore,
    match_reason: match.matchReason,
    matched_by: match.matchedBy,
    status: match.status,
    is_manual: match.isManual
  }));

  const { data, error } = await supabase
    .from("matches")
    .insert(payload)
    .select("*");

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function deleteMatchForSheetRow(sessionId: string, sheetRowId: string) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("matches")
    .delete()
    .eq("session_id", sessionId)
    .eq("sheet_row_id", sheetRowId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function insertMatch(record: MatchRecord) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("matches")
    .insert(record)
    .select("*")
    .single();

  return assertData(data, error, "Failed to save match.");
}

export async function upsertAssetProcessingJobs(
  jobs: Array<
    Omit<AssetProcessingJobRecord, "id" | "created_at" | "updated_at"> & {
      id?: string;
      created_at?: string;
      updated_at?: string;
    }
  >
) {
  if (!jobs.length) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("asset_processing_jobs")
    .upsert(jobs, {
      onConflict: "image_id"
    })
    .select("*");

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function listRunnableAssetProcessingJobs(args: {
  sessionId: string;
  limit: number;
}) {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("asset_processing_jobs")
    .select("*")
    .eq("session_id", args.sessionId)
    .in("status", ["pending", "failed"])
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(args.limit * 3);

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as AssetProcessingJobRecord[])
    .filter((job) => job.attempt_count < job.max_attempts)
    .slice(0, args.limit);
}

export async function updateAssetProcessingJob(
  jobId: string,
  patch: Partial<AssetProcessingJobRecord>
) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("asset_processing_jobs")
    .update({
      ...patch,
      updated_at: new Date().toISOString()
    })
    .eq("id", jobId)
    .select("*")
    .single();

  return assertData(data, error, "Failed to update asset processing job.");
}

export async function countQueuedAssetProcessingJobs(sessionId: string) {
  const supabase = getSupabaseAdmin();
  const { count, error } = await supabase
    .from("asset_processing_jobs")
    .select("*", {
      count: "exact",
      head: true
    })
    .eq("session_id", sessionId)
    .in("status", ["pending", "failed", "processing"]);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

export async function upsertSheetRow(rowId: string, patch: Partial<SheetRowRecord>) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("sheet_rows")
    .update(patch)
    .eq("id", rowId)
    .select("*")
    .single();

  return assertData(data, error, "Failed to update sheet row.");
}

export async function updateSheetRows(rowIds: string[], patch: Partial<SheetRowRecord>) {
  if (!rowIds.length) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("sheet_rows")
    .update(patch)
    .in("id", rowIds)
    .select("*");

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function upsertExtractedImage(
  imageId: string,
  patch: Partial<ExtractedImageRecord>
) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("extracted_images")
    .update(patch)
    .eq("id", imageId)
    .select("*")
    .single();

  return assertData(data, error, "Failed to update image record.");
}

export async function logProcessing(
  sessionId: string,
  stage: string,
  message: string,
  meta?: Record<string, unknown>
) {
  const supabase = getSupabaseAdmin();
  const payload: ProcessingLogRecord = {
    id: randomUUID(),
    session_id: sessionId,
    stage,
    message,
    meta: meta ?? null,
    created_at: new Date().toISOString()
  };

  const { error } = await supabase.from("processing_logs").insert(payload);

  if (error) {
    throw new Error(error.message);
  }
}

export async function createExportRecord(input: {
  sessionId: string;
  exportType: string;
  filePath: string;
}) {
  const supabase = getSupabaseAdmin();
  const payload: ExportRecord = {
    id: randomUUID(),
    session_id: input.sessionId,
    export_type: input.exportType,
    file_path: input.filePath,
    created_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("exports")
    .insert(payload)
    .select("*")
    .single();

  return assertData(data, error, "Failed to create export record.");
}

export async function getSessionDetail(sessionId: string) {
  const supabase = getSupabaseAdmin();
  const [
    sessionResult,
    rowsResult,
    imagesResult,
    matchesResult,
    exportsResult,
    logsResult
  ] =
    await Promise.all([
      supabase.from("sessions").select("*").eq("id", sessionId).single(),
      supabase
        .from("sheet_rows")
        .select("*")
        .eq("session_id", sessionId)
        .order("row_index", { ascending: true }),
      supabase
        .from("extracted_images")
        .select("*")
        .eq("session_id", sessionId)
        .order("relative_path", { ascending: true }),
      supabase.from("matches").select("*").eq("session_id", sessionId),
      supabase
        .from("exports")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false }),
      supabase
        .from("processing_logs")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true })
    ]);

  const session = assertData(
    sessionResult.data,
    sessionResult.error,
    "Session not found."
  );

  if (rowsResult.error) {
    throw new Error(rowsResult.error.message);
  }

  if (imagesResult.error) {
    throw new Error(imagesResult.error.message);
  }

  if (matchesResult.error) {
    throw new Error(matchesResult.error.message);
  }

  if (exportsResult.error) {
    throw new Error(exportsResult.error.message);
  }

  if (logsResult.error) {
    throw new Error(logsResult.error.message);
  }

  return {
    session,
    sheetRows: rowsResult.data ?? [],
    extractedImages: imagesResult.data ?? [],
    matches: matchesResult.data ?? [],
    exports: exportsResult.data ?? [],
    logs: logsResult.data ?? []
  };
}

export async function getSheetRow(sessionId: string, rowId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("sheet_rows")
    .select("*")
    .eq("session_id", sessionId)
    .eq("id", rowId)
    .single();

  return assertData(data, error, "Sheet row not found.");
}

export async function getExtractedImage(sessionId: string, imageId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("extracted_images")
    .select("*")
    .eq("session_id", sessionId)
    .eq("id", imageId)
    .single();

  return assertData(data, error, "Image record not found.");
}

export async function listMatchedSheetRowIdsForImage(
  sessionId: string,
  imageId: string
) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("matches")
    .select("sheet_row_id")
    .eq("session_id", sessionId)
    .eq("image_id", imageId)
    .eq("status", "matched");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((item) => item.sheet_row_id);
}

export async function listMatchReviewItems(
  sessionId: string,
  options?: {
    filter?: MatchStatus | "all";
    page?: number;
    pageSize?: number;
  }
) {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("matches")
    .select(
      `
        id,
        sheet_row_id,
        image_id,
        confidence_score,
        match_reason,
        matched_by,
        status,
        is_manual,
        sheet_rows!inner(id,row_index,product_name,sku,variation,final_image_url),
        extracted_images(id,original_name,relative_path)
      `,
      { count: "exact" }
    )
    .eq("session_id", sessionId)
    .order("sheet_row_id", { ascending: true });

  if (options?.filter && options.filter !== "all") {
    query = query.eq("status", options.filter);
  }

  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await query.range(from, to);

  if (error) {
    throw new Error(error.message);
  }

  const items = ((data ?? []) as unknown as Array<{
    id: string;
    sheet_row_id: string;
    image_id: string | null;
    confidence_score: number | null;
    match_reason: string | null;
    matched_by: string;
    status: MatchStatus;
    is_manual: boolean;
    sheet_rows: Array<
      Pick<
        SheetRowRecord,
        "id" | "row_index" | "product_name" | "sku" | "variation" | "final_image_url"
      >
    >;
    extracted_images: Array<
      Pick<ExtractedImageRecord, "id" | "original_name" | "relative_path">
    >;
  }>).map<MatchReviewItem>((item) => {
    const sheetRow = item.sheet_rows?.[0];
    const extractedImage = item.extracted_images?.[0];

    return {
      matchId: item.id,
      sheetRowId: sheetRow?.id ?? item.sheet_row_id,
      rowIndex: sheetRow?.row_index ?? 0,
      productName: sheetRow?.product_name ?? null,
      sku: sheetRow?.sku ?? null,
      variation: sheetRow?.variation ?? null,
      matchedFilename: extractedImage?.original_name ?? null,
      relativePath: extractedImage?.relative_path ?? null,
      confidenceScore: item.confidence_score,
      matchReason: item.match_reason,
      finalImageUrl: sheetRow?.final_image_url ?? null,
      status: item.status,
      imageId: extractedImage?.id ?? item.image_id,
      isManual: item.is_manual
    };
  });

  return {
    items,
    total: count ?? items.length,
    page,
    pageSize
  };
}

export function toSessionSummary(session: SessionRow): SessionSummary {
  return {
    id: session.id,
    createdAt: session.created_at,
    status: session.status,
    sheetFilename: session.sheet_filename,
    uploadMode: session.upload_mode,
    pathMode: session.path_mode,
    totalRows: session.total_rows,
    totalImages: session.total_images,
    matchedCount: session.matched_count,
    unmatchedCount: session.unmatched_count,
    needsReviewCount: session.needs_review_count,
    headers: session.headers ?? [],
    columnMapping:
      session.column_mapping ??
      ({
        product_name: null,
        sku: null,
        variation: null,
        color: null,
        size: null,
        image_url: null,
        parent_sku: null
      } satisfies ColumnMapping)
  };
}
