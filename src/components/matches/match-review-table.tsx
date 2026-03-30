"use client";

import Link from "next/link";
import { ExternalLink, LoaderCircle, RefreshCcw, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { MatchStatusBadge } from "@/components/status-badge";
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
import type { ExtractedImageRecord } from "@/types/database";
import type { MatchReviewItem } from "@/types/domain";

type MatchFilter = "all" | "matched" | "unmatched" | "needs_review" | "duplicate_conflict";

export function MatchReviewTable({
  sessionId,
  items,
  images
}: {
  sessionId: string;
  items: MatchReviewItem[];
  images: ExtractedImageRecord[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<MatchFilter>("all");
  const [selectedImageIds, setSelectedImageIds] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const visibleItems = useMemo(() => {
    if (filter === "all") {
      return items;
    }

    return items.filter((item) => item.status === filter);
  }, [filter, items]);

  function handleOverride(sheetRowId: string) {
    const imageId = selectedImageIds[sheetRowId];
    if (!imageId) {
      setErrorMessage("Choose an extracted image before saving an override.");
      return;
    }

    startTransition(() => {
      fetch(`/api/session/${sessionId}/override`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ sheetRowId, imageId })
      })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.error ?? "Failed to save override.");
          }

          setErrorMessage(null);
          router.refresh();
        })
        .catch((error) => {
          setErrorMessage(
            error instanceof Error ? error.message : "Failed to save override."
          );
        });
    });
  }

  function handleRematch() {
    startTransition(() => {
      fetch(`/api/session/${sessionId}/rematch`, {
        method: "POST"
      })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.error ?? "Failed to rerun matching.");
          }

          setErrorMessage(null);
          router.refresh();
        })
        .catch((error) => {
          setErrorMessage(
            error instanceof Error ? error.message : "Failed to rerun matching."
          );
        });
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <CardTitle className="text-2xl">Match review</CardTitle>
          <CardDescription>
            Filter by match state, inspect confidence and reasons, and apply manual
            overrides when the filename matcher needs help. Final processed URLs
            continue warming in the background.
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
            <option value="needs_review">Needs review</option>
            <option value="duplicate_conflict">Duplicate conflicts</option>
          </Select>
          <Button variant="outline" onClick={handleRematch} disabled={isPending}>
            {isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4" />
            )}
            Rerun matching
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
              <TableHead>Match</TableHead>
              <TableHead>Relative path</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Final URL</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Override</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleItems.length ? (
              visibleItems.map((item) => (
                <TableRow key={item.sheetRowId}>
                  <TableCell>{item.rowIndex}</TableCell>
                  <TableCell className="font-medium">{item.productName ?? "Unknown"}</TableCell>
                  <TableCell>{item.sku ?? "Unknown"}</TableCell>
                  <TableCell>{item.variation ?? "None"}</TableCell>
                  <TableCell>{item.matchedFilename ?? "Unassigned"}</TableCell>
                  <TableCell>{item.relativePath ?? "Pending"}</TableCell>
                  <TableCell>
                    {item.confidenceScore !== null
                      ? item.confidenceScore.toFixed(2)
                      : "0.00"}
                  </TableCell>
                  <TableCell>{item.matchReason ?? "None"}</TableCell>
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
                      "Pending"
                    )}
                  </TableCell>
                  <TableCell>
                    <MatchStatusBadge status={item.status} />
                  </TableCell>
                  <TableCell className="min-w-64">
                    <div className="flex gap-2">
                      <Select
                        value={selectedImageIds[item.sheetRowId] ?? item.imageId ?? ""}
                        onChange={(event) =>
                          setSelectedImageIds((current) => ({
                            ...current,
                            [item.sheetRowId]: event.target.value
                          }))
                        }
                      >
                        <option value="">Select image</option>
                        {images.map((image) => (
                          <option key={image.id} value={image.id}>
                            {image.relative_path}
                          </option>
                        ))}
                      </Select>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOverride(item.sheetRowId)}
                        disabled={isPending}
                      >
                        <Save className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
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
