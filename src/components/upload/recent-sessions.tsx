import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { SessionStatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SessionSummary } from "@/types/domain";

export function RecentSessions({ sessions }: { sessions: SessionSummary[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="text-xl">Recent sessions</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            Continue processing, review low-confidence matches, or export finished
            runs.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        {sessions.length ? (
          <div className="space-y-3">
            {sessions.map((session) => (
              <Link
                key={session.id}
                href={`/sessions/${session.id}`}
                className="flex items-center justify-between rounded-[1.25rem] border border-border bg-white/70 px-4 py-4 transition hover:bg-white"
              >
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    {session.sheetFilename ?? "Untitled spreadsheet"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {session.totalRows} rows, {session.totalImages} images,{" "}
                    {session.matchedCount} matched
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <SessionStatusBadge status={session.status} />
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-[1.25rem] border border-dashed border-border bg-muted/40 px-4 py-8 text-sm text-muted-foreground">
            No sessions yet. Upload a spreadsheet to create the first one.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
