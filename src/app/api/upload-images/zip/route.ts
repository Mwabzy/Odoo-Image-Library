import { addZipImagesToSession } from "@/lib/session/service";
import { fail, ok } from "@/lib/utils/http";
import { sessionIdSchema } from "@/lib/utils/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const rawSessionId = formData.get("sessionId");
    const file = formData.get("file");
    const parsedSessionId = sessionIdSchema.safeParse(rawSessionId);

    if (!parsedSessionId.success) {
      return fail("A valid sessionId is required.", 400);
    }

    if (!(file instanceof File)) {
      return fail("ZIP archive file is required.", 400);
    }

    const result = await addZipImagesToSession({
      sessionId: parsedSessionId.data,
      file
    });

    return ok(result);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to upload ZIP archive.",
      400
    );
  }
}
