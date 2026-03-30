import { z } from "zod";

import { maxUploadBytes } from "@/lib/utils/env";

export const spreadsheetExtensions = [".xlsx", ".xls", ".csv"] as const;
export const imageExtensions = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".svg"
] as const;

export const imageMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "image/svg+xml"
]);

export const spreadsheetMimeTypes = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
  "text/plain"
]);

export const uploadModeSchema = z.enum(["folder", "zip"]);
export const pathModeSchema = z.enum([
  "auto",
  "folder-product-variation",
  "folder-product-only"
]);

export function getExtension(fileName: string) {
  const match = /\.[^.]+$/.exec(fileName.toLowerCase());
  return match?.[0] ?? "";
}

export function isSpreadsheetFile(
  fileName: string,
  mimeType: string | undefined | null
) {
  const extension = getExtension(fileName);
  return (
    spreadsheetExtensions.includes(
      extension as (typeof spreadsheetExtensions)[number]
    ) || spreadsheetMimeTypes.has(mimeType ?? "")
  );
}

export function isImageFile(fileName: string, mimeType: string | undefined | null) {
  const extension = getExtension(fileName);
  return (
    imageExtensions.includes(extension as (typeof imageExtensions)[number]) ||
    imageMimeTypes.has(mimeType ?? "")
  );
}

export function assertUploadSize(bytes: number) {
  if (bytes > maxUploadBytes()) {
    throw new Error(
      `Upload exceeds the configured maximum size of ${maxUploadBytes()} bytes.`
    );
  }
}
