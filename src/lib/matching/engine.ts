import type { MatchCandidate, MatchStatus } from "@/types/domain";
import type { ExtractedImageRecord, SheetRowRecord } from "@/types/database";

import {
  scoreImageProductName,
  scoreImageVariationName
} from "@/lib/matching/name-matcher";
import {
  productSemanticSimilarity,
  semanticVariationSimilarity,
  splitVariationValues
} from "@/lib/matching/semantic";
import {
  buildProductVariationKey,
  normalizeIdentifier,
  uniqueBy
} from "@/lib/utils/normalization";

type MatchReason =
  | "sku_exact"
  | "product_variation_exact"
  | "product_variation_semantic"
  | "product_exact"
  | "product_fuzzy"
  | "duplicate_exact"
  | "no_match";

const SEMANTIC_VARIATION_MIN = 0.8;
const SEMANTIC_PRODUCT_MIN = 0.72;
const SEMANTIC_AUTO_ACCEPT = 0.85;
const SEMANTIC_SEPARATION_MIN = 0.03;
const FUZZY_MATCH_MIN = 0.85;
const POSSIBLE_MATCH_MIN = 0.6;
const FUZZY_SEPARATION_MIN = 0.03;

type SemanticCandidate = {
  image: ExtractedImageRecord;
  score: number;
  productScore: number;
  variationScore: number;
};

function candidateStatusFromFuzzy(score: number): MatchStatus {
  if (score >= FUZZY_MATCH_MIN) {
    return "matched";
  }

  if (score >= POSSIBLE_MATCH_MIN) {
    return "needs_review";
  }

  return "unmatched";
}

function getBestVariationScore(row: SheetRowRecord, image: ExtractedImageRecord) {
  const variationValues = getRowVariationValues(row);
  if (!variationValues.length) {
    return null;
  }

  return variationValues.reduce(
    (bestScore, variationValue) =>
      Math.max(bestScore, scoreImageVariationName(image, variationValue).confidence),
    0
  );
}

function fuzzyScore(row: SheetRowRecord, image: ExtractedImageRecord) {
  const productScore = scoreImageProductName(image, row.product_name).confidence;
  const variationScore = getBestVariationScore(row, image);

  if (variationScore === null) {
    return Number(productScore.toFixed(2));
  }

  const combinedScore = productScore * 0.85 + variationScore * 0.15;
  return Number(Math.min(0.99, combinedScore).toFixed(2));
}

function getRowVariationValues(row: SheetRowRecord) {
  const rawVariationValues =
    typeof row.raw_json["Variation Values"] === "string"
      ? row.raw_json["Variation Values"]
      : row.variation;

  return splitVariationValues(rawVariationValues);
}

function exactProductVariationCandidates(
  row: SheetRowRecord,
  productVariationMap: Map<string, ExtractedImageRecord[]>
) {
  const variationValues = getRowVariationValues(row);
  if (!variationValues.length) {
    return [];
  }

  return uniqueBy(
    variationValues.flatMap(
      (variationValue) =>
        productVariationMap.get(
          buildProductVariationKey(row.product_name, variationValue)
        ) ?? []
    ),
    (image) => image.id
  );
}

function semanticVariationScore(
  row: SheetRowRecord,
  image: ExtractedImageRecord
): SemanticCandidate | null {
  const variationValues = getRowVariationValues(row);
  if (!variationValues.length) {
    return null;
  }

  const productScore = productSemanticSimilarity(image, row.product_name);
  if (productScore < SEMANTIC_PRODUCT_MIN) {
    return null;
  }

  const variationScore = variationValues.reduce(
    (bestScore, variationValue) =>
      Math.max(
        bestScore,
        semanticVariationSimilarity(image, row.product_name, variationValue)
      ),
    0
  );

  if (variationScore < SEMANTIC_VARIATION_MIN) {
    return null;
  }

  const score = Number(
    Math.min(
      0.95,
      0.82 +
        Math.max(0, variationScore - SEMANTIC_VARIATION_MIN) * 0.4 +
        Math.max(0, productScore - SEMANTIC_PRODUCT_MIN) * 0.25
    ).toFixed(2)
  );

  return {
    image,
    score,
    productScore,
    variationScore
  };
}

function resolveSemanticVariationMatch(
  row: SheetRowRecord,
  images: ExtractedImageRecord[]
) {
  const candidates = images
    .map((image) => semanticVariationScore(row, image))
    .filter((candidate): candidate is SemanticCandidate => candidate !== null)
    .sort((left, right) => right.score - left.score);

  const bestCandidate = candidates[0];
  if (!bestCandidate) {
    return null;
  }

  const secondCandidate = candidates[1];
  const separated =
    !secondCandidate || bestCandidate.score - secondCandidate.score >= SEMANTIC_SEPARATION_MIN;
  const autoAccepted = bestCandidate.score >= SEMANTIC_AUTO_ACCEPT && separated;
  const status: MatchStatus = autoAccepted ? "matched" : "needs_review";

  return {
    sheetRowId: row.id,
    imageId: bestCandidate.image.id,
    confidenceScore: bestCandidate.score,
    matchReason: "product_variation_semantic" as const,
    matchedBy: autoAccepted
      ? "engine.semantic_unique"
      : "engine.semantic_review",
    status,
    isManual: false
  };
}

function resolveUniqueOrConflict(
  sheetRowId: string,
  candidates: ExtractedImageRecord[],
  score: number,
  reason: MatchReason
): MatchCandidate {
  if (candidates.length === 1) {
    return {
      sheetRowId,
      imageId: candidates[0].id,
      confidenceScore: score,
      matchReason: reason,
      matchedBy: `engine.${reason}`,
      status: "matched",
      isManual: false
    };
  }

  return {
    sheetRowId,
    imageId: null,
    confidenceScore: score,
    matchReason: "duplicate_exact",
    matchedBy: `engine.${reason}`,
    status: "duplicate_conflict",
    isManual: false
  };
}

function resolveRowMatch(
  row: SheetRowRecord,
  images: ExtractedImageRecord[],
  skuMap: Map<string, ExtractedImageRecord[]>,
  productVariationMap: Map<string, ExtractedImageRecord[]>,
  productMap: Map<string, ExtractedImageRecord[]>
): MatchCandidate {
  const skuKey = normalizeIdentifier(row.sku || row.parent_sku);
  const productVariationKey = buildProductVariationKey(
    row.product_name,
    row.variation
  );
  const productKey = normalizeIdentifier(row.product_name);

  if (skuKey && skuMap.has(skuKey)) {
    return resolveUniqueOrConflict(row.id, skuMap.get(skuKey) ?? [], 1, "sku_exact");
  }

  const exactVariationCandidates = [
    ...(productVariationKey !== "::"
      ? productVariationMap.get(productVariationKey) ?? []
      : []),
    ...exactProductVariationCandidates(row, productVariationMap)
  ];

  const uniqueExactVariationCandidates = uniqueBy(
    exactVariationCandidates,
    (image) => image.id
  );

  if (uniqueExactVariationCandidates.length) {
    return resolveUniqueOrConflict(
      row.id,
      uniqueExactVariationCandidates,
      0.96,
      "product_variation_exact"
    );
  }

  const semanticVariationMatch = resolveSemanticVariationMatch(row, images);
  if (semanticVariationMatch) {
    return semanticVariationMatch;
  }

  if (productKey && productMap.has(productKey)) {
    return resolveUniqueOrConflict(
      row.id,
      productMap.get(productKey) ?? [],
      0.92,
      "product_exact"
    );
  }

  const fuzzyCandidates = images
    .map((image) => ({
      image,
      score: fuzzyScore(row, image)
    }))
    .filter((candidate) => candidate.score >= POSSIBLE_MATCH_MIN)
    .sort((left, right) => right.score - left.score);

  const bestCandidate = fuzzyCandidates[0];
  const secondCandidate = fuzzyCandidates[1];

  if (!bestCandidate) {
    return {
      sheetRowId: row.id,
      imageId: null,
      confidenceScore: 0,
      matchReason: "no_match",
      matchedBy: "engine.none",
      status: "unmatched",
      isManual: false
    };
  }

  const status = candidateStatusFromFuzzy(bestCandidate.score);
  const separated =
    !secondCandidate || bestCandidate.score - secondCandidate.score >= FUZZY_SEPARATION_MIN;
  const autoAccepted = status === "matched" && separated;

  return {
    sheetRowId: row.id,
    imageId: bestCandidate.image.id,
    confidenceScore: bestCandidate.score,
    matchReason: "product_fuzzy",
    matchedBy:
      autoAccepted ? "engine.fuzzy_unique" : "engine.fuzzy_review",
    status: autoAccepted ? "matched" : "needs_review",
    isManual: false
  };
}

export function runDeterministicMatcher(args: {
  sheetRows: SheetRowRecord[];
  extractedImages: ExtractedImageRecord[];
}) {
  const skuMap = new Map<string, ExtractedImageRecord[]>();
  const productMap = new Map<string, ExtractedImageRecord[]>();
  const productVariationMap = new Map<string, ExtractedImageRecord[]>();

  for (const image of args.extractedImages) {
    const skuKey = normalizeIdentifier(image.inferred_sku);
    const productKey = normalizeIdentifier(image.inferred_product);
    const productVariationKey = buildProductVariationKey(
      image.inferred_product,
      image.inferred_variation
    );

    if (skuKey) {
      skuMap.set(skuKey, [...(skuMap.get(skuKey) ?? []), image]);
    }

    if (productKey) {
      productMap.set(productKey, [...(productMap.get(productKey) ?? []), image]);
    }

    if (productVariationKey !== "::") {
      productVariationMap.set(productVariationKey, [
        ...(productVariationMap.get(productVariationKey) ?? []),
        image
      ]);
    }
  }

  const decisions = args.sheetRows.map((row) =>
    resolveRowMatch(row, args.extractedImages, skuMap, productVariationMap, productMap)
  );

  const groupedByImage = new Map<string, MatchCandidate[]>();
  for (const decision of decisions) {
    if (!decision.imageId || decision.status !== "matched") {
      continue;
    }

    groupedByImage.set(decision.imageId, [
      ...(groupedByImage.get(decision.imageId) ?? []),
      decision
    ]);
  }

  for (const group of groupedByImage.values()) {
    if (group.length < 2) {
      continue;
    }

    for (const decision of group) {
      decision.status = "duplicate_conflict";
      decision.matchReason = "duplicate_exact";
      decision.matchedBy = "engine.duplicate_conflict";
      decision.confidenceScore = Number(
        Math.max(0.85, decision.confidenceScore).toFixed(2)
      );
    }
  }

  return decisions;
}

export function summarizeDecisions(
  decisions: MatchCandidate[],
  totalRows: number,
  totalImages: number
) {
  const matched = decisions.filter((item) => item.status === "matched").length;
  const needsReview = decisions.filter(
    (item) => item.status === "needs_review" || item.status === "duplicate_conflict"
  ).length;
  const unmatched = Math.max(0, totalRows - matched - needsReview);

  return {
    totalRows,
    totalImages,
    matched,
    needsReview,
    unmatched
  };
}
