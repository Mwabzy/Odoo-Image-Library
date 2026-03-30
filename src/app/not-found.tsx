import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function NotFound() {
  return (
    <AppShell>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Session not found</CardTitle>
          <CardDescription>
            The requested session does not exist or has been removed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/dashboard">Return to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </AppShell>
  );
}
