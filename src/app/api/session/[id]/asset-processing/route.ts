import { processQueuedAssetJobs } from "@/lib/session/service";
import { fail, ok } from "@/lib/utils/http";
import { sessionIdSchema } from "@/lib/utils/schemas";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const parsed = sessionIdSchema.safeParse(params.id);

    if (!parsed.success) {
      return fail("Invalid session id.", 400);
    }

    const result = await processQueuedAssetJobs(parsed.data);
    return ok(result);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to process asset jobs.",
      400
    );
  }
}
