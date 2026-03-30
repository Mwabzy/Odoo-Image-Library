import { processSessionById } from "@/lib/session/service";
import { fail, ok } from "@/lib/utils/http";
import { processSessionSchema } from "@/lib/utils/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = processSessionSchema.safeParse(body);

    if (!parsed.success) {
      return fail("Invalid processing payload.", 400, parsed.error.flatten());
    }

    const result = await processSessionById(parsed.data.sessionId);
    return ok(result);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to process session.",
      400
    );
  }
}
