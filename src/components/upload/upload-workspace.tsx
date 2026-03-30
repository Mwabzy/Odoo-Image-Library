"use client";

import { motion } from "framer-motion";
import {
  FolderOpen,
  LoaderCircle,
  Play,
  Sheet,
  UploadCloud
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ComponentType, useMemo, useRef, useState } from "react";

import { DiscardSessionButton } from "@/components/sessions/discard-session-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { inferImageMetadataFromPath } from "@/lib/parsing/path-inference";
import type { PathMode } from "@/types/domain";

type PreviewRow = {
  previewKey: string;
  name: string;
  relativePath: string;
  inferredProduct: string | null;
  inferredVariation: string | null;
};

type PendingAction = "sheet" | "files" | "folder" | "processing" | null;

async function readApiPayload(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await response.json()) as Record<string, unknown>;
  }

  const text = await response.text();

  return {
    error: text || `Request failed with status ${response.status}.`
  } satisfies Record<string, unknown>;
}

function resolveApiError(response: Response, payload: Record<string, unknown>, fallback: string) {
  if (typeof payload.error === "string" && payload.error.trim()) {
    if (response.status === 413) {
      return "The upload is too large for the server. Try fewer images at once or smaller files.";
    }

    return payload.error;
  }

  if (response.status === 413) {
    return "The upload is too large for the server. Try fewer images at once or smaller files.";
  }

  return fallback;
}

function inferPreview(relativePath: string, pathMode: PathMode, index: number): PreviewRow {
  const safePath = relativePath.replace(/\\/g, "/");
  const parts = safePath.split("/").filter(Boolean);
  const name = (parts.at(-1) ?? relativePath) || `selected-file-${index + 1}`;
  const inferred = inferImageMetadataFromPath(safePath, pathMode);

  return {
    previewKey: `${safePath || name}-${index}`,
    name,
    relativePath: safePath,
    inferredProduct: inferred.inferredProduct,
    inferredVariation: inferred.inferredVariation
  };
}

export function UploadWorkspace() {
  const router = useRouter();
  const sheetInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const pathMode: PathMode = "auto";
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sheetName, setSheetName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [acceptedImages, setAcceptedImages] = useState(0);
  const [rejectedImages, setRejectedImages] = useState(0);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [statusMessage, setStatusMessage] = useState(
    "Upload a spreadsheet first, then add image files or a folder."
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const completion = useMemo(() => {
    const steps = [Boolean(sessionId), acceptedImages > 0];
    return (steps.filter(Boolean).length / steps.length) * 100;
  }, [acceptedImages, sessionId]);

  const showSessionSnapshot = Boolean(
    sheetName || sessionId || totalRows || acceptedImages || rejectedImages
  );

  const workflowState = useMemo(() => {
    if (pendingAction === "sheet") {
      return {
        label: "Adding spreadsheet",
        className: "border-primary/20 bg-primary/10 text-primary"
      };
    }

    if (pendingAction === "files" || pendingAction === "folder") {
      return {
        label: "Uploading images",
        className: "border-primary/20 bg-primary/10 text-primary"
      };
    }

    if (pendingAction === "processing") {
      return {
        label: "Matching images",
        className: "border-primary/20 bg-primary/10 text-primary"
      };
    }

    if (!sessionId) {
      return {
        label: "Waiting for spreadsheet",
        className: "border-border bg-white/75 text-muted-foreground"
      };
    }

    if (!acceptedImages) {
      return {
        label: "Waiting for images",
        className: "border-amber-200 bg-amber-50 text-amber-700"
      };
    }

    return {
      label: "Ready to match",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700"
    };
  }, [acceptedImages, pendingAction, sessionId]);

  function resetWorkspaceState() {
    setSessionId(null);
    setSheetName(null);
    setHeaders([]);
    setTotalRows(0);
    setAcceptedImages(0);
    setRejectedImages(0);
    setPreviewRows([]);
    setErrorMessage(null);
    setStatusMessage("Session deleted. Upload a spreadsheet to start again.");
  }

  async function handleSheetUpload(file: File) {
    setErrorMessage(null);
    setStatusMessage(`Uploading spreadsheet: ${file.name}`);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("pathMode", pathMode);

    const response = await fetch("/api/upload-sheet", {
      method: "POST",
      body: formData
    });
    const data = await readApiPayload(response);

    if (!response.ok) {
      throw new Error(
        resolveApiError(response, data, "Failed to upload spreadsheet.")
      );
    }

    setSessionId(String(data.sessionId ?? ""));
    setSheetName(file.name);
    setHeaders(Array.isArray(data.headers) ? data.headers.map(String) : []);
    setTotalRows(Number(data.totalRows ?? 0));
    setAcceptedImages(0);
    setRejectedImages(0);
    setPreviewRows([]);
    setStatusMessage("Spreadsheet uploaded. Add image files or a folder next.");
  }

  async function handleImageUpload(
    files: FileList | null,
    source: "files" | "folder"
  ) {
    if (!sessionId) {
      throw new Error("Upload the spreadsheet before adding images.");
    }

    const selectedFiles = Array.from(files ?? []);
    if (!selectedFiles.length) {
      return;
    }

    setErrorMessage(null);
    setStatusMessage(
      source === "folder"
        ? `Uploading ${selectedFiles.length} files from folder selection.`
        : `Uploading ${selectedFiles.length} selected image file${selectedFiles.length === 1 ? "" : "s"}.`
    );
    setPreviewRows(
      selectedFiles
        .slice(0, 15)
        .map((file, index) =>
          inferPreview(
            (file as File & { webkitRelativePath?: string }).webkitRelativePath ??
              file.name,
            pathMode,
            index
          )
        )
    );

    const formData = new FormData();
    formData.append("sessionId", sessionId);

    for (const file of selectedFiles) {
      const relativePath =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name;
      formData.append("files", file);
      formData.append("relativePaths", relativePath);
    }

    const response = await fetch("/api/upload-images/folder", {
      method: "POST",
      body: formData
    });
    const data = await readApiPayload(response);

    if (!response.ok) {
      throw new Error(
        resolveApiError(response, data, "Failed to upload selected images.")
      );
    }

    const accepted = Number(data.accepted ?? 0);
    const rejected = Number(data.rejected ?? 0);

    setAcceptedImages((current) => current + accepted);
    setRejectedImages((current) => current + rejected);
    setStatusMessage(
      `${source === "folder" ? "Folder" : "File"} upload finished. ${accepted} accepted, ${rejected} rejected.`
    );
  }

  async function runTask(action: Exclude<PendingAction, null>, task: () => Promise<void>) {
    setPendingAction(action);

    try {
      await task();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong.";
      setErrorMessage(message);
      setStatusMessage(message);
    } finally {
      setPendingAction(null);
    }
  }

  function handleStartProcessing() {
    if (!sessionId) {
      setErrorMessage("Upload a spreadsheet before starting processing.");
      return;
    }

    if (!acceptedImages) {
      setErrorMessage("Upload image files or a folder before starting processing.");
      return;
    }

    void runTask("processing", async () => {
      setStatusMessage(
        "Matching image names with the product names in your spreadsheet."
      );
      const response = await fetch("/api/process-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ sessionId })
      });
      const data = await readApiPayload(response);

      if (!response.ok) {
        throw new Error(
          resolveApiError(response, data, "Failed to process session.")
        );
      }

      setStatusMessage(
        `Matching finished. ${Number(data.matched ?? 0)} matched automatically, ${Number(data.needsReview ?? 0)} need review, and ${Number(data.queuedAssetJobs ?? 0)} image jobs are still running in the background.`
      );
      router.push(`/sessions/${sessionId}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
      >
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border/70 bg-gradient-to-r from-primary/10 via-white to-secondary/60">
            <CardTitle className="text-2xl">Upload workspace</CardTitle>
            <CardDescription>
              Upload a spreadsheet with product names and an image column, then add
              the product images you want to turn into image links. For the best
              results, keep the image file names close to the product names.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div className="rounded-[1.5rem] border border-border bg-secondary/45 p-4 sm:p-5">
              <p className="text-sm font-semibold text-foreground">Before you upload</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Make sure your spreadsheet already has a column for images. We will
                fill that column with the image links when you export.
              </p>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Try to keep image file names similar to the product names in the
                spreadsheet. If they are not the same, they should still follow a
                clear and predictable naming pattern so the app can match them.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <UploadCard
                icon={Sheet}
                title="Spreadsheet"
                description=".xlsx, .xls, or .csv"
                actionLabel={sheetName ? "Replace spreadsheet" : "Choose spreadsheet"}
                loadingLabel="Parsing spreadsheet..."
                onClick={() => sheetInputRef.current?.click()}
                active={Boolean(sessionId)}
                isLoading={pendingAction === "sheet"}
                disabled={Boolean(pendingAction) && pendingAction !== "sheet"}
              />
              <UploadCard
                icon={UploadCloud}
                title="Files upload"
                description="Select one image or a batch of images"
                actionLabel={sessionId ? "Choose files" : "Upload spreadsheet first"}
                loadingLabel="Uploading files..."
                onClick={() => filesInputRef.current?.click()}
                active={acceptedImages > 0}
                isLoading={pendingAction === "files"}
                disabled={!sessionId || Boolean(pendingAction)}
              />
              <UploadCard
                icon={FolderOpen}
                title="Folder upload"
                description="Preserves browser relative paths"
                actionLabel={sessionId ? "Choose folder" : "Upload spreadsheet first"}
                loadingLabel="Uploading folder..."
                onClick={() => folderInputRef.current?.click()}
                active={acceptedImages > 0}
                isLoading={pendingAction === "folder"}
                disabled={!sessionId || Boolean(pendingAction)}
              />
            </div>

            {showSessionSnapshot ? (
              <div className="rounded-[1.5rem] border border-border bg-white/70 p-4 sm:p-5">
                <p className="text-sm font-semibold text-foreground">
                  Session snapshot
                </p>
                <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryValue label="Spreadsheet" value={sheetName ?? "Uploaded"} />
                  <SummaryValue label="Product rows" value={String(totalRows)} />
                  <SummaryValue label="Images added" value={String(acceptedImages)} />
                  <SummaryValue label="Rejected files" value={String(rejectedImages)} />
                </div>
              </div>
            ) : null}

            <div className="rounded-[1.5rem] border border-border bg-white/70 p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-2xl">
                  <p className="text-sm font-semibold text-foreground">
                    Extracted file preview
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Sampled from the current browser selection so the operator can
                    validate relative paths before processing.
                  </p>
                </div>
                <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
                  {sessionId ? (
                    <DiscardSessionButton
                      sessionId={sessionId}
                      label="Discard and start again"
                      className="w-full sm:w-auto [&>button]:w-full"
                      redirectTo={null}
                      onDeleted={resetWorkspaceState}
                      onError={(message) => {
                        setErrorMessage(message);
                        setStatusMessage(message);
                      }}
                    />
                  ) : null}
                  <Button
                    type="button"
                    className="w-full sm:w-auto"
                    onClick={handleStartProcessing}
                    disabled={Boolean(pendingAction) || !sessionId || !acceptedImages}
                    isLoading={pendingAction === "processing"}
                  >
                    {pendingAction === "processing" ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {pendingAction === "processing" ? "Processing..." : "Start processing"}
                  </Button>
                </div>
              </div>
              <div className="mt-4">
                <Table className="min-w-[42rem]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>File</TableHead>
                      <TableHead>Relative path</TableHead>
                      <TableHead>Product hint</TableHead>
                      <TableHead>Variation hint</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.length ? (
                      previewRows.map((row) => (
                        <TableRow key={row.previewKey}>
                          <TableCell className="font-medium">{row.name}</TableCell>
                          <TableCell>{row.relativePath || row.name}</TableCell>
                          <TableCell>{row.inferredProduct ?? "Pending"}</TableCell>
                          <TableCell>{row.inferredVariation ?? "Pending"}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                          File or folder selections will preview here before processing.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.06 }}
      >
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border/70 bg-gradient-to-r from-secondary/70 via-white to-primary/10">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <CardTitle className="text-2xl">Current progress</CardTitle>
                <CardDescription>
                  This shows what is ready now and what you should do next.
                </CardDescription>
              </div>
              <div
                className={`inline-flex w-fit items-center rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] ${workflowState.className}`}
              >
                {workflowState.label}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[1.5rem] border border-border bg-muted/35 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  What is happening
                </p>
                <p className="mt-3 text-sm leading-7 text-foreground sm:text-base">
                  {statusMessage}
                </p>
                <div className="mt-5 space-y-3">
                  <Progress value={completion} />
                  <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    <span>{completion === 100 ? "Ready to continue" : "Upload progress"}</span>
                    <span>{Math.round(completion)}%</span>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <ValidationItem
                  label="Spreadsheet"
                  value={sessionId ? "Ready" : "Waiting"}
                />
                <ValidationItem
                  label="Images"
                  value={acceptedImages ? `${acceptedImages} loaded` : "Waiting"}
                />
                <ValidationItem label="Rows" value={String(totalRows)} />
                <ValidationItem
                  label="Session id"
                  value={sessionId ? `${sessionId.slice(0, 8)}...` : "Pending"}
                />
              </div>
            </div>

            {errorMessage ? (
              <div className="rounded-[1.25rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {errorMessage}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </motion.div>

      <input
        ref={sheetInputRef}
        type="file"
        className="hidden"
        accept=".xlsx,.xls,.csv"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) {
            return;
          }

          void runTask("sheet", () => handleSheetUpload(file));
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={filesInputRef}
        type="file"
        className="hidden"
        multiple
        accept="image/*,.svg,.tif,.tiff"
        onChange={(event) => {
          void runTask("files", () => handleImageUpload(event.target.files, "files"));
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        multiple
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={(event) => {
          void runTask("folder", () => handleImageUpload(event.target.files, "folder"));
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}

function UploadCard({
  icon: Icon,
  title,
  description,
  actionLabel,
  loadingLabel,
  onClick,
  active,
  isLoading,
  disabled = false
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  actionLabel: string;
  loadingLabel: string;
  onClick: () => void;
  active: boolean;
  isLoading: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-[1.5rem] border border-border bg-white/75 p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <p className="mt-4 text-base font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="w-fit rounded-full border border-border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {active ? "Loaded" : "Pending"}
        </div>
      </div>
      <Button
        variant="outline"
        className="mt-4 w-full"
        onClick={onClick}
        disabled={disabled}
        isLoading={isLoading}
      >
        {isLoading ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : (
          <Icon className="h-4 w-4" />
        )}
        {isLoading ? loadingLabel : actionLabel}
      </Button>
    </div>
  );
}

function SummaryValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1rem] border border-border bg-background/80 px-3 py-3">
      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-words text-base font-semibold text-foreground sm:text-lg">
        {value}
      </p>
    </div>
  );
}

function ValidationItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[1rem] border border-border bg-white/70 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="text-foreground">{label}</span>
      <span className="font-medium text-muted-foreground">{value}</span>
    </div>
  );
}
