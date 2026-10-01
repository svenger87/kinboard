import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import { RESTORE_TYPE_NAMES, isRestoreType, listDeletedItems } from "@/lib/integration-recycle-bin";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/recycle-bin?type=task|note|meal|birthday
 *
 * What the family deleted that is still in the recycle bin, of the kinds an
 * assistant can delete — tasks, notes, meal plan entries and birthdays —
 * newest deletion first, at most 50. `type` narrows it to one kind.
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    const type = request.nextUrl.searchParams.get("type");
    if (type !== null && !isRestoreType(type)) {
      return NextResponse.json(
        { error: `type must be one of ${RESTORE_TYPE_NAMES.join(", ")}`, code: "invalid_request" },
        { status: 400 },
      );
    }
    try {
      const items = await listDeletedItems(context.familyId, type);
      return NextResponse.json({ items });
    } catch (err) {
      await logApiError("integration/recycle-bin/list", err);
      return NextResponse.json({ error: "Could not read the recycle bin", code: "internal_error" }, { status: 500 });
    }
  });
}
