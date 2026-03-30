import { createHash, randomUUID } from "node:crypto";

import type { SheetRowRecord } from "@/types/database";

import { fetchWithRetry } from "@/lib/utils/network";
import { normalizeWhitespace } from "@/lib/utils/normalization";

export type OdooOperationType = "new" | "update";
export type OdooImageStrategy = "base64" | "url" | "none" | "skip";
export type OdooTargetMode = "odoo_api" | "odoo_import";

type RawRecord = Record<string, unknown>;

type OdooLogger = Pick<Console, "info" | "warn" | "error">;

const EXTERNAL_ID_HEADERS = [
  "id",
  "External ID",
  "external id",
  "external_id",
  "xml id",
  "xml_id"
] as const;

const PRIMARY_IMAGE_HEADERS = [
  "Image URL",
  "image url",
  "Image URL (Main)",
  "image url (main)",
  "image_url",
  "image_1920"
] as const;

const ADDITIONAL_IMAGE_HEADER_PATTERN =
  /^(image url \(var \d+\)|additional image urls?|gallery image urls?)$/i;

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 3;

export interface OdooSyncInput {
  rowId?: string;
  externalId?: string | null;
  productName?: string | null;
  sku?: string | null;
  imageUrl?: string | null;
  additionalImageUrls?: string[];
  raw?: RawRecord;
  createValues?: Record<string, unknown>;
  updateValues?: Record<string, unknown>;
}

export interface DownloadedImagePayload {
  url: string;
  base64: string;
  bytes: number;
  contentType: string | null;
  sha256: string;
}

export interface PreparedOdooImagePayload {
  rowId: string;
  operation: OdooOperationType;
  strategy: OdooImageStrategy;
  externalId: string | null;
  productName: string | null;
  sku: string | null;
  imageUrl: string | null;
  imageBase64: string | null;
  additionalImages: DownloadedImagePayload[];
  additionalImageUrls: string[];
  sha256: string | null;
  skipped: boolean;
  reason: string | null;
  errors: string[];
  input: OdooSyncInput;
}

export interface PrepareOdooImageOptions {
  targetMode?: OdooTargetMode;
  allowUrlForNewProducts?: boolean;
  timeoutMs?: number;
  retries?: number;
  cache?: ImageDownloadCache;
  logger?: OdooLogger;
  includeAdditionalImages?: boolean;
}

export interface OdooImportRowOptions {
  urlColumnName?: string;
  base64ColumnName?: string;
}

export interface OdooJsonRpcConfig {
  baseUrl: string;
  database: string;
  username: string;
  password: string;
  timeoutMs?: number;
}

export interface OdooSyncOptions extends PrepareOdooImageOptions {
  client: OdooJsonRpcClient;
  records: OdooSyncInput[];
  concurrency?: number;
  skipIfImageUnchanged?: boolean;
  uploadAdditionalImages?: boolean;
}

export interface OdooSyncResult {
  rowId: string;
  operation: OdooOperationType;
  externalId: string | null;
  templateId: number | null;
  success: boolean;
  skipped: boolean;
  reason: string | null;
  errors: string[];
}

function toCleanString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = normalizeWhitespace(value);
  return normalized || null;
}

function normalizeImageUrl(url: string | null | undefined) {
  const cleaned = toCleanString(url);
  if (!cleaned) {
    return null;
  }

  return /^https?:\/\//i.test(cleaned) ? cleaned : null;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeImageUrl(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function isOdooSyncInput(input: OdooSyncInput | RawRecord): input is OdooSyncInput {
  return (
    "raw" in input ||
    "productName" in input ||
    "createValues" in input ||
    "updateValues" in input
  );
}

function getSourceRecord(input: OdooSyncInput | RawRecord) {
  return isOdooSyncInput(input) ? input.raw : input;
}

function getRawValue(record: RawRecord | undefined, aliases: readonly string[]) {
  if (!record) {
    return null;
  }

  for (const alias of aliases) {
    const value = toCleanString(record[alias]);
    if (value) {
      return value;
    }
  }

  return null;
}

function getAdditionalImageValues(record: RawRecord | undefined) {
  if (!record) {
    return [];
  }

  const urls: string[] = [];

  for (const [key, value] of Object.entries(record)) {
    if (!ADDITIONAL_IMAGE_HEADER_PATTERN.test(key)) {
      continue;
    }

    if (typeof value !== "string") {
      continue;
    }

    value
      .split(/[,\n;]/)
      .map((item) => normalizeImageUrl(item))
      .filter((item): item is string => Boolean(item))
      .forEach((item) => urls.push(item));
  }

  return uniqueStrings(urls);
}

function isLikelyImageResponse(contentType: string | null, url: string) {
  if (contentType?.toLowerCase().startsWith("image/")) {
    return true;
  }

  return /\.(avif|gif|jpe?g|png|svg|webp)(\?.*)?$/i.test(url);
}

async function runWithConcurrency<TInput, TOutput>(
  values: TInput[],
  concurrency: number,
  worker: (value: TInput, index: number) => Promise<TOutput>
) {
  const safeConcurrency = Math.max(1, concurrency);
  const results = new Array<TOutput>(values.length);
  let cursor = 0;

  async function consume() {
    while (cursor < values.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await worker(values[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(safeConcurrency, values.length) }, () => consume())
  );

  return results;
}

export function extractExternalId(input: OdooSyncInput | RawRecord) {
  if (isOdooSyncInput(input)) {
    return (
      toCleanString(input.externalId) ??
      getRawValue(input.raw, EXTERNAL_ID_HEADERS)
    );
  }

  return getRawValue(getSourceRecord(input), EXTERNAL_ID_HEADERS);
}

export function detectOdooOperationType(input: OdooSyncInput | RawRecord): OdooOperationType {
  return extractExternalId(input) ? "update" : "new";
}

export function extractPrimaryImageUrl(input: OdooSyncInput | RawRecord) {
  if (isOdooSyncInput(input)) {
    return (
      normalizeImageUrl(input.imageUrl) ??
      normalizeImageUrl(getRawValue(input.raw, PRIMARY_IMAGE_HEADERS))
    );
  }

  return normalizeImageUrl(getRawValue(getSourceRecord(input), PRIMARY_IMAGE_HEADERS));
}

export function extractAdditionalImageUrls(input: OdooSyncInput | RawRecord) {
  if (isOdooSyncInput(input)) {
    return uniqueStrings([
      ...(input.additionalImageUrls ?? []),
      ...getAdditionalImageValues(input.raw)
    ]);
  }

  return getAdditionalImageValues(getSourceRecord(input));
}

export function buildOdooSyncInputFromSheetRow(row: SheetRowRecord): OdooSyncInput {
  // The app already keeps the original spreadsheet row plus the matched image URL,
  // so we derive Odoo behavior here instead of duplicating row-shaping elsewhere.
  return {
    rowId: row.id,
    externalId: extractExternalId(row.raw_json),
    productName: row.product_name,
    sku: row.sku,
    imageUrl: row.final_image_url ?? extractPrimaryImageUrl(row.raw_json),
    additionalImageUrls: extractAdditionalImageUrls(row.raw_json),
    raw: row.raw_json
  };
}

export class ImageDownloadCache {
  private readonly store = new Map<string, Promise<DownloadedImagePayload>>();

  get(url: string, loader: () => Promise<DownloadedImagePayload>) {
    const cached = this.store.get(url);
    if (cached) {
      return cached;
    }

    const promise = loader().catch((error) => {
      this.store.delete(url);
      throw error;
    });

    this.store.set(url, promise);
    return promise;
  }
}

export async function fetchImageAsBase64(
  url: string,
  options: Pick<PrepareOdooImageOptions, "timeoutMs" | "retries" | "cache"> = {}
) {
  const cache = options.cache ?? new ImageDownloadCache();

  return cache.get(url, async () => {
    // Odoo update calls expect a raw base64 payload, so we cache the downloaded
    // binary once per URL and reuse it across every matching row in the batch.
    const response = await fetchWithRetry(url, {
      method: "GET",
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retries: options.retries ?? DEFAULT_RETRIES,
      headers: {
        Accept: "image/*"
      }
    });

    if (!response.ok) {
      throw new Error(`Image download failed with HTTP ${response.status} for ${url}`);
    }

    const contentType = response.headers.get("content-type");
    if (!isLikelyImageResponse(contentType, url)) {
      throw new Error(`Response is not a supported image for ${url}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());

    return {
      url,
      base64: bytes.toString("base64"),
      bytes: bytes.byteLength,
      contentType,
      sha256: createHash("sha256").update(bytes).digest("hex")
    };
  });
}

export async function prepareOdooImagePayload(
  input: OdooSyncInput,
  options: PrepareOdooImageOptions = {}
): Promise<PreparedOdooImagePayload> {
  const targetMode = options.targetMode ?? "odoo_api";
  const allowUrlForNewProducts = options.allowUrlForNewProducts ?? true;
  const cache = options.cache ?? new ImageDownloadCache();
  const logger = options.logger ?? console;
  const operation = detectOdooOperationType(input);
  const primaryImageUrl = extractPrimaryImageUrl(input);
  const rowId = input.rowId ?? randomUUID();
  const additionalImageUrls =
    options.includeAdditionalImages === false ? [] : extractAdditionalImageUrls(input);

  if (!primaryImageUrl) {
    return {
      rowId,
      operation,
      strategy: "none",
      externalId: extractExternalId(input),
      productName: toCleanString(input.productName) ?? null,
      sku: toCleanString(input.sku) ?? null,
      imageUrl: null,
      imageBase64: null,
      additionalImages: [],
      additionalImageUrls,
      sha256: null,
      skipped: true,
      reason: "No image URL was provided.",
      errors: [],
      input
    };
  }

  const shouldUseRawUrl =
    targetMode === "odoo_import" &&
    operation === "new" &&
    allowUrlForNewProducts;

  if (shouldUseRawUrl) {
    logger.info("[odoo] using direct image URL for new-product import", {
      rowId,
      imageUrl: primaryImageUrl
    });

    return {
      rowId,
      operation,
      strategy: "url",
      externalId: extractExternalId(input),
      productName: toCleanString(input.productName) ?? null,
      sku: toCleanString(input.sku) ?? null,
      imageUrl: primaryImageUrl,
      imageBase64: null,
      additionalImages: [],
      additionalImageUrls,
      sha256: null,
      skipped: false,
      reason: "New product import is allowed to keep the remote image URL.",
      errors: [],
      input
    };
  }

  try {
    const [mainImage, additionalImages] = await Promise.all([
      fetchImageAsBase64(primaryImageUrl, {
        timeoutMs: options.timeoutMs,
        retries: options.retries,
        cache
      }),
      runWithConcurrency(
        additionalImageUrls,
        4,
        async (imageUrl) =>
          fetchImageAsBase64(imageUrl, {
            timeoutMs: options.timeoutMs,
            retries: options.retries,
            cache
          })
      )
    ]);

    logger.info("[odoo] prepared base64 image payload", {
      rowId,
      operation,
      imageUrl: mainImage.url,
      additionalImages: additionalImages.length
    });

    return {
      rowId,
      operation,
      strategy: "base64",
      externalId: extractExternalId(input),
      productName: toCleanString(input.productName) ?? null,
      sku: toCleanString(input.sku) ?? null,
      imageUrl: mainImage.url,
      imageBase64: mainImage.base64,
      additionalImages,
      additionalImageUrls,
      sha256: mainImage.sha256,
      skipped: false,
      reason:
        operation === "update"
          ? "Existing products must send image_1920 as base64."
          : "Odoo API writes image_1920 as base64 for new products too.",
      errors: [],
      input
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to prepare Odoo image payload.";

    logger.error("[odoo] failed to prepare image payload", {
      rowId,
      operation,
      imageUrl: primaryImageUrl,
      error: message
    });

    return {
      rowId,
      operation,
      strategy: "skip",
      externalId: extractExternalId(input),
      productName: toCleanString(input.productName) ?? null,
      sku: toCleanString(input.sku) ?? null,
      imageUrl: primaryImageUrl,
      imageBase64: null,
      additionalImages: [],
      additionalImageUrls,
      sha256: null,
      skipped: true,
      reason: "Image download failed.",
      errors: [message],
      input
    };
  }
}

export async function prepareOdooBatch(
  inputs: OdooSyncInput[],
  options: PrepareOdooImageOptions & { concurrency?: number } = {}
) {
  const cache = options.cache ?? new ImageDownloadCache();

  // Shared cache + bounded concurrency keeps large imports fast without
  // downloading the same Cloudinary asset over and over again.
  return runWithConcurrency(
    inputs,
    options.concurrency ?? 4,
    async (input) =>
      prepareOdooImagePayload(input, {
        ...options,
        cache
      })
  );
}

export function buildOdooImportRow(
  prepared: PreparedOdooImagePayload,
  options: OdooImportRowOptions = {}
) {
  const urlColumnName = options.urlColumnName ?? "Image URL";
  const base64ColumnName = options.base64ColumnName ?? "image_1920";
  const row = { ...(prepared.input.raw ?? {}) };

  if (prepared.strategy === "url" && prepared.imageUrl) {
    row[urlColumnName] = prepared.imageUrl;
  }

  if (prepared.strategy === "base64" && prepared.imageBase64) {
    row[base64ColumnName] = prepared.imageBase64;
  }

  return row;
}

function splitExternalId(value: string) {
  const [module, ...rest] = value.split(".");
  if (!rest.length) {
    return {
      completeName: null,
      name: module
    };
  }

  return {
    completeName: value,
    name: rest.join(".")
  };
}

function decodeBase64Hash(base64Value: string | null | undefined) {
  if (!base64Value) {
    return null;
  }

  return createHash("sha256")
    .update(Buffer.from(base64Value, "base64"))
    .digest("hex");
}

function chunk<T>(values: T[], size: number) {
  const result: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }

  return result;
}

export class OdooJsonRpcClient {
  private uidPromise: Promise<number> | null = null;

  constructor(private readonly config: OdooJsonRpcConfig) {}

  private async call<T>(service: string, method: string, args: unknown[]) {
    const response = await fetchWithRetry(`${this.config.baseUrl}/jsonrpc`, {
      method: "POST",
      timeoutMs: this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        id: randomUUID(),
        params: {
          service,
          method,
          args
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Odoo JSON-RPC call failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      error?: { data?: { message?: string }; message?: string };
      result?: T;
    };

    if (payload.error) {
      throw new Error(
        payload.error.data?.message ?? payload.error.message ?? "Odoo JSON-RPC call failed."
      );
    }

    return payload.result as T;
  }

  async authenticate() {
    if (!this.uidPromise) {
      this.uidPromise = this.call<number>("common", "login", [
        this.config.database,
        this.config.username,
        this.config.password
      ]);
    }

    return this.uidPromise;
  }

  async executeKw<T>(
    model: string,
    method: string,
    args: unknown[] = [],
    kwargs: Record<string, unknown> = {}
  ) {
    const uid = await this.authenticate();

    return this.call<T>("object", "execute_kw", [
      this.config.database,
      uid,
      this.config.password,
      model,
      method,
      args,
      kwargs
    ]);
  }

  async resolveProductTemplateIds(externalIds: string[]) {
    // External IDs live in ir.model.data, so updates first resolve those IDs
    // back to concrete product.template record ids before calling write().
    const completeNames = externalIds
      .map(splitExternalId)
      .map((value) => value.completeName)
      .filter((value): value is string => Boolean(value));
    const simpleNames = externalIds
      .map(splitExternalId)
      .map((value) => value.name)
      .filter(Boolean);
    const domain: unknown[] = [["model", "=", "product.template"]];

    if (completeNames.length && simpleNames.length) {
      domain.push(
        "|",
        ["complete_name", "in", completeNames],
        ["name", "in", simpleNames]
      );
    } else if (completeNames.length) {
      domain.push(["complete_name", "in", completeNames]);
    } else if (simpleNames.length) {
      domain.push(["name", "in", simpleNames]);
    }

    const records = await this.executeKw<
      Array<{ complete_name?: string; name?: string; res_id: number }>
    >("ir.model.data", "search_read", [domain], {
      fields: ["complete_name", "name", "res_id"],
      limit: Math.max(externalIds.length * 2, 50)
    });

    const byExternalId = new Map<string, number>();

    for (const record of records) {
      if (record.complete_name) {
        byExternalId.set(record.complete_name, record.res_id);
      }

      if (record.name) {
        byExternalId.set(record.name, record.res_id);
      }
    }

    return byExternalId;
  }

  async readCurrentImageHashes(templateIds: number[]) {
    const hashes = new Map<number, string>();

    for (const group of chunk(templateIds, 50)) {
      const records = await this.executeKw<Array<{ id: number; image_1920?: string }>>(
        "product.template",
        "read",
        [group],
        {
          fields: ["image_1920"]
        }
      );

      for (const record of records) {
        const hash = decodeBase64Hash(record.image_1920);
        if (hash) {
          hashes.set(record.id, hash);
        }
      }
    }

    return hashes;
  }
}

function buildDefaultCreateValues(input: OdooSyncInput) {
  const values: Record<string, unknown> = {
    ...(input.createValues ?? {})
  };

  if (!values.name && input.productName) {
    values.name = input.productName;
  }

  if (!values.default_code && input.sku) {
    values.default_code = input.sku;
  }

  return values;
}

function buildDefaultUpdateValues(input: OdooSyncInput) {
  return {
    ...(input.updateValues ?? {})
  };
}

export async function syncProductTemplates(
  options: OdooSyncOptions
): Promise<OdooSyncResult[]> {
  const logger = options.logger ?? console;
  const prepared = await prepareOdooBatch(options.records, {
    ...options,
    targetMode: "odoo_api"
  });
  const updateExternalIds = prepared
    .filter((item) => item.operation === "update" && item.externalId)
    .map((item) => item.externalId as string);
  const externalIdMap = updateExternalIds.length
    ? await options.client.resolveProductTemplateIds(updateExternalIds)
    : new Map<string, number>();
  const currentHashes =
    options.skipIfImageUnchanged && externalIdMap.size
      ? await options.client.readCurrentImageHashes([...externalIdMap.values()])
      : new Map<number, string>();
  const results: OdooSyncResult[] = [];

  for (const item of prepared) {
    if (item.errors.length) {
      results.push({
        rowId: item.rowId,
        operation: item.operation,
        externalId: item.externalId,
        templateId: null,
        success: false,
        skipped: true,
        reason: item.reason,
        errors: item.errors
      });
      continue;
    }

    try {
      if (item.operation === "update") {
        const externalId = item.externalId;
        const templateId = externalId ? externalIdMap.get(externalId) ?? null : null;

        if (!templateId) {
          results.push({
            rowId: item.rowId,
            operation: item.operation,
            externalId,
            templateId: null,
            success: false,
            skipped: true,
            reason: "External ID was not found in Odoo.",
            errors: [`Unable to resolve product.template for "${externalId ?? "unknown"}".`]
          });
          continue;
        }

        const updateValues = buildDefaultUpdateValues(item.input);
        if (item.imageBase64) {
          updateValues.image_1920 = item.imageBase64;
        }

        if (
          options.skipIfImageUnchanged &&
          item.sha256 &&
          currentHashes.get(templateId) === item.sha256 &&
          !Object.keys(buildDefaultUpdateValues(item.input)).length
        ) {
          results.push({
            rowId: item.rowId,
            operation: item.operation,
            externalId,
            templateId,
            success: true,
            skipped: true,
            reason: "Image already matches Odoo.",
            errors: []
          });
          continue;
        }

        if (Object.keys(updateValues).length) {
          // Existing products must be updated by resolved record id, not by URL.
          await options.client.executeKw<boolean>("product.template", "write", [
            [templateId],
            updateValues
          ]);
        }

        if (options.uploadAdditionalImages && item.additionalImages.length) {
          await Promise.all(
            item.additionalImages.map((image) =>
              options.client.executeKw<number>("product.image", "create", [
                {
                  name: item.productName ?? item.sku ?? "Additional image",
                  product_tmpl_id: templateId,
                  image_1920: image.base64
                }
              ])
            )
          );
        }

        logger.info("[odoo] updated product.template", {
          externalId,
          templateId
        });

        results.push({
          rowId: item.rowId,
          operation: item.operation,
          externalId,
          templateId,
          success: true,
          skipped: false,
          reason: "Updated product image in Odoo.",
          errors: []
        });
        continue;
      }

      const createValues = buildDefaultCreateValues(item.input);
      if (item.imageBase64) {
        createValues.image_1920 = item.imageBase64;
      }

      // New records can still use base64 when calling the API, even if the import
      // flow is allowed to keep a remote URL for spreadsheet-based creation.
      const templateId = await options.client.executeKw<number>(
        "product.template",
        "create",
        [createValues]
      );

      if (options.uploadAdditionalImages && item.additionalImages.length) {
        await Promise.all(
          item.additionalImages.map((image) =>
            options.client.executeKw<number>("product.image", "create", [
              {
                name: item.productName ?? item.sku ?? "Additional image",
                product_tmpl_id: templateId,
                image_1920: image.base64
              }
            ])
          )
        );
      }

      logger.info("[odoo] created product.template", {
        templateId,
        productName: item.productName
      });

      results.push({
        rowId: item.rowId,
        operation: item.operation,
        externalId: item.externalId,
        templateId,
        success: true,
        skipped: false,
        reason: "Created product in Odoo.",
        errors: []
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to sync product.template.";

      logger.error("[odoo] product sync failed", {
        rowId: item.rowId,
        externalId: item.externalId,
        error: message
      });

      results.push({
        rowId: item.rowId,
        operation: item.operation,
        externalId: item.externalId,
        templateId: null,
        success: false,
        skipped: false,
        reason: "Odoo API call failed.",
        errors: [message]
      });
    }
  }

  return results;
}
