import Link from "next/link";
import { ArrowRight, Download, Search } from "lucide-react";

import { DiscardSessionButton } from "@/components/sessions/discard-session-button";
import { MatchStatusBadge, SessionStatusBadge } from "@/components/status-badge";
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
              Normalized relative paths, inferred product and variation values, and
              current processing state.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Relative path</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Variation</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {extractedImages.length ? (
                  extractedImages.slice(0, 20).map((image) => (
                    <TableRow key={image.id}>
                      <TableCell className="font-medium">{image.original_name}</TableCell>
                      <TableCell>{image.relative_path}</TableCell>
                      <TableCell>{image.inferred_product ?? "Unknown"}</TableCell>
                      <TableCell>{image.inferred_variation ?? "Unknown"}</TableCell>
                      <TableCell>
                        <MatchStatusBadge status={resolveImageStatus(image)} />
                      </TableCell>
                    </TableRow>
                  ))
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
              Review the normalized product data stored from the uploaded sheet.
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
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheetRows.length ? (
                  sheetRows.slice(0, 20).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.row_index}</TableCell>
                      <TableCell className="font-medium">{row.product_name ?? "Unknown"}</TableCell>
                      <TableCell>{row.sku ?? row.parent_sku ?? "Unknown"}</TableCell>
                      <TableCell>{row.variation ?? "None"}</TableCell>
                      <TableCell>
                        <MatchStatusBadge
                          status={
                            row.status === "pending" ? "unmatched" : row.status
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
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
