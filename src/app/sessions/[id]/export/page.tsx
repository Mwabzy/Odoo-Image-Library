import { AppShell } from "@/components/app-shell";
import { ExportPanel } from "@/components/export/export-panel";
import { DiscardSessionButton } from "@/components/sessions/discard-session-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionSummary } from "@/lib/session/service";

export const dynamic = "force-dynamic";

export default async function SessionExportPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  try {
    const { id } = await params;
    const detail = await getSessionSummary(id);

    return (
      <AppShell>
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-2xl">
                  Export session {detail.session.sheetFilename ?? detail.session.id}
                </CardTitle>
                <CardDescription>
                  Download the updated workbook, CSV, and review report without losing
                  the original import format.
                </CardDescription>
              </div>
              <DiscardSessionButton sessionId={id} />
            </CardHeader>
          </Card>
          <ExportPanel sessionId={id} />
        </div>
      </AppShell>
    );
  } catch (error) {
    return (
      <AppShell>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Export unavailable</CardTitle>
            <CardDescription>
              The export screen could not load session details.
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
