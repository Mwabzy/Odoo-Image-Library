import { createSessionFromSheet } from "@/lib/session/service";
import { fail, ok } from "@/lib/utils/http";
import { uploadSheetSchema } from "@/lib/utils/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const parsed = uploadSheetSchema.safeParse({
      pathMode: formData.get("pathMode") ?? "auto"
    });

    if (!parsed.success) {
      return fail("Invalid path mode selection.", 400, parsed.error.flatten());
    }

    if (!(file instanceof File)) {
      return fail("Spreadsheet file is required.", 400);
    }

    const result = await createSessionFromSheet({
      file,
      pathMode: parsed.data.pathMode
    });

    return ok(result);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to upload spreadsheet.",
      400
    );
  }
}
