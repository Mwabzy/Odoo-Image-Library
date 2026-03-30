const GENERIC_IMAGE_TOKENS = new Set([
  "front",
  "back",
  "side",
  "hero",
  "main",
  "image",
  "img",
  "photo",
  "shot",
  "primary",
  "secondary",
  "gallery",
  "final",
  "edit",
  "edited"
]);

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeText(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return normalizeWhitespace(
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[_./\\-]+/g, " ")
      .replace(/[^\w\s]/g, " ")
  );
}

export function normalizeIdentifier(value: string | null | undefined) {
  return normalizeText(value).replace(/\s+/g, "");
}

export function titleFromSlug(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = normalizeWhitespace(
    value
      .replace(/[_./\\-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );

  if (!normalized) {
    return null;
  }

  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function sanitizePath(value: string) {
  return value
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\.\./g, "")
    .trim();
}

export function getStem(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

export function tokenizeForMatching(value: string | null | undefined) {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !GENERIC_IMAGE_TOKENS.has(token));
}

export function inferSkuFromText(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const rawTokens = value
    .split(/[^A-Za-z0-9-]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const candidate = rawTokens.find((token) =>
    /^[A-Za-z]{0,4}\d{2,}[A-Za-z0-9-]*$/.test(token)
  );

  return candidate ?? null;
}

export function buildProductVariationKey(
  productName: string | null | undefined,
  variation: string | null | undefined
) {
  return `${normalizeIdentifier(productName)}::${normalizeIdentifier(variation)}`;
}

export function uniqueBy<T>(
  values: T[],
  getKey: (value: T) => string
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const value of values) {
    const key = getKey(value);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
}
