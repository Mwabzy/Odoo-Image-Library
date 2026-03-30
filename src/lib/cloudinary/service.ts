import { v2 as cloudinary } from "cloudinary";

import { env } from "@/lib/utils/env";
import { fetchWithRetry } from "@/lib/utils/network";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function isCloudinaryConfigured() {
  return Boolean(
    env.cloudinaryCloudName && env.cloudinaryApiKey && env.cloudinaryApiSecret
  );
}

function getCloudinary() {
  if (!isCloudinaryConfigured()) {
    throw new Error(
      "Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET."
    );
  }

  cloudinary.config({
    cloud_name: env.cloudinaryCloudName,
    api_key: env.cloudinaryApiKey,
    api_secret: env.cloudinaryApiSecret,
    secure: true
  });

  return cloudinary;
}

export async function uploadOriginalImage(input: {
  sessionId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}) {
  const client = getCloudinary();
  const publicId = `${env.cloudinaryUploadFolder}/sessions/${input.sessionId}/originals/${slugify(
    input.fileName.replace(/\.[^.]+$/, "")
  )}-${Date.now()}`;
  const dataUri = `data:${input.mimeType};base64,${input.buffer.toString("base64")}`;

  const result = await client.uploader.upload(dataUri, {
    public_id: publicId,
    resource_type: "image",
    overwrite: false
  });

  return {
    publicId: result.public_id,
    secureUrl: result.secure_url
  };
}

export function buildProcessedImageUrl(publicId: string) {
  const client = getCloudinary();

  return client.url(publicId, {
    secure: true,
    format: "png",
    transformation: [
      {
        effect: "background_removal"
      },
      {
        quality: "auto"
      }
    ]
  });
}

export function resolveDeliveryUrl(input: {
  cloudinaryUrl: string | null;
  processedUrl: string | null;
}) {
  return input.processedUrl ?? input.cloudinaryUrl ?? null;
}

export async function warmProcessedImageUrl(input: { publicId: string }) {
  const processedUrl = buildProcessedImageUrl(input.publicId);

  // Trigger the derived asset in the background using a generous timeout and retries.
  // We cancel the body stream once headers arrive so the app doesn't download the full file.
  const response = await fetchWithRetry(processedUrl, {
    method: "GET",
    timeoutMs: env.cloudinaryReadTimeoutMs,
    retries: 3,
    headers: {
      Accept: "image/*"
    }
  });

  try {
    await response.body?.cancel();
  } catch {
    // Ignore best-effort stream cancellation failures.
  }

  return {
    processedUrl,
    statusCode: response.status
  };
}
