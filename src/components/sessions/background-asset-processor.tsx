"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function BackgroundAssetProcessor({
  sessionId,
  maxPasses = 4
}: {
  sessionId: string;
  maxPasses?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function run() {
      for (let pass = 0; pass < maxPasses; pass += 1) {
        if (cancelled) {
          return;
        }

        try {
          const response = await fetch(`/api/session/${sessionId}/asset-processing`, {
            method: "POST",
            keepalive: true
          });
          const data = await response.json();

          if (!response.ok) {
            return;
          }

          if ((data.completed ?? 0) > 0 || (data.failed ?? 0) > 0) {
            router.refresh();
          }

          if (!data.hasMore || (data.started ?? 0) === 0) {
            return;
          }

          await delay(1_500);
        } catch {
          return;
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [maxPasses, router, sessionId]);

  return null;
}
