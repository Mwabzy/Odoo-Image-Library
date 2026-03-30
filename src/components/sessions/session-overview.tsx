import Link from "next/link";
import { ArrowRight, Download, ExternalLink, Search } from "lucide-react";

import { ApproveSuggestionButton } from "@/components/matches/approve-suggestion-button";
import { DiscardSessionButton } from "@/components/sessions/discard-session-button";
import {
  MatchConfidenceBadge,
  MatchDecisionBadge,
  SessionStatusBadge,
  isQuickApproveCandidate
} from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import type {
  MatchRecord,
  SheetRowRecord,
  ExtractedImageRecord,
  ProcessingLogRecord
} from "@/types/database";
import type { MatchStatus, SessionSummary } from "@/types/domain";

export function SessionOverview({
  session,
  sheetRows,
  extractedImages,
  matches,
  logs
}: {
  session: SessionSummary;
  sheetRows: SheetRowRecord[];
  extractedImages: ExtractedImageRecord[];
  matches: MatchRecord[];
  logs: ProcessingLogRecord[];
}) {
  const imageStatusMap = new Map(matches.map((match) => [match.image_id, match.status]));
  const rowMatchMap = new Map(matches.map((match) => [match.sheet_row_id, match]));
  const rowMap = new Map(sheetRows.map((row) => [row.id, row]));
  const imageMatchMap = new Map<string, MatchRecord>();

  for (const match of matches) {
    if (!match.image_id) {
      continue;
    }

    const current = imageMatchMap.get(match.image_id);
    const currentScore = current?.confidence_score ?? -1;
    const nextScore = match.confidence_score ?? -1;

    if (!current || nextScore > currentScore) {
      imageMatchMap.set(match.image_id, match);
    }
  }

  function resolveImageStatus(image: ExtractedImageRecord): MatchStatus {
    const mappedStatus = imageStatusMap.get(image.id);
    if (mappedStatus) {
      return mappedStatus;
    }

    if (
      image.status === "matched" ||
      image.status === "needs_review" ||
      image.status === "unmatched" ||
      image.status === "duplicate_conflict"
    ) {
      return image.status;
    }

    return "unmatched";
  }

  function resolveSuggestedProduct(image: ExtractedImageRecord) {
    const match = imageMatchMap.get(image.id);
    const matchedRow = match ? rowMap.get(match.sheet_row_id) : null;

    return matchedRow?.product_name ?? image.inferred_product ?? "Not inferred";
  }

  function resolveSuggestedImage(row: SheetRowRecord) {
    const match = rowMatchMap.get(row.id);
    const image = match?.image_id
      ? extractedImages.find((record) => record.id === match.image_id)
      : null;

    return {
      match,
      image
    };
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.85fr]">
        <Card>
          <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <CardTitle className="text-2xl">
                  {session.sheetFilename ?? "Processing session"}
                </CardTitle>
                <SessionStatusBadge status={session.status} />
              </div>
              <CardDescription className="mt-2">
                Session id {session.id}, path mode {session.pathMode}, upload mode{" "}
                {formatUploadMode(session.uploadMode)}.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-3">
              <DiscardSessionButton sessionId={session.id} />
              <Button asChild variant="outline">
                <Link href={`/sessions/${session.id}/matches`}>
                  <Search className="h-4 w-4" />
                  Review matches
                </Link>
              </Button>
              <Button asChild>
                <Link href={`/sessions/${session.id}/export`}>
                  <Download className="h-4 w-4" />
                  Export files
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <MetricCard label="Total rows" value={String(session.totalRows)} />
              <MetricCard label="Total images" value={String(session.totalImages)} />
              <MetricCard label="Matched" value={String(session.matchedCount)} />
              <MetricCard label="Needs review" value={String(session.needsReviewCount)} />
              <MetricCard label="Unmatched" value={String(session.unmatchedCount)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Resolved mapping</CardTitle>
            <CardDescription>
              Header detection is stored with the session so exports preserve the
              original import structure.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {Object.entries(session.columnMapping).map(([key, value]) => (
              <div
                key={key}
                className="flex items-center justify-between rounded-[1rem] border border-border bg-white/70 px-4 py-3"
              >
                <span className="font-medium capitalize text-foreground">
                  {key.replace(/_/g, " ")}
                </span>
                <span className="text-muted-foreground">{value ?? "Unmapped"}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Processing timeline</CardTitle>
          <CardDescription>
            Each stage is logged so you can tell whether the session is still running,
            completed with low matches, or failed on a specific step.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <MetricCard label="Current state" value={labelize(session.status)} />
            <MetricCard label="Matched rows" value={String(session.matchedCount)} />
            <MetricCard label="Needs review" value={String(session.needsReviewCount)} />
            <MetricCard label="Unmatched rows" value={String(session.unmatchedCount)} />
          </div>
          <div className="space-y-3">
            {logs.length ? (
              logs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-[1.2rem] border border-border bg-white/70 px-4 py-4"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <span className="rounded-full border border-border bg-background px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        {formatStageLabel(log.stage)}
                      </span>
                      <p className="text-sm font-medium text-foreground">{log.message}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleString()}
                    </p>
                  </div>
                  {log.meta ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {renderMetaSummary(log.meta)}
                    </p>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-[1.2rem] border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                No processing logs yet. Start a run to populate the progress timeline.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Extracted image records</CardTitle>
            <CardDescription>
              See the strongest product suggestion for each uploaded image, together
              with the confidence score and current decision.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Relative path</TableHead>
                  <TableHead>Suggested product</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {extractedImages.length ? (
                  extractedImages.slice(0, 20).map((image) => {
                    const match = imageMatchMap.get(image.id);
                    const status = resolveImageStatus(image);

                    return (
                      <TableRow key={image.id}>
                        <TableCell className="font-medium">{image.original_name}</TableCell>
                        <TableCell>{image.relative_path}</TableCell>
                        <TableCell>{resolveSuggestedProduct(image)}</TableCell>
                        <TableCell>
                          <MatchConfidenceBadge confidenceScore={match?.confidence_score} />
                        </TableCell>
                        <TableCell>
                          <MatchDecisionBadge
                            status={status}
                            confidenceScore={match?.confidence_score}
                            isManual={match?.is_manual}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      No image records yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Spreadsheet rows</CardTitle>
            <CardDescription>
              Review each product row, see the suggested image match, and approve a
              strong suggestion when you are happy with it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Row</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Variation</TableHead>
                  <TableHead>Suggested image</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheetRows.length ? (
                  sheetRows.slice(0, 20).map((row) => {
                    const suggested = resolveSuggestedImage(row);
                    const status =
                      row.status === "pending" ? "unmatched" : row.status;
                    const quickApprove = isQuickApproveCandidate({
                      imageId: suggested.image?.id ?? suggested.match?.image_id,
                      status,
                      confidenceScore: suggested.match?.confidence_score
                    });

                    return (
                      <TableRow key={row.id}>
                        <TableCell>{row.row_index}</TableCell>
                        <TableCell className="font-medium">
                          {row.product_name ?? "Unnamed product"}
                        </TableCell>
                        <TableCell>{row.sku ?? row.parent_sku ?? "No SKU"}</TableCell>
                        <TableCell>{row.variation ?? "No variation"}</TableCell>
                        <TableCell>
                          {suggested.image?.original_name ?? "No suggestion yet"}
                        </TableCell>
                        <TableCell>
                          <MatchConfidenceBadge
                            confidenceScore={suggested.match?.confidence_score}
                          />
                        </TableCell>
                        <TableCell>
                          <MatchDecisionBadge
                            status={status}
                            confidenceScore={suggested.match?.confidence_score}
                            isManual={suggested.match?.is_manual}
                          />
                        </TableCell>
                        <TableCell className="min-w-44">
                          <div className="flex flex-wrap gap-2">
                            {quickApprove && suggested.image ? (
                              <ApproveSuggestionButton
                                sessionId={session.id}
                                sheetRowId={row.id}
                                imageId={suggested.image.id}
                              />
                            ) : row.final_image_url ? (
                              <Button asChild variant="outline" size="sm">
                                <a
                                  href={row.final_image_url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Open URL
                                  <ExternalLink className="h-4 w-4" />
                                </a>
                              </Button>
                            ) : (
                              <Button asChild variant="ghost" size="sm">
                                <Link href={`/sessions/${session.id}/matches`}>
                                  Review
                                  <ArrowRight className="h-4 w-4" />
                                </Link>
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      No sheet rows found for this session.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <div className="mt-4">
              <Button asChild variant="ghost" className="px-0">
                <Link href={`/sessions/${session.id}/matches`}>
                  Open full match review
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.2rem] border border-border bg-white/70 px-4 py-4">
      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function labelize(value: string) {
  return value.replace(/_/g, " ");
}

function formatUploadMode(value: SessionSummary["uploadMode"]) {
  if (!value) {
    return "pending";
  }

  return value === "folder" ? "browser files/folder" : "zip archive";
}

function formatStageLabel(stage: string) {
  return labelize(stage);
}

function renderMetaSummary(meta: Record<string, unknown>) {
  return Object.entries(meta)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${labelize(key)}: ${String(value)}`)
    .join(" | ");
}
