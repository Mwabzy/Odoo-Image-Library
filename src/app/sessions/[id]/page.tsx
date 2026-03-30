import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { BackgroundAssetProcessor } from "@/components/sessions/background-asset-processor";
import { SessionOverview } from "@/components/sessions/session-overview";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionSummary } from "@/lib/session/service";

export const dynamic = "force-dynamic";

export default async function SessionPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  try {
    const { id } = await params;
    const detail = await getSessionSummary(id);

    return (
      <AppShell>
        <BackgroundAssetProcessor sessionId={id} />
        <SessionOverview
          session={detail.session}
          sheetRows={detail.sheetRows}
          extractedImages={detail.extractedImages}
          matches={detail.matches}
          logs={detail.logs}
        />
      </AppShell>
    );
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      notFound();
    }

    return (
      <AppShell>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Session unavailable</CardTitle>
            <CardDescription>
              The session could not be loaded from Supabase.
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
