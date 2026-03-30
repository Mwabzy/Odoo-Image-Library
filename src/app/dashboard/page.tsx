import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RecentSessions } from "@/components/upload/recent-sessions";
import { UploadWorkspace } from "@/components/upload/upload-workspace";
import { getDashboardData } from "@/lib/session/service";
import type { SessionSummary } from "@/types/domain";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let sessions: SessionSummary[] = [];
  let errorMessage: string | null = null;

  try {
    sessions = await getDashboardData();
  } catch (error) {
    errorMessage =
      error instanceof Error
        ? error.message
        : "Configure Supabase to load recent sessions.";
  }

  return (
    <AppShell currentPath="/dashboard">
      <div className="space-y-6">
        {errorMessage ? (
          <Card className="border-amber-200 bg-amber-50/80">
            <CardHeader>
              <CardTitle className="text-xl">Configuration required</CardTitle>
              <CardDescription className="text-amber-900/80">
                {errorMessage}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm leading-6 text-amber-900/80">
              Add Supabase and Cloudinary environment variables before using the live
              upload and processing flow.
            </CardContent>
          </Card>
        ) : null}
        <UploadWorkspace />
        <RecentSessions sessions={sessions} />
      </div>
    </AppShell>
  );
}
