import type {
  ColumnMapping,
  MatchStatus,
  PathMode,
  SessionStatus,
  UploadMode
} from "@/types/domain";

export interface SessionRow {
  id: string;
  created_at: string;
  status: SessionStatus;
  sheet_filename: string | null;
  sheet_storage_path: string | null;
  upload_mode: UploadMode | null;
  path_mode: PathMode;
  total_rows: number;
  total_images: number;
  matched_count: number;
  needs_review_count: number;
  unmatched_count: number;
  error_message: string | null;
  headers: string[] | null;
  column_mapping: ColumnMapping | null;
}

export interface SheetRowRecord {
  id: string;
  session_id: string;
  row_index: number;
  product_name: string | null;
  sku: string | null;
  variation: string | null;
  color: string | null;
  size: string | null;
  parent_sku: string | null;
  raw_json: Record<string, unknown>;
  final_image_url: string | null;
  status: MatchStatus | "pending";
}

export interface ExtractedImageRecord {
  id: string;
  session_id: string;
  original_name: string;
  relative_path: string;
  normalized_path: string;
  extension: string;
  mime_type: string;
  bytes: number;
  inferred_product: string | null;
  inferred_variation: string | null;
  inferred_sku: string | null;
  cloudinary_public_id: string | null;
  cloudinary_url: string | null;
  processed_url: string | null;
  status: MatchStatus | "pending" | "uploaded" | "processing_failed";
}

export interface MatchRecord {
  id: string;
  session_id: string;
  sheet_row_id: string;
  image_id: string | null;
  confidence_score: number | null;
  match_reason: string | null;
  matched_by: string;
  status: MatchStatus;
  is_manual: boolean;
}

export interface AssetProcessingJobRecord {
  id: string;
  session_id: string;
  image_id: string;
  cloudinary_public_id: string;
  delivery_url: string;
  status: "pending" | "processing" | "completed" | "failed";
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  scheduled_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExportRecord {
  id: string;
  session_id: string;
  export_type: string;
  file_path: string;
  created_at: string;
}

export interface ProcessingLogRecord {
  id: string;
  session_id: string;
  stage: string;
  message: string;
  meta: Record<string, unknown> | null;
  created_at: string;
}
