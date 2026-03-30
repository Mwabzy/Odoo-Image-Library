import { addFolderImagesToSession } from "@/lib/session/service";
import { fail, ok } from "@/lib/utils/http";
import { sessionIdSchema } from "@/lib/utils/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const rawSessionId = formData.get("sessionId");
    const parsedSessionId = sessionIdSchema.safeParse(rawSessionId);

    if (!parsedSessionId.success) {
      return fail("A valid sessionId is required.", 400);
    }

    const files = formData.getAll("files").filter((value): value is File => value instanceof File);
    const relativePaths = formData
      .getAll("relativePaths")
      .map((value) => String(value));

    if (!files.length) {
      return fail("At least one image file is required.", 400);
    }

    const result = await addFolderImagesToSession({
      sessionId: parsedSessionId.data,
      files,
      relativePaths
    });

    return ok(result);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to upload selected images.",
      400
    );
  }
}
