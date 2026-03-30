import * as XLSX from "xlsx";

import type { ColumnMapping, ParsedSheetRow, ParsedSpreadsheet } from "@/types/domain";

import { normalizeWhitespace } from "@/lib/utils/normalization";

const columnAliases: Record<keyof ColumnMapping, string[]> = {
  product_name: ["product name", "name", "title", "product", "item name"],
  sku: ["sku", "internal reference", "code", "item code", "variant sku"],
  variation: [
    "variation values",
    "variation",
    "attribute value",
    "attribute values",
    "variant",
    "attribute",
    "option",
    "variant name"
  ],
  color: ["color", "colour"],
  size: ["size"],
  image_url: ["image url", "image", "external image url", "image link"],
  parent_sku: ["parent sku", "parent", "parent code", "parent reference"]
};

function stringifyCell(value: unknown) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return normalizeWhitespace(value);
  }

  return normalizeWhitespace(String(value));
}

function scoreHeaderRow(values: unknown[]) {
  const rowText = values.map(stringifyCell).filter(Boolean);
  if (!rowText.length) {
    return -1;
  }

  return rowText.reduce((score, header) => {
    const normalizedHeader = header.toLowerCase();
    const aliasMatch = Object.values(columnAliases).some((aliases) =>
      aliases.some(
        (alias) =>
          normalizedHeader === alias || normalizedHeader.includes(alias)
      )
    );

    return (
      score +
      (aliasMatch ? 2 : 0) +
      (/\b(name|sku|image|product)\b/.test(normalizedHeader) ? 1 : 0)
    );
  }, 0);
}

function detectHeaderRow(rows: unknown[][]) {
  let bestIndex = 0;
  let bestScore = -1;

  rows.forEach((row, index) => {
    const score = scoreHeaderRow(row);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function getMappedValue(
  source: Record<string, unknown>,
  header: string | null
) {
  if (!header) {
    return null;
  }

  const value = source[header];
  const stringValue = stringifyCell(value);
  return stringValue || null;
}

function getPreferredVariationValue(
  source: Record<string, unknown>,
  columnMapping: ColumnMapping
) {
  const preferredHeaders = [
    "Variation Values",
    "Attribute Values",
    columnMapping.variation
  ].filter(Boolean) as string[];

  for (const header of preferredHeaders) {
    const value = getMappedValue(source, header);
    if (value) {
      return value;
    }
  }

  return null;
}

export function detectColumnMapping(headers: string[]): ColumnMapping {
  const normalizedHeaders = headers.map((header) => header.toLowerCase());
  const findHeader = (aliases: string[]) => {
    const matchIndex = normalizedHeaders.findIndex((header) =>
      aliases.some((alias) => header === alias || header.includes(alias))
    );

    return matchIndex >= 0 ? headers[matchIndex] : null;
  };

  return {
    product_name: findHeader(columnAliases.product_name),
    sku: findHeader(columnAliases.sku),
    variation: findHeader(columnAliases.variation),
    color: findHeader(columnAliases.color),
    size: findHeader(columnAliases.size),
    image_url: findHeader(columnAliases.image_url),
    parent_sku: findHeader(columnAliases.parent_sku)
  };
}

export function parseSpreadsheetBuffer(
  buffer: Buffer,
  filename: string
): ParsedSpreadsheet {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];

  if (!firstSheet) {
    throw new Error(`Spreadsheet "${filename}" does not contain a readable sheet.`);
  }

  const allRows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
    header: 1,
    blankrows: false,
    raw: false
  });

  if (!allRows.length) {
    throw new Error("Spreadsheet is empty.");
  }

  const headerRowIndex = detectHeaderRow(allRows);
  const headers = (allRows[headerRowIndex] ?? []).map((value) => stringifyCell(value));
  const columnMapping = detectColumnMapping(headers);

  if (!columnMapping.product_name && !columnMapping.sku) {
    throw new Error(
      "Spreadsheet must include at least a product name or SKU column."
    );
  }

  const rows: ParsedSheetRow[] = [];

  for (let index = headerRowIndex + 1; index < allRows.length; index += 1) {
    const values = allRows[index] ?? [];
    const raw_json = headers.reduce<Record<string, unknown>>(
      (accumulator, header, headerIndex) => {
        accumulator[header] = stringifyCell(values[headerIndex]);
        return accumulator;
      },
      {}
    );

    const hasContent = Object.values(raw_json).some(
      (value) => String(value ?? "").trim().length > 0
    );

    if (!hasContent) {
      continue;
    }

    const variation = getPreferredVariationValue(raw_json, columnMapping);
    const color = getMappedValue(raw_json, columnMapping.color);
    const size = getMappedValue(raw_json, columnMapping.size);

    rows.push({
      row_index: index + 1,
      product_name: getMappedValue(raw_json, columnMapping.product_name),
      sku: getMappedValue(raw_json, columnMapping.sku),
      variation: variation || [color, size].filter(Boolean).join(" / ") || null,
      color,
      size,
      image_url: getMappedValue(raw_json, columnMapping.image_url),
      parent_sku: getMappedValue(raw_json, columnMapping.parent_sku),
      raw_json,
      status: "pending"
    });
  }

  return {
    headers,
    totalRows: rows.length,
    rows,
    columnMapping
  };
}
