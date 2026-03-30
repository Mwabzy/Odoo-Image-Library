"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type ApiPayload = {
  error?: string;
};

async function readPayload(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await response.json()) as ApiPayload;
  }

  const text = await response.text();
  return {
    error: text || "Failed to approve the suggested image."
  } satisfies ApiPayload;
}

export function ApproveSuggestionButton({
  sessionId,
  sheetRowId,
  imageId,
  label = "Approve URL",
  size = "sm",
  redirectTo,
  onError
}: {
  sessionId: string;
  sheetRowId: string;
  imageId: string;
  label?: string;
  size?: "sm" | "default" | "lg";
  redirectTo?: string;
  onError?: (message: string) => void;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleApprove() {
    setIsPending(true);

    try {
      const response = await fetch(`/api/session/${sessionId}/override`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sheetRowId,
          imageId
        })
      });
      const payload = await readPayload(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to approve the suggested image.");
      }

      if (redirectTo) {
        router.push(redirectTo);
        return;
      }

      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to approve the suggested image.";
      onError?.(message);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      onClick={() => void handleApprove()}
      disabled={isPending}
      isLoading={isPending}
    >
      {isPending ? (
        <LoaderCircle className="h-4 w-4 animate-spin" />
      ) : (
        <Check className="h-4 w-4" />
      )}
      {isPending ? "Approving..." : label}
    </Button>
  );
}
