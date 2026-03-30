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

export function formatConfidencePercentage(confidenceScore: number | null | undefined) {
  if (confidenceScore === null || confidenceScore === undefined) {
    return "Pending";
  }

  return `${Math.round(confidenceScore * 100)}%`;
}

export function isQuickApproveCandidate(args: {
  imageId?: string | null;
  status: MatchStatus;
  confidenceScore?: number | null;
}) {
  if (!args.imageId) {
    return false;
  }

  if (args.status === "matched" || args.status === "unmatched") {
    return false;
  }

  return (args.confidenceScore ?? 0) >= 0.85;
}

function getConfidenceVariant(confidenceScore: number | null | undefined) {
  if (confidenceScore === null || confidenceScore === undefined) {
    return "outline";
  }

  if (confidenceScore >= 0.85) {
    return "success";
  }

  if (confidenceScore >= 0.6) {
    return "warning";
  }

  return "outline";
}

function getDecisionMeta(args: {
  status: MatchStatus;
  confidenceScore?: number | null;
  isManual?: boolean;
}) {
  if (args.status === "matched") {
    return {
      label: args.isManual ? "approved" : "matched",
      variant: "success" as const
    };
  }

  if (args.status === "needs_review") {
    return (args.confidenceScore ?? 0) >= 0.85
      ? {
          label: "suggested",
          variant: "warning" as const
        }
      : {
          label: "review",
          variant: "outline" as const
        };
  }

  if (args.status === "duplicate_conflict") {
    return {
      label: "conflict",
      variant: "destructive" as const
    };
  }

  return {
    label: "no match",
    variant: "outline" as const
  };
}

export function MatchConfidenceBadge({
  confidenceScore
}: {
  confidenceScore: number | null | undefined;
}) {
  return (
    <Badge variant={getConfidenceVariant(confidenceScore)}>
      {formatConfidencePercentage(confidenceScore)}
    </Badge>
  );
}

export function MatchDecisionBadge({
  status,
  confidenceScore,
  isManual = false
}: {
  status: MatchStatus;
  confidenceScore?: number | null;
  isManual?: boolean;
}) {
  const decision = getDecisionMeta({
    status,
    confidenceScore,
    isManual
  });

  return <Badge variant={decision.variant}>{decision.label}</Badge>;
}
