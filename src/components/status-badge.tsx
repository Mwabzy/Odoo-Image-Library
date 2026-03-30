import { Badge } from "@/components/ui/badge";
import type { MatchStatus, SessionStatus } from "@/types/domain";

const matchVariantMap: Record<MatchStatus, Parameters<typeof Badge>[0]["variant"]> =
  {
    matched: "success",
    needs_review: "warning",
    unmatched: "outline",
    duplicate_conflict: "destructive"
  };

const sessionVariantMap: Record<
  SessionStatus,
  Parameters<typeof Badge>[0]["variant"]
> = {
  draft: "outline",
  ready: "secondary",
  processing: "warning",
  completed: "success",
  failed: "destructive"
};

function labelize(value: string) {
  return value.replace(/_/g, " ");
}

export function MatchStatusBadge({ status }: { status: MatchStatus }) {
  return <Badge variant={matchVariantMap[status]}>{labelize(status)}</Badge>;
}

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  return <Badge variant={sessionVariantMap[status]}>{labelize(status)}</Badge>;
}
