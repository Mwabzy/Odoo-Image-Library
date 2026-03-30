import type { ExtractedImageRecord } from "@/types/database";

import { normalizeWhitespace, uniqueBy } from "@/lib/utils/normalization";

const IMAGE_FILE_EXTENSION_PATTERN =
  /\.(?:avif|bmp|gif|heic|heif|jpeg|jpg|png|svg|tif|tiff|webp)$/i;

const NAME_NOISE_TOKENS = new Set([
  "image",
  "img",
  "photo",
  "hero",
  "main",
  "front",
  "back",
  "side",
  "copy",
  "final",
  "edited"
]);

const MATCH_THRESHOLD = 0.85;
const POSSIBLE_MATCH_THRESHOLD = 0.6;

type PreparedMatchText = {
  normalized: string;
  compact: string;
  tokens: string[];
  tokenSet: Set<string>;
  bigrams: string[];
};

export type MatchType = "exact" | "fuzzy" | "none";

export type NameMatchResult = {
  matched: boolean;
  confidence: number;
  matchType: MatchType;
  normalizedImageName: string;
  normalizedProductName: string;
};

export type ProductListMatch = NameMatchResult & {
  productName: string;
};

export type ProductListMatchResult = {
  bestMatch: ProductListMatch | null;
  matches: ProductListMatch[];
};

function clampScore(value: number) {
  return Number(Math.max(0, Math.min(1, value)).toFixed(2));
}

function stripImageExtension(value: string) {
  return value.replace(IMAGE_FILE_EXTENSION_PATTERN, "");
}

function buildCharacterBigrams(value: string) {
  if (!value) {
    return [];
  }

  if (value.length === 1) {
    return [value];
  }

  const result: string[] = [];

  for (let index = 0; index < value.length - 1; index += 1) {
    result.push(value.slice(index, index + 2));
  }

  return result;
}

function prepareMatchText(value: string | null | undefined): PreparedMatchText {
  const normalized = normalizeMatchName(value);
  const tokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !NAME_NOISE_TOKENS.has(token));
  const compact = normalized.replace(/\s+/g, "");

  return {
    normalized,
    compact,
    tokens,
    tokenSet: new Set(tokens),
    bigrams: buildCharacterBigrams(compact)
  };
}

function multisetDiceCoefficient(left: string[], right: string[]) {
  if (!left.length || !right.length) {
    return 0;
  }

  const counts = new Map<string, number>();

  for (const token of left) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  let overlap = 0;

  for (const token of right) {
    const count = counts.get(token) ?? 0;

    if (!count) {
      continue;
    }

    counts.set(token, count - 1);
    overlap += 1;
  }

  return (2 * overlap) / (left.length + right.length);
}

function tokenOverlapSimilarity(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) {
    return 0;
  }

  const intersection = [...left].filter((token) => right.has(token)).length;
  if (!intersection) {
    return 0;
  }

  const precision = intersection / left.size;
  const recall = intersection / right.size;
  const f1 = (2 * precision * recall) / (precision + recall);
  const union = new Set([...left, ...right]).size;
  const jaccard = intersection / union;

  return 0.55 * f1 + 0.45 * jaccard;
}

function comparePreparedTexts(
  image: PreparedMatchText,
  product: PreparedMatchText
): NameMatchResult {
  if (!image.normalized || !product.normalized) {
    return {
      matched: false,
      confidence: 0,
      matchType: "none",
      normalizedImageName: image.normalized,
      normalizedProductName: product.normalized
    };
  }

  if (image.normalized === product.normalized) {
    return {
      matched: true,
      confidence: 1,
      matchType: "exact",
      normalizedImageName: image.normalized,
      normalizedProductName: product.normalized
    };
  }

  // Character-level similarity catches reordered punctuation and minor typos.
  const characterSimilarity = multisetDiceCoefficient(image.bigrams, product.bigrams);

  // Token overlap keeps the score resilient when spacing or separators differ.
  const tokenSimilarity = tokenOverlapSimilarity(image.tokenSet, product.tokenSet);
  const sharedTokenCount = [...image.tokenSet].filter((token) =>
    product.tokenSet.has(token)
  ).length;
  const fullTokenCoverage =
    sharedTokenCount > 0 &&
    (sharedTokenCount === image.tokenSet.size || sharedTokenCount === product.tokenSet.size);
  const containsOther =
    image.compact.includes(product.compact) || product.compact.includes(image.compact);

  let confidence = 0.58 * characterSimilarity + 0.42 * tokenSimilarity;

  if (containsOther) {
    confidence += 0.03;
  }

  if (fullTokenCoverage) {
    confidence += 0.02;
  }

  const finalConfidence = clampScore(confidence);

  return {
    matched: finalConfidence >= MATCH_THRESHOLD,
    confidence: finalConfidence,
    matchType:
      finalConfidence >= POSSIBLE_MATCH_THRESHOLD ? "fuzzy" : "none",
    normalizedImageName: image.normalized,
    normalizedProductName: product.normalized
  };
}

function bestMatchFromCandidates(
  candidates: Array<string | null | undefined>,
  productName: string | null | undefined
) {
  const preparedProduct = prepareMatchText(productName);
  const preparedCandidates = uniqueBy(
    candidates.map((candidate) => String(candidate ?? "")),
    (candidate) => normalizeMatchName(candidate)
  )
    .map((candidate) => prepareMatchText(candidate))
    .filter((candidate) => candidate.normalized);

  if (!preparedCandidates.length) {
    return comparePreparedTexts(prepareMatchText(""), preparedProduct);
  }

  return preparedCandidates.reduce<NameMatchResult>((best, candidate) => {
    const current = comparePreparedTexts(candidate, preparedProduct);
    return current.confidence > best.confidence ? current : best;
  }, comparePreparedTexts(prepareMatchText(""), preparedProduct));
}

export function normalizeMatchName(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return normalizeWhitespace(
    stripImageExtension(value)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[_-]+/g, " ")
      .replace(/[./\\]+/g, " ")
      .replace(/[^a-z0-9\s]+/g, " ")
  );
}

export function matchProductName(
  imageName: string | null | undefined,
  productName: string | null | undefined
) {
  return comparePreparedTexts(
    prepareMatchText(imageName),
    prepareMatchText(productName)
  );
}

export function findBestProductMatch(
  imageName: string | null | undefined,
  products: string[]
): ProductListMatchResult {
  const matches = products
    .filter(Boolean)
    .map((productName) => ({
      productName,
      ...matchProductName(imageName, productName)
    }))
    .sort((left, right) => right.confidence - left.confidence);

  return {
    bestMatch: matches[0] ?? null,
    matches
  };
}

export function scoreImageProductName(
  image: Pick<ExtractedImageRecord, "original_name" | "relative_path" | "inferred_product">,
  productName: string | null | undefined
) {
  return bestMatchFromCandidates(
    [image.original_name, image.relative_path, image.inferred_product],
    productName
  );
}

export function scoreImageVariationName(
  image: Pick<ExtractedImageRecord, "original_name" | "relative_path" | "inferred_variation">,
  variationName: string | null | undefined
) {
  return bestMatchFromCandidates(
    [image.inferred_variation, image.original_name, image.relative_path],
    variationName
  );
}
