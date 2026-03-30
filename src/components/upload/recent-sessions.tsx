"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { SessionStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SessionSummary } from "@/types/domain";

export function RecentSessions({ sessions }: { sessions: SessionSummary[] }) {
  const router = useRouter();
  const [items, setItems] = useState(sessions);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(
    null
  );

  const allSelected = useMemo(
    () => items.length > 0 && selectedIds.length === items.length,
    [items.length, selectedIds.length]
  );

  function toggleSelection(sessionId: string) {
    setSelectedIds((current) =>
      current.includes(sessionId)
        ? current.filter((id) => id !== sessionId)
        : [...current, sessionId]
    );
  }

  function handleSelectAll() {
    setSelectedIds(allSelected ? [] : items.map((session) => session.id));
  }

  async function handleDeleteSelected() {
    if (!selectedIds.length || isDeleting) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${selectedIds.length} recent session${selectedIds.length === 1 ? "" : "s"}? This cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    setFeedback(null);

    try {
      const results = await Promise.allSettled(
        selectedIds.map(async (sessionId) => {
          const response = await fetch(`/api/session/${sessionId}`, {
            method: "DELETE"
          });
          const payload = await response.json().catch(() => null);

          if (!response.ok) {
            throw new Error(payload?.error ?? "Failed to delete session.");
          }

          return sessionId;
        })
      );

      const deletedIds = results
        .filter(
          (result): result is PromiseFulfilledResult<string> =>
            result.status === "fulfilled"
        )
        .map((result) => result.value);

      const failedCount = results.length - deletedIds.length;

      if (deletedIds.length) {
        const deletedSet = new Set(deletedIds);
        setItems((current) => current.filter((session) => !deletedSet.has(session.id)));
        setSelectedIds((current) => current.filter((id) => !deletedSet.has(id)));
        router.refresh();
      }

      setFeedback({
        tone: failedCount ? "error" : "success",
        message:
          deletedIds.length === 0
            ? `No sessions were deleted. ${failedCount} still need attention.`
            : failedCount
          ? `Deleted ${deletedIds.length} session${deletedIds.length === 1 ? "" : "s"}, but ${failedCount} could not be removed.`
          : `Deleted ${deletedIds.length} recent session${deletedIds.length === 1 ? "" : "s"}.`
      });
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="text-xl">Recent sessions</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            Continue processing, review low-confidence matches, or select finished
            runs to delete.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.length ? (
          <>
            <div className="flex flex-col gap-3 rounded-[1.25rem] border border-border bg-muted/35 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {selectedIds.length ? `${selectedIds.length} selected` : "Select sessions to manage"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open any session, or bulk-delete older runs you no longer need.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSelectAll}
                  disabled={!items.length || isDeleting}
                >
                  {allSelected ? "Clear selection" : "Select all"}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteSelected}
                  disabled={!selectedIds.length || isDeleting}
                  isLoading={isDeleting}
                >
                  {isDeleting ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  {isDeleting ? "Deleting..." : "Delete selected"}
                </Button>
              </div>
            </div>

            {feedback ? (
              <div
                className={
                  feedback.tone === "error"
                    ? "rounded-[1rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
                    : "rounded-[1rem] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
                }
              >
                {feedback.message}
              </div>
            ) : null}

            <div className="space-y-3">
              {items.map((session) => {
                const isSelected = selectedIds.includes(session.id);

                return (
                  <div
                    key={session.id}
                    className={`flex flex-col gap-4 rounded-[1.25rem] border px-4 py-4 transition sm:flex-row sm:items-center sm:justify-between ${
                      isSelected
                        ? "border-primary/35 bg-primary/5 shadow-soft"
                        : "border-border bg-white/70 hover:bg-white"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        aria-label={`Select session ${session.sheetFilename ?? session.id}`}
                        checked={isSelected}
                        disabled={isDeleting}
                        onChange={() => toggleSelection(session.id)}
                        className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-ring"
                      />
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">
                          {session.sheetFilename ?? "Untitled spreadsheet"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {session.totalRows} rows, {session.totalImages} images,{" "}
                          {session.matchedCount} matched
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <SessionStatusBadge status={session.status} />
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/sessions/${session.id}`}>
                          Open session
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="rounded-[1.25rem] border border-dashed border-border bg-muted/40 px-4 py-8 text-sm text-muted-foreground">
            No sessions yet. Upload a spreadsheet to create the first one.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
