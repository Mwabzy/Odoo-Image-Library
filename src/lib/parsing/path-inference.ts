import type { PathMode } from "@/types/domain";

import {
  getStem,
  inferSkuFromText,
  sanitizePath,
  titleFromSlug,
  tokenizeForMatching
} from "@/lib/utils/normalization";

const GENERIC_WRAPPER_FOLDERS = new Set([
  "images",
  "image",
  "photos",
  "photo",
  "pictures",
  "picture",
  "downloads",
  "download",
  "uploads",
  "upload",
  "assets",
  "asset",
  "product-images",
  "product-image",
  "library",
  "media",
  "drone-test",
  "drone test",
  "new-folder",
  "new folder"
]);

const VARIATION_SUFFIX_PHRASES = [
  ["cine", "premium", "combo"],
  ["premium", "combo"],
  ["space", "grey"],
  ["space", "gray"],
  ["with", "controller"],
  ["with", "rc", "n1"],
  ["with", "rc", "n2"],
  ["with", "rcn1"],
  ["with", "rcn2"],
  ["with", "rc"],
  ["drone", "only"],
  ["rc", "n1"],
  ["rc", "n2"],
  ["starter", "bundle"],
  ["fly", "more", "combo"]
] as const;

const SINGLE_TOKEN_VARIATION_SUFFIXES = new Set([
  "combo",
  "bundle",
  "controller",
  "rc",
  "rcn1",
  "rcn2",
  "black",
  "white",
  "orange",
  "red",
  "blue",
  "green",
  "gray",
  "grey",
  "silver"
]);

function buildNormalizedPath(relativePath: string) {
  return sanitizePath(relativePath)
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function isGenericWrapperFolder(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .trim();

  return (
    GENERIC_WRAPPER_FOLDERS.has(normalized) ||
    /^folder\s*\d*$/i.test(normalized) ||
    /^test\s*\d*$/i.test(normalized)
  );
}

function getMeaningfulDirectories(directories: string[]) {
  return directories.filter((directory) => !isGenericWrapperFolder(directory));
}

function endsWithPhrase(tokens: string[], phrase: readonly string[]) {
  if (phrase.length > tokens.length) {
    return false;
  }

  const offset = tokens.length - phrase.length;
  return phrase.every((part, index) => tokens[offset + index] === part);
}

function findVariationSuffixStart(tokens: string[]) {
  for (const phrase of VARIATION_SUFFIX_PHRASES) {
    if (endsWithPhrase(tokens, phrase) && tokens.length > phrase.length) {
      return tokens.length - phrase.length;
    }
  }

  const withIndex = tokens.lastIndexOf("with");
  if (withIndex >= 2 && tokens.length - withIndex <= 3) {
    return withIndex;
  }

  const lastToken = tokens.at(-1);
  if (lastToken && SINGLE_TOKEN_VARIATION_SUFFIXES.has(lastToken) && tokens.length >= 3) {
    return tokens.length - 1;
  }

  return -1;
}

function splitStemProductAndVariation(stem: string) {
  const tokens = tokenizeForMatching(stem);
  if (!tokens.length) {
    return {
      inferredProduct: null,
      inferredVariation: null
    };
  }

  const variationStart = findVariationSuffixStart(tokens);
  if (variationStart >= 2) {
    return {
      inferredProduct: titleFromSlug(tokens.slice(0, variationStart).join(" ")),
      inferredVariation: titleFromSlug(tokens.slice(variationStart).join(" "))
    };
  }

  return {
    inferredProduct: titleFromSlug(tokens.join(" ")),
    inferredVariation: null
  };
}

function inferVariationFromStem(stem: string, product: string | null) {
  const tokens = tokenizeForMatching(stem);
  const productTokens = new Set(tokenizeForMatching(product));
  const variationTokens = tokens.filter((token) => !productTokens.has(token));

  if (!variationTokens.length) {
    return null;
  }

  return titleFromSlug(variationTokens.join(" "));
}

export function inferImageMetadataFromPath(
  relativePath: string,
  pathMode: PathMode
) {
  const safeRelativePath = sanitizePath(relativePath);
  const parts = safeRelativePath.split("/").filter(Boolean);
  const fileName = parts.at(-1) ?? relativePath;
  const stem = getStem(fileName);
  const directories = parts.slice(0, -1);
  const meaningfulDirectories = getMeaningfulDirectories(directories);

  let inferredProduct: string | null = null;
  let inferredVariation: string | null = null;

  if (pathMode === "folder-product-only") {
    inferredProduct = titleFromSlug(meaningfulDirectories.at(-1) ?? stem);
  } else if (pathMode === "folder-product-variation") {
    inferredProduct = titleFromSlug(
      meaningfulDirectories.at(-2) ?? meaningfulDirectories.at(-1) ?? stem
    );
    inferredVariation =
      meaningfulDirectories.length >= 2
        ? titleFromSlug(meaningfulDirectories.at(-1))
        : inferVariationFromStem(stem, inferredProduct);
  } else if (meaningfulDirectories.length >= 2) {
    inferredProduct = titleFromSlug(meaningfulDirectories.at(-2));
    inferredVariation = titleFromSlug(meaningfulDirectories.at(-1));
  } else if (meaningfulDirectories.length === 1) {
    inferredProduct = titleFromSlug(meaningfulDirectories[0]);
    inferredVariation = inferVariationFromStem(stem, inferredProduct);
  } else {
    const inferredFromStem = splitStemProductAndVariation(stem);
    inferredProduct = inferredFromStem.inferredProduct;
    inferredVariation = inferredFromStem.inferredVariation;
  }

  return {
    normalizedPath: buildNormalizedPath(safeRelativePath),
    inferredProduct,
    inferredVariation,
    inferredSku: inferSkuFromText(`${directories.join(" ")} ${stem}`)
  };
}
