import type { ExtractedImageRecord } from "@/types/database";

import { getStem, tokenizeForMatching } from "@/lib/utils/normalization";

const TOKEN_ALIASES: Record<string, string> = {
  controller: "rc",
  remote: "rc",
  remotes: "rc",
  grey: "gray",
  greyed: "gray",
  w: "with",
  kit: "combo",
  package: "combo",
  pack: "combo",
  premiumcombo: "premium",
  rcn1: "rcn1",
  "rc-n1": "rcn1",
  "rc-n2": "rcn2",
  combo: "combo"
};

const IMAGE_NOISE_TOKENS = new Set([
  "image",
  "img",
  "photo",
  "hero",
  "main",
  "front",
  "back",
  "side",
  "copy",
  "edited",
  "final"
]);

function canonicalizeToken(token: string) {
  const compact = token.replace(/[^a-z0-9]/g, "");
  return TOKEN_ALIASES[compact] ?? compact;
}

function uniqueTokens(tokens: string[]) {
  return [...new Set(tokens.filter(Boolean))];
}

function semanticTokensFromText(value: string | null | undefined) {
  return uniqueTokens(
    tokenizeForMatching(value)
      .map(canonicalizeToken)
      .filter((token) => token && !IMAGE_NOISE_TOKENS.has(token))
  );
}

function diceCoefficient(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  if (!leftSet.size || !rightSet.size) {
    return 0;
  }

  const overlap = [...leftSet].filter((token) => rightSet.has(token));
  return (2 * overlap.length) / (leftSet.size + rightSet.size);
}

export function splitVariationValues(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function productSemanticSimilarity(
  image: ExtractedImageRecord,
  productName: string | null | undefined
) {
  const productTokens = semanticTokensFromText(productName);
  const imageTokens = semanticTokensFromText(
    `${image.inferred_product ?? ""} ${image.relative_path} ${image.original_name}`
  );

  return diceCoefficient(productTokens, imageTokens);
}

export function extractSemanticVariationTokens(
  image: ExtractedImageRecord,
  productName: string | null | undefined
) {
  const productTokens = new Set(semanticTokensFromText(productName));
  const fileStem = getStem(image.original_name);
  const source = `${image.inferred_variation ?? ""} ${fileStem} ${image.relative_path}`;

  return semanticTokensFromText(source).filter((token) => !productTokens.has(token));
}

export function semanticVariationSimilarity(
  image: ExtractedImageRecord,
  productName: string | null | undefined,
  variationValue: string
) {
  const imageTokens = extractSemanticVariationTokens(image, productName);
  const variationTokens = semanticTokensFromText(variationValue);

  return diceCoefficient(imageTokens, variationTokens);
}

export function isVariationTiedToRow(
  image: ExtractedImageRecord,
  productName: string | null | undefined,
  variationValues: string[]
) {
  return variationValues.some(
    (variationValue) =>
      semanticVariationSimilarity(image, productName, variationValue) >= 0.8
  );
}
