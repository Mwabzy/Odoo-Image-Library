export type SessionStatus =
  | "draft"
  | "ready"
  | "processing"
  | "completed"
  | "failed";

export type MatchStatus =
  | "matched"
  | "needs_review"
  | "unmatched"
  | "duplicate_conflict";

export type UploadMode = "folder" | "zip";
export type PathMode =
  | "auto"
  | "folder-product-variation"
  | "folder-product-only";

export interface ColumnMapping {
  product_name: string | null;
  sku: string | null;
  variation: string | null;
  color: string | null;
  size: string | null;
  image_url: string | null;
  parent_sku: string | null;
}

export interface ParsedSheetRow {
  row_index: number;
  product_name: string | null;
  sku: string | null;
  variation: string | null;
  color: string | null;
  size: string | null;
  image_url: string | null;
  parent_sku: string | null;
  raw_json: Record<string, unknown>;
  status: MatchStatus | "pending";
}

export interface ParsedSpreadsheet {
  headers: string[];
  totalRows: number;
  rows: ParsedSheetRow[];
  columnMapping: ColumnMapping;
}

export interface NormalizedImageInput {
  sessionId: string;
  originalName: string;
  relativePath: string;
  normalizedPath: string;
  extension: string;
  bytes: number;
  mimeType: string;
  inferredProduct: string | null;
  inferredVariation: string | null;
  inferredSku: string | null;
  buffer: Buffer;
}

export interface MatchCandidate {
  sheetRowId: string;
  imageId: string | null;
  confidenceScore: number;
  matchReason: string;
  matchedBy: string;
  status: MatchStatus;
  isManual: boolean;
}

export interface SessionMetrics {
  totalRows: number;
  totalImages: number;
  matched: number;
  unmatched: number;
  needsReview: number;
}

export interface SessionSummary {
  id: string;
  createdAt: string;
  status: SessionStatus;
  sheetFilename: string | null;
  uploadMode: UploadMode | null;
  pathMode: PathMode;
  totalRows: number;
  totalImages: number;
  matchedCount: number;
  unmatchedCount: number;
  needsReviewCount: number;
  headers: string[];
  columnMapping: ColumnMapping;
}

export interface MatchReviewItem {
  matchId: string | null;
  sheetRowId: string;
  rowIndex: number;
  productName: string | null;
  sku: string | null;
  variation: string | null;
  matchedFilename: string | null;
  relativePath: string | null;
  confidenceScore: number | null;
  matchReason: string | null;
  finalImageUrl: string | null;
  status: MatchStatus;
  imageId: string | null;
  isManual: boolean;
}
