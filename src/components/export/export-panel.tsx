"use client";

import { Download, LoaderCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const exportFormats = [
  {
    value: "xlsx",
    title: "Updated workbook",
    description: "Preserves original spreadsheet structure and injects final image URLs."
  },
  {
    value: "csv",
    title: "Updated CSV",
    description: "Generates a flat CSV export for import flows that do not require XLSX."
  },
  {
    value: "report",
    title: "Review report",
    description: "Lists unmatched rows, duplicate conflicts, and orphaned image files."
  }
] as const;

export function ExportPanel({ sessionId }: { sessionId: string }) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeDownload, setActiveDownload] = useState<
    (typeof exportFormats)[number]["value"] | null
  >(null);

  async function handleDownload(format: (typeof exportFormats)[number]["value"]) {
    if (activeDownload) {
      return;
    }

    setActiveDownload(format);

    try {
      const response = await fetch(`/api/session/${sessionId}/export`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ format })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to export file.");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const fileNameMatch = disposition.match(/filename="(.+)"/);
      const fileName = fileNameMatch?.[1] ?? `${sessionId}-${format}`;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to export file."
      );
    } finally {
      setActiveDownload(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Export files</CardTitle>
        <CardDescription>
          Download the updated workbook, a CSV version, or the review report for
          unresolved records.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {errorMessage ? (
          <div className="rounded-[1.25rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}
        {exportFormats.map((item) => {
          const isLoading = activeDownload === item.value;

          return (
          <div
            key={item.value}
            className="flex flex-col gap-4 rounded-[1.5rem] border border-border bg-white/70 px-5 py-5 lg:flex-row lg:items-center lg:justify-between"
          >
            <div>
              <p className="text-base font-semibold text-foreground">{item.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
            </div>
            <Button
              onClick={() => handleDownload(item.value)}
              disabled={Boolean(activeDownload)}
              isLoading={isLoading}
            >
              {isLoading ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {isLoading ? "Downloading..." : "Download"}
            </Button>
          </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
