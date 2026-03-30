import type { NormalizedImageInput, PathMode } from "@/types/domain";

import { env } from "@/lib/utils/env";
import {
  assertUploadSize,
  getExtension,
  isImageFile
} from "@/lib/utils/files";
import { inferImageMetadataFromPath } from "@/lib/parsing/path-inference";

function guessMimeType(extension: string) {
  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".bmp":
      return "image/bmp";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

async function openZipBuffer(buffer: Buffer) {
  const directoryModule = (await import("unzipper/lib/Open/directory")) as {
    default?: (source: {
      stream: (offset: number, length?: number) => NodeJS.ReadableStream;
      size: () => Promise<number>;
    }) => Promise<{ files: Array<{ type: string; path: string; buffer: () => Promise<Buffer> }> }>;
  };
  const openDirectory =
    directoryModule.default ??
    (directoryModule as unknown as (source: {
      stream: (offset: number, length?: number) => NodeJS.ReadableStream;
      size: () => Promise<number>;
    }) => Promise<{ files: Array<{ type: string; path: string; buffer: () => Promise<Buffer> }> }>);
  const { PassThrough } = await import("node:stream");

  return openDirectory({
    stream(offset: number, length?: number) {
      const stream = new PassThrough();
      const end = length ? offset + length : undefined;
      stream.end(buffer.slice(offset, end));
      return stream;
    },
    size() {
      return Promise.resolve(buffer.length);
    }
  });
}

export async function normalizeFolderUpload(args: {
  sessionId: string;
  files: File[];
  relativePaths: string[];
  pathMode: PathMode;
}) {
  if (args.files.length > env.maxImagesPerUpload) {
    throw new Error(
      `Image upload exceeds the configured limit of ${env.maxImagesPerUpload} files.`
    );
  }

  const accepted: NormalizedImageInput[] = [];
  const rejected: Array<{ name: string; reason: string }> = [];

  for (const [index, file] of args.files.entries()) {
    const relativePath = args.relativePaths[index] ?? file.name;

    try {
      assertUploadSize(file.size);

      if (!isImageFile(file.name, file.type)) {
        rejected.push({
          name: relativePath,
          reason: "Unsupported image file type."
        });
        continue;
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const extension = getExtension(file.name);
      const inferred = inferImageMetadataFromPath(relativePath, args.pathMode);

      accepted.push({
        sessionId: args.sessionId,
        originalName: file.name,
        relativePath,
        normalizedPath: inferred.normalizedPath,
        extension,
        bytes: file.size,
        mimeType: file.type || guessMimeType(extension),
        inferredProduct: inferred.inferredProduct,
        inferredVariation: inferred.inferredVariation,
        inferredSku: inferred.inferredSku,
        buffer
      });
    } catch (error) {
      rejected.push({
        name: relativePath,
        reason: error instanceof Error ? error.message : "Failed to read file."
      });
    }
  }

  return { accepted, rejected };
}

export async function extractZipImages(args: {
  sessionId: string;
  archiveName: string;
  buffer: Buffer;
  pathMode: PathMode;
}) {
  assertUploadSize(args.buffer.byteLength);

  const directory = await openZipBuffer(args.buffer);
  const entries = (directory.files ?? []) as Array<{
    type: string;
    path: string;
    buffer: () => Promise<Buffer>;
  }>;

  if (!entries.length) {
    throw new Error(`ZIP archive "${args.archiveName}" is empty.`);
  }

  const accepted: NormalizedImageInput[] = [];
  const rejected: Array<{ name: string; reason: string }> = [];

  for (const entry of entries) {
    if (entry.type !== "File") {
      continue;
    }

    const extension = getExtension(entry.path);

    if (!isImageFile(entry.path, guessMimeType(extension))) {
      rejected.push({
        name: entry.path,
        reason: "Unsupported image file type inside ZIP."
      });
      continue;
    }

    const buffer = await entry.buffer();
    const inferred = inferImageMetadataFromPath(entry.path, args.pathMode);

    accepted.push({
      sessionId: args.sessionId,
      originalName: entry.path.split("/").at(-1) ?? entry.path,
      relativePath: entry.path,
      normalizedPath: inferred.normalizedPath,
      extension,
      bytes: buffer.byteLength,
      mimeType: guessMimeType(extension),
      inferredProduct: inferred.inferredProduct,
      inferredVariation: inferred.inferredVariation,
      inferredSku: inferred.inferredSku,
      buffer
    });
  }

  if (!accepted.length) {
    throw new Error(
      `ZIP archive "${args.archiveName}" does not contain any supported images.`
    );
  }

  return { accepted, rejected };
}
