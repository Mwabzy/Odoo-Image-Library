import * as XLSX from "xlsx";

import type {
  ExportRecord,
  ExtractedImageRecord,
  MatchRecord,
  SessionRow,
  SheetRowRecord
} from "@/types/database";

import { buildProcessedImageUrl } from "@/lib/cloudinary/service";
import {
  scoreImageProductName,
  scoreImageVariationName
} from "@/lib/matching/name-matcher";
import {
  isVariationTiedToRow,
  productSemanticSimilarity,
  semanticVariationSimilarity,
  splitVariationValues
} from "@/lib/matching/semantic";
import {
  buildOdooSyncInputFromSheetRow,
  prepareOdooBatch
} from "@/lib/odoo/image-pipeline";
import {
  normalizeIdentifier,
  uniqueBy
} from "@/lib/utils/normalization";

type OdooSlotAssignment = {
  header: string;
  variationValue: string;
  image: ExtractedImageRecord | null;
};

type OdooRowAssignment = {
  mainImage: ExtractedImageRecord | null;
  variationAssignments: OdooSlotAssignment[];
  usedImageIds: Set<string>;
  eligibleImages: ExtractedImageRecord[];
};

type PreparedOdooRowImage = Awaited<ReturnType<typeof prepareOdooBatch>>[number];

const ODOO_BASE64_IMAGE_HEADER = "image_1920";
const ODOO_BINARY_IMAGE_HEADER_PATTERN = /(^|\/)image_(\d+)$/i;

function getSafeExportBaseName(session: SessionRow) {
  const rawName = (session.sheet_filename ?? "").trim();
  const withoutExtension = rawName.replace(/\.[^.]+$/, "").trim();
  const safeBase = withoutExtension
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .trim();

  return safeBase || session.id;
}

function getProcessedImageUrl(image: ExtractedImageRecord) {
  if (image.processed_url) {
    return image.processed_url;
  }

  if (image.cloudinary_url) {
    return image.cloudinary_url;
  }

  if (image.cloudinary_public_id) {
    return buildProcessedImageUrl(image.cloudinary_public_id);
  }

  return null;
}

function isOdooBinaryImageHeader(header: string) {
  return ODOO_BINARY_IMAGE_HEADER_PATTERN.test(header.trim());
}

function hasOdooExternalIdColumn(headers: string[]) {
  return headers.some((header) => {
    const normalized = normalizeIdentifier(header);
    return normalized === "externalid" || normalized === "xmlid" || normalized === "id";
  });
}

function getPreparedBase64(
  preparedByRowId: Map<string, PreparedOdooRowImage>,
  rowId: string
) {
  const prepared = preparedByRowId.get(rowId);
  return prepared?.imageBase64 ?? null;
}

async function buildPreparedOdooImages(sheetRows: SheetRowRecord[]) {
  const prepared = await prepareOdooBatch(
    sheetRows.map((row) => buildOdooSyncInputFromSheetRow(row)),
    {
      targetMode: "odoo_api",
      allowUrlForNewProducts: false,
      includeAdditionalImages: false,
      concurrency: 4
    }
  );

  return new Map(prepared.map((item) => [item.rowId, item]));
}

function findHeader(
  headers: string[],
  matcher: (header: string) => boolean
) {
  return headers.find(matcher) ?? null;
}

function buildImagePool(extractedImages: ExtractedImageRecord[]) {
  const byProduct = new Map<string, ExtractedImageRecord[]>();

  for (const image of extractedImages) {
    const key = normalizeIdentifier(image.inferred_product);
    if (!key) {
      continue;
    }

    byProduct.set(key, [...(byProduct.get(key) ?? []), image]);
  }

  return byProduct;
}

function productPathMatchScore(image: ExtractedImageRecord, productName: string | null) {
  const productKey = normalizeIdentifier(productName);
  if (!productKey) {
    return 0;
  }

  const inferredProductKey = normalizeIdentifier(image.inferred_product);
  if (inferredProductKey === productKey) {
    return 1;
  }

  return Math.max(
    scoreImageProductName(image, productName).confidence,
    productSemanticSimilarity(image, productName)
  );
}

function variationMatchScore(
  image: ExtractedImageRecord,
  productName: string | null,
  variationValue: string
) {
  const imageVariation = normalizeIdentifier(image.inferred_variation);
  const variationKey = normalizeIdentifier(variationValue);

  if (!variationKey) {
    return 0;
  }

  if (imageVariation && imageVariation === variationKey) {
    return 1;
  }

  return Math.max(
    scoreImageVariationName(image, variationValue).confidence,
    semanticVariationSimilarity(image, productName, variationValue)
  );
}

function imageHasVariationTie(
  image: ExtractedImageRecord,
  productName: string | null,
  variationValues: string[]
) {
  return (
    isVariationTiedToRow(image, productName, variationValues) ||
    variationValues.some(
      (variationValue) =>
        variationMatchScore(image, productName, variationValue) >= 0.8
    )
  );
}

function pickVariationImage(
  images: ExtractedImageRecord[],
  productName: string | null,
  variationValue: string,
  usedImageIds: Set<string>
) {
  const candidates = images
    .filter((image) => !usedImageIds.has(image.id))
    .map((image) => ({
      image,
      score: variationMatchScore(image, productName, variationValue)
    }))
    .sort((left, right) => right.score - left.score);

  const best = candidates[0];
  return best && best.score >= 0.8 ? best.image : null;
}

function pickMainImage(
  images: ExtractedImageRecord[],
  usedImageIds: Set<string>,
  productName: string | null,
  variationValues: string[]
) {
  const unusedImages = images.filter(
    (image) =>
      !usedImageIds.has(image.id) &&
      !imageHasVariationTie(image, productName, variationValues)
  );
  const preferredMain =
    unusedImages.find(
      (image) =>
        !image.inferred_variation ||
        /(^|\/)(main|front|hero|primary)(\/|$)/i.test(image.relative_path)
    ) ?? unusedImages[0];

  return preferredMain ?? null;
}

function assignOdooImages(args: {
  headers: string[];
  row: SheetRowRecord;
  imagesByProduct: Map<string, ExtractedImageRecord[]>;
}): OdooRowAssignment {
  const productKey = normalizeIdentifier(args.row.product_name);
  const pooledImages = productKey ? args.imagesByProduct.get(productKey) ?? [] : [];
  const eligibleImages = pooledImages.filter(
    (image) => productPathMatchScore(image, args.row.product_name) >= 0.72
  );
  const variationHeaders = args.headers.filter((header) =>
    /^image url \(var \d+\)$/i.test(header)
  );
  const variationValues = splitVariationValues(
    (args.row.raw_json["Variation Values"] as string | undefined) ?? args.row.variation
  );
  const usedImageIds = new Set<string>();

  const variationAssignments = variationHeaders.map((header, index) => {
    const variationValue = variationValues[index];
    if (!variationValue) {
      return {
        header,
        variationValue: "",
        image: null
      };
    }

    const image = pickVariationImage(
      eligibleImages,
      args.row.product_name,
      variationValue,
      usedImageIds
    );
    if (image?.id) {
      usedImageIds.add(image.id);
    }

    return {
      header,
      variationValue,
      image
    };
  });

  const mainImage = pickMainImage(
    eligibleImages,
    usedImageIds,
    args.row.product_name,
    variationValues
  );
  if (mainImage?.id) {
    usedImageIds.add(mainImage.id);
  }

  return {
    mainImage,
    variationAssignments,
    usedImageIds,
    eligibleImages
  };
}

async function buildExportRows(
  session: SessionRow,
  sheetRows: SheetRowRecord[],
  extractedImages: ExtractedImageRecord[]
) {
  const imageColumn = session.column_mapping?.image_url ?? "Image URL";
  const initialHeaders = uniqueBy(
    [...((session.headers ?? []) as string[]), imageColumn],
    (header) => header
  ).filter(Boolean);
  const hasBinaryImageHeader = initialHeaders.some((header) =>
    isOdooBinaryImageHeader(header)
  );
  const odooBinaryHeaders = initialHeaders.filter((header) =>
    isOdooBinaryImageHeader(header)
  );
  const shouldAppendOdooBase64Header =
    hasOdooExternalIdColumn(initialHeaders) && !hasBinaryImageHeader;
  const headers = shouldAppendOdooBase64Header
    ? uniqueBy([...initialHeaders, ODOO_BASE64_IMAGE_HEADER], (header) => header)
    : initialHeaders;
  const imagesByProduct = buildImagePool(extractedImages);
  const hasOdooImageColumns =
    headers.includes("Image URL (Main)") ||
    headers.some((header) => /^Image URL \(Var \d+\)$/i.test(header));
  const preparedOdooImages =
    hasBinaryImageHeader || shouldAppendOdooBase64Header
      ? await buildPreparedOdooImages(sheetRows)
      : new Map<string, PreparedOdooRowImage>();

  const rows = [...sheetRows]
    .sort((left, right) => left.row_index - right.row_index)
    .map((row) => {
      const record = { ...row.raw_json } as Record<string, unknown>;
      const preparedBase64 = getPreparedBase64(preparedOdooImages, row.id);

      odooBinaryHeaders.forEach((header) => {
        record[header] = preparedBase64 ?? record[header] ?? "";
      });

      record[imageColumn] = isOdooBinaryImageHeader(imageColumn)
        ? preparedBase64 ?? record[imageColumn] ?? ""
        : row.final_image_url ?? record[imageColumn] ?? "";

      if (shouldAppendOdooBase64Header) {
        record[ODOO_BASE64_IMAGE_HEADER] = preparedBase64 ?? "";
      }

      if (hasOdooImageColumns) {
        const assignment = assignOdooImages({
          headers,
          row,
          imagesByProduct
        });
        const detectedMainHeader = findHeader(
          headers,
          (header) => normalizeIdentifier(header) === "imageurlmain"
        );
        const imageMainHeader =
          detectedMainHeader ??
          (row.raw_json["Image URL (Main)"] !== undefined ? "Image URL (Main)" : null);

        assignment.variationAssignments.forEach((slot) => {
          record[slot.header] = slot.image ? getProcessedImageUrl(slot.image) : "";
        });

        if (imageMainHeader) {
          record[imageMainHeader] = assignment.mainImage
            ? getProcessedImageUrl(assignment.mainImage)
            : "";
        }
      }

      return headers.map((header) => record[header] ?? "");
    });

  return {
    headers,
    rows
  };
}

export async function generateWorkbookExport(args: {
  session: SessionRow;
  sheetRows: SheetRowRecord[];
  extractedImages: ExtractedImageRecord[];
}) {
  const exportBaseName = getSafeExportBaseName(args.session);
  const workbook = XLSX.utils.book_new();
  const exportRows = await buildExportRows(
    args.session,
    args.sheetRows,
    args.extractedImages
  );
  const worksheet = XLSX.utils.aoa_to_sheet([
    exportRows.headers,
    ...exportRows.rows
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Products");

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx"
  }) as Buffer;

  return {
    buffer,
    fileName: `${exportBaseName}-updated.xlsx`,
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  };
}

export async function generateCsvExport(args: {
  session: SessionRow;
  sheetRows: SheetRowRecord[];
  extractedImages: ExtractedImageRecord[];
}) {
  const exportBaseName = getSafeExportBaseName(args.session);
  const workbook = XLSX.utils.book_new();
  const exportRows = await buildExportRows(
    args.session,
    args.sheetRows,
    args.extractedImages
  );
  const worksheet = XLSX.utils.aoa_to_sheet([
    exportRows.headers,
    ...exportRows.rows
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Products");

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "csv"
  }) as Buffer;

  return {
    buffer,
    fileName: `${exportBaseName}-updated.csv`,
    contentType: "text/csv"
  };
}

export function generateReviewReport(args: {
  session: SessionRow;
  sheetRows: SheetRowRecord[];
  extractedImages: ExtractedImageRecord[];
  matches: MatchRecord[];
  exports: ExportRecord[];
}) {
  const exportBaseName = getSafeExportBaseName(args.session);
  const rowsById = new Map(args.sheetRows.map((row) => [row.id, row]));
  const imagesById = new Map(args.extractedImages.map((image) => [image.id, image]));
  const matchedImageIds = new Set(
    args.matches.map((match) => match.image_id).filter(Boolean) as string[]
  );
  const headers = (args.session.headers ?? []) as string[];
  const hasOdooImageColumns =
    headers.includes("Image URL (Main)") ||
    headers.some((header) => /^Image URL \(Var \d+\)$/i.test(header));
  const imagesByProduct = buildImagePool(args.extractedImages);
  const exportUsedImageIds = new Set<string>();

  const reportRows: Array<{
    row_index: number | null;
    product_name: string | null;
    sku: string | null;
    variation: string | null;
    status: string;
    match_reason: string | null;
    image_file: string | null;
    relative_path: string | null;
  }> = args.matches
    .filter((match) => match.status !== "matched")
    .map((match) => {
      const row = rowsById.get(match.sheet_row_id);
      const image = match.image_id ? imagesById.get(match.image_id) : null;

      return {
        row_index: row?.row_index ?? null,
        product_name: row?.product_name ?? null,
        sku: row?.sku ?? null,
        variation: row?.variation ?? null,
        status: match.status,
        match_reason: match.match_reason,
        image_file: image?.original_name ?? null,
        relative_path: image?.relative_path ?? null
      };
    });

  if (hasOdooImageColumns) {
    for (const row of args.sheetRows) {
      const assignment = assignOdooImages({
        headers,
        row,
        imagesByProduct
      });

      assignment.usedImageIds.forEach((imageId) => exportUsedImageIds.add(imageId));

      if (!assignment.mainImage && assignment.eligibleImages.length) {
        reportRows.push({
          row_index: row.row_index,
          product_name: row.product_name,
          sku: row.sku,
          variation: null,
          status: "missing_main_image",
          match_reason: "no_default_non_variation_image",
          image_file: null,
          relative_path: null
        });
      }

      for (const slot of assignment.variationAssignments) {
        if (!slot.variationValue) {
          continue;
        }

        if (slot.image) {
          continue;
        }

        reportRows.push({
          row_index: row.row_index,
          product_name: row.product_name,
          sku: row.sku,
          variation: slot.variationValue,
          status: "unmatched_variation_slot",
          match_reason: "no_image_name_or_path_match_for_variation",
          image_file: null,
          relative_path: null
        });
      }
    }
  }

  for (const image of args.extractedImages) {
    if (matchedImageIds.has(image.id) || exportUsedImageIds.has(image.id)) {
      continue;
    }

    reportRows.push({
      row_index: null,
      product_name: image.inferred_product,
      sku: image.inferred_sku,
      variation: image.inferred_variation,
      status: "unmatched_image",
      match_reason: "image_not_assigned",
      image_file: image.original_name,
      relative_path: image.relative_path
    });
  }

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(reportRows);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Review Report");

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "csv"
  }) as Buffer;

  return {
    buffer,
    fileName: `${exportBaseName}-review-report.csv`,
    contentType: "text/csv"
  };
}
