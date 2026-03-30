const DEFAULT_MAX_UPLOAD_MB = 100;
const DEFAULT_MAX_IMAGES = 500;
const DEFAULT_CLOUDINARY_READ_TIMEOUT_MS = 15_000;
const DEFAULT_ASSET_JOB_BATCH_SIZE = 4;
const DEFAULT_ASSET_JOB_MAX_ATTEMPTS = 4;

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY ?? "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
  cloudinaryUploadFolder:
    process.env.CLOUDINARY_UPLOAD_FOLDER ?? "product-image-automation",
  cloudinaryReadTimeoutMs: Number(
    process.env.CLOUDINARY_READ_TIMEOUT_MS ?? DEFAULT_CLOUDINARY_READ_TIMEOUT_MS
  ),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? DEFAULT_MAX_UPLOAD_MB),
  maxImagesPerUpload: Number(
    process.env.MAX_IMAGES_PER_UPLOAD ?? DEFAULT_MAX_IMAGES
  ),
  assetJobBatchSize: Number(
    process.env.ASSET_JOB_BATCH_SIZE ?? DEFAULT_ASSET_JOB_BATCH_SIZE
  ),
  assetJobMaxAttempts: Number(
    process.env.ASSET_JOB_MAX_ATTEMPTS ?? DEFAULT_ASSET_JOB_MAX_ATTEMPTS
  )
};

export function maxUploadBytes() {
  return env.maxUploadMb * 1024 * 1024;
}

export function requireEnv(name: keyof typeof env) {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
