"use client";

import Link from "next/link";
import { ExternalLink, LoaderCircle, RefreshCcw, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ApproveSuggestionButton } from "@/components/matches/approve-suggestion-button";
import {
  MatchConfidenceBadge,
  MatchDecisionBadge,
  isQuickApproveCandidate
} from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import type { ExtractedImageRecord, SheetRowRecord } from "@/types/database";
import type { MatchReviewItem } from "@/types/domain";

type MatchFilter = "all" | "matched" | "unmatched" | "needs_review" | "duplicate_conflict";

function formatMatchReason(reason: string | null) {
  if (!reason) {
    return "No match reason yet";
  }

  const labels: Record<string, string> = {
    sku_exact: "Matched by SKU",
    product_variation_exact: "Exact product and variation match",
    product_variation_semantic: "Strong product and variation suggestion",
    product_exact: "Exact product name match",
    product_fuzzy: "Filename similarity match",
    duplicate_exact: "Conflicts with another row",
    no_match: "No strong image match found",
    manual_override: "Approved manually"
  };

  return labels[reason] ?? reason.replace(/_/g, " ");
}

type ApiPayload = {
  error?: string;
};

async function readPayload(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await response.json()) as ApiPayload;
  }

  const text = await response.text();
  return {
    error: text || "Failed to assign the selected image."
  } satisfies ApiPayload;
}

export function MatchReviewTable({
  sessionId,
  items,
  sheetRows,
  images
}: {
  sessionId: string;
  items: MatchReviewItem[];
  sheetRows: SheetRowRecord[];
  images: ExtractedImageRecord[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<MatchFilter>("all");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [selectedImageIds, setSelectedImageIds] = useState<Record<string, string>>({});

  const sheetRowMap = useMemo(
    () => new Map(sheetRows.map((row) => [row.id, row])),
    [sheetRows]
  );
  const imageMap = useMemo(
    () => new Map(images.map((image) => [image.id, image])),
    [images]
  );
  const imageOptions = useMemo(
    () =>
      [...images].sort((left, right) =>
        left.original_name.localeCompare(right.original_name)
      ),
    [images]
  );

  const visibleItems = useMemo(() => {
    if (filter === "all") {
      return items;
    }

    return items.filter((item) => item.status === filter);
  }, [filter, items]);

  async function handleAssign(sheetRowId: string) {
    const imageId = selectedImageIds[sheetRowId];

    if (!imageId) {
      setErrorMessage("Choose an image first, then save the assignment.");
      return;
    }

    setPendingAction(`assign:${sheetRowId}`);

    try {
      const response = await fetch(`/api/session/${sessionId}/override`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sheetRowId,
          imageId
        })
      });
      const payload = await readPayload(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to assign the selected image.");
      }

      setErrorMessage(null);
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to assign the selected image."
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function handleRematch() {
    setPendingAction("rematch");

    try {
      const response = await fetch(`/api/session/${sessionId}/rematch`, {
        method: "POST"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to rerun matching.");
      }

      setErrorMessage(null);
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to rerun matching."
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <CardTitle className="text-2xl">Match review</CardTitle>
          <CardDescription>
            Check the suggested image, confidence score, and decision for each row.
            Approve the suggestion or pick a different image, then export the
            updated spreadsheet from this session.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-3">
          <Select
            className="min-w-52"
            value={filter}
            onChange={(event) => setFilter(event.target.value as MatchFilter)}
          >
            <option value="all">All statuses</option>
            <option value="matched">Matched</option>
            <option value="unmatched">Unmatched</option>
            <option value="needs_review">Suggested / review</option>
            <option value="duplicate_conflict">Conflicts</option>
          </Select>
          <Button
            variant="outline"
            onClick={handleRematch}
            disabled={Boolean(pendingAction)}
            isLoading={pendingAction === "rematch"}
          >
            {pendingAction === "rematch" ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4" />
            )}
            {pendingAction === "rematch" ? "Refreshing..." : "Rerun matching"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {errorMessage ? (
          <div className="rounded-[1.25rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Row</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Variation</TableHead>
              <TableHead>Suggested image</TableHead>
              <TableHead>Relative path</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Final URL</TableHead>
              <TableHead>Decision</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleItems.length ? (
              visibleItems.map((item) => {
                const sheetRow = sheetRowMap.get(item.sheetRowId);
                const image = item.imageId ? imageMap.get(item.imageId) : null;
                const quickApprove = isQuickApproveCandidate({
                  imageId: item.imageId,
                  status: item.status,
                  confidenceScore: item.confidenceScore
                });
                const selectedImageId =
                  selectedImageIds[item.sheetRowId] ?? item.imageId ?? "";
                const isAssigning = pendingAction === `assign:${item.sheetRowId}`;
                const displayProductName =
                  item.productName ??
                  sheetRow?.product_name ??
                  "Unnamed product";
                const displaySku =
                  item.sku ??
                  sheetRow?.sku ??
                  "No SKU";
                const displayVariation =
                  item.variation ??
                  sheetRow?.variation ??
                  "No variation";
                const displayFilename =
                  item.matchedFilename ??
                  image?.original_name ??
                  "No suggestion yet";
                const displayRelativePath =
                  item.relativePath ??
                  image?.relative_path ??
                  "No path yet";
                const displayRowIndex =
                  item.rowIndex ||
                  sheetRow?.row_index ||
                  0;

                return (
                  <TableRow key={item.sheetRowId}>
                    <TableCell>{displayRowIndex}</TableCell>
                    <TableCell className="font-medium">
                      {displayProductName}
                    </TableCell>
                    <TableCell>{displaySku}</TableCell>
                    <TableCell>{displayVariation}</TableCell>
                    <TableCell>{displayFilename}</TableCell>
                    <TableCell>{displayRelativePath}</TableCell>
                    <TableCell>
                      <MatchConfidenceBadge confidenceScore={item.confidenceScore} />
                    </TableCell>
                    <TableCell>{formatMatchReason(item.matchReason)}</TableCell>
                    <TableCell>
                      {item.finalImageUrl ? (
                        <a
                          href={item.finalImageUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                        >
                          Open
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        "Not assigned yet"
                      )}
                    </TableCell>
                    <TableCell>
                      <MatchDecisionBadge
                        status={item.status}
                        confidenceScore={item.confidenceScore}
                        isManual={item.isManual}
                      />
                    </TableCell>
                    <TableCell className="min-w-[24rem]">
                      <div className="flex flex-wrap items-center gap-2">
                        {quickApprove && item.imageId ? (
                          <ApproveSuggestionButton
                            sessionId={sessionId}
                            sheetRowId={item.sheetRowId}
                            imageId={item.imageId}
                            label="Approve"
                            onError={setErrorMessage}
                          />
                        ) : null}
                        <Select
                          className="min-w-52 flex-1"
                          value={selectedImageId}
                          onChange={(event) => {
                            setSelectedImageIds((current) => ({
                              ...current,
                              [item.sheetRowId]: event.target.value
                            }));
                          }}
                        >
                          <option value="">Select image</option>
                          {imageOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.original_name}
                            </option>
                          ))}
                        </Select>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void handleAssign(item.sheetRowId)}
                          disabled={!selectedImageId}
                          isLoading={isAssigning}
                          aria-label="Save image assignment"
                          title="Save image assignment"
                        >
                          {isAssigning ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                        </Button>
                        {item.finalImageUrl ? (
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/sessions/${sessionId}/export`}>
                              Export
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                  No rows match the selected filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
