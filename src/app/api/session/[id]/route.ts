import { discardSession, getSessionSummary } from "@/lib/session/service";
import { fail, ok } from "@/lib/utils/http";
import { sessionIdSchema } from "@/lib/utils/schemas";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = sessionIdSchema.safeParse(id);

    if (!parsed.success) {
      return fail("Invalid session id.", 400);
    }

    const result = await getSessionSummary(parsed.data);
    return ok(result);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to load session.",
      404
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = sessionIdSchema.safeParse(id);

    if (!parsed.success) {
      return fail("Invalid session id.", 400);
    }

    const result = await discardSession(parsed.data);
    return ok(result);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to discard session.",
      400
    );
  }
}
