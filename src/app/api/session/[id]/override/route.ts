import { overrideSessionMatch } from "@/lib/session/service";
import { fail, ok } from "@/lib/utils/http";
import { overrideSchema, sessionIdSchema } from "@/lib/utils/schemas";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsedId = sessionIdSchema.safeParse(id);

    if (!parsedId.success) {
      return fail("Invalid session id.", 400);
    }

    const body = await request.json();
    const parsedBody = overrideSchema.safeParse(body);

    if (!parsedBody.success) {
      return fail("Invalid override payload.", 400, parsedBody.error.flatten());
    }

    const result = await overrideSessionMatch({
      sessionId: parsedId.data,
      sheetRowId: parsedBody.data.sheetRowId,
      imageId: parsedBody.data.imageId
    });

    return ok(result);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to apply override.",
      400
    );
  }
}
