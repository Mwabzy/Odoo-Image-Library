import { getSessionMatches } from "@/lib/session/service";
import { fail, ok } from "@/lib/utils/http";
import { matchQuerySchema, sessionIdSchema } from "@/lib/utils/schemas";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsedId = sessionIdSchema.safeParse(id);

    if (!parsedId.success) {
      return fail("Invalid session id.", 400);
    }

    const searchParams = new URL(request.url).searchParams;
    const parsedQuery = matchQuerySchema.safeParse({
      page: searchParams.get("page") ?? "1",
      pageSize: searchParams.get("pageSize") ?? "50",
      filter: searchParams.get("filter") ?? "all"
    });

    if (!parsedQuery.success) {
      return fail("Invalid matches query.", 400, parsedQuery.error.flatten());
    }

    const result = await getSessionMatches({
      sessionId: parsedId.data,
      filter: parsedQuery.data.filter,
      page: parsedQuery.data.page,
      pageSize: parsedQuery.data.pageSize
    });

    return ok(result);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to load matches.",
      400
    );
  }
}
