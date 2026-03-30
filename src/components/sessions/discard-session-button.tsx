"use client";

import { LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

export function DiscardSessionButton({
  sessionId,
  label = "Discard session",
  redirectTo = "/dashboard",
  onDeleted,
  onError,
  className
}: {
  sessionId: string;
  label?: string;
  redirectTo?: string | null;
  onDeleted?: () => void;
  onError?: (message: string) => void;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [localError, setLocalError] = useState<string | null>(null);

  function handleDiscard() {
    const confirmed = window.confirm(
      "Discard this session and all of its uploaded rows, images, matches, and exports?"
    );

    if (!confirmed) {
      return;
    }

    startTransition(() => {
      fetch(`/api/session/${sessionId}`, {
        method: "DELETE"
      })
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data.error ?? "Failed to discard session.");
          }

          setLocalError(null);
          onDeleted?.();

          if (redirectTo) {
            router.push(redirectTo);
          }

          router.refresh();
        })
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : "Failed to discard session.";
          setLocalError(message);
          onError?.(message);
        });
    });
  }

  return (
    <div className={className}>
      <Button
        type="button"
        variant="destructive"
        onClick={handleDiscard}
        disabled={isPending}
      >
        {isPending ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
        {label}
      </Button>
      {localError ? (
        <p className="mt-2 text-sm text-rose-700">{localError}</p>
      ) : null}
    </div>
  );
}
