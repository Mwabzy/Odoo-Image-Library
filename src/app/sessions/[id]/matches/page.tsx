import Link from "next/link";
import { Download } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { BackgroundAssetProcessor } from "@/components/sessions/background-asset-processor";
import { DiscardSessionButton } from "@/components/sessions/discard-session-button";
import { MatchReviewTable } from "@/components/matches/match-review-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionMatches, getSessionSummary } from "@/lib/session/service";

export const dynamic = "force-dynamic";

export default async function SessionMatchesPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  try {
    const { id } = await params;
    const [session, matches] = await Promise.all([
      getSessionSummary(id),
      getSessionMatches({
        sessionId: id,
        page: 1,
        pageSize: 200,
        filter: "all"
      })
    ]);

    return (
      <AppShell>
        <BackgroundAssetProcessor sessionId={id} />
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-2xl">
                  {session.session.sheetFilename ?? "Match review"}
                </CardTitle>
                <CardDescription>
                  {session.session.matchedCount} matched,{" "}
                  {session.session.needsReviewCount} needs review,{" "}
                  {session.session.unmatchedCount} unmatched.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild>
                  <Link href={`/sessions/${id}/export`}>
                    <Download className="h-4 w-4" />
                    Export spreadsheet
                  </Link>
                </Button>
                <DiscardSessionButton sessionId={id} />
              </div>
            </CardHeader>
          </Card>
          <MatchReviewTable
            sessionId={id}
            items={matches.items}
            sheetRows={session.sheetRows}
            images={session.extractedImages}
          />
        </div>
      </AppShell>
    );
  } catch (error) {
    return (
      <AppShell>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Match review unavailable</CardTitle>
            <CardDescription>
              The match review data could not be loaded.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "Unknown error."}
          </CardContent>
        </Card>
      </AppShell>
    );
  }
}
