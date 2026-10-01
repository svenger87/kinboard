import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { destructiveLimitResponse } from "@/lib/integration-limits";
import { logApiError } from "@/lib/api-error";
import { familyDateKey, familyTimeZone } from "@/lib/family-time";
import { deleteBirthday, isUuid, updateBirthday } from "@/lib/integration-birthdays";

export const dynamic = "force-dynamic";

/**
 * PATCH/DELETE /api/integration/v1/birthdays/{id}
 *
 * Edit or delete one birthday — `birthdays:write`, behind the assistant
 * edit/delete budget like every other Integration API PATCH and DELETE.
 * A birthday that is missing, in the recycle bin or another family's is 404;
 * lib/integration-birthdays.ts makes the admin client and scopes every
 * statement by family and `deleted_at IS NULL` itself, because that client
 * bypasses RLS (e2e/integration-birthdays.spec.ts holds it with a fake).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withIntegrationAuth(request, "birthdays:write", async (context) => {
    const limited = destructiveLimitResponse(context);
    if (limited) return limited;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "no such birthday", code: "not_found" }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown> : {};
    } catch {
      body = {};
    }

    try {
      const today = familyDateKey(new Date(), await familyTimeZone(context.familyId));
      const result = await updateBirthday(context.familyId, id, body, today);
      return NextResponse.json(result.response, { status: result.status });
    } catch (err) {
      await logApiError("integration/birthdays/update", err);
      return NextResponse.json({ error: "Could not update the birthday", code: "internal_error" }, { status: 500 });
    }
  });
}

/**
 * Into the recycle bin, as deleting one on the birthdays page does;
 * restore_birthday / POST /recycle-bin/birthday/{id}/restore takes it back
 * out. A second delete of the same id is 404, never a purge.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withIntegrationAuth(request, "birthdays:write", async (context) => {
    const limited = destructiveLimitResponse(context);
    if (limited) return limited;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "no such birthday", code: "not_found" }, { status: 404 });
    }

    try {
      const deleted = await deleteBirthday(context.familyId, id);
      if (!deleted) {
        return NextResponse.json({ error: "no such birthday", code: "not_found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, id });
    } catch (err) {
      await logApiError("integration/birthdays/delete", err);
      return NextResponse.json({ error: "Could not delete the birthday", code: "internal_error" }, { status: 500 });
    }
  });
}
