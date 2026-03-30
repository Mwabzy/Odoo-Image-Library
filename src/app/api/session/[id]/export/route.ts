import { generateSessionExport } from "@/lib/session/service";
import { fail } from "@/lib/utils/http";
import { exportSchema, sessionIdSchema } from "@/lib/utils/schemas";

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

    const body = await request.json().catch(() => ({}));
    const parsedBody = exportSchema.safeParse(body);

    if (!parsedBody.success) {
      return fail("Invalid export payload.", 400, parsedBody.error.flatten());
    }

    const exportResult = await generateSessionExport({
      sessionId: parsedId.data,
      format: parsedBody.data.format
    });

    return new Response(new Uint8Array(exportResult.buffer), {
      status: 200,
      headers: {
        "Content-Type": exportResult.contentType,
        "Content-Disposition": `attachment; filename="${exportResult.fileName}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to export session.",
      400
    );
  }
}
