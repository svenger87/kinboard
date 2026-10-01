import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import { RESTORE_TYPES, isRestoreType, restoreDeletedItem } from "@/lib/integration-recycle-bin";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/integration/v1/recycle-bin/{type}/{id}/restore
 *
 * Take a task, note, meal plan entry or birthday back out of the recycle
 * bin. Needs that type's own write scope (tasks:write, notes:write,
 * meals:write, birthdays:write), so a token that may only touch notes
 * cannot bring back a task. An unknown type still authenticates first, with
 * family:read, so an anonymous caller learns nothing from the answer.
 *
 * Restore only — there is no purge here (RFC-012 §4). A row that is missing,
 * another family's, or not deleted answers 404. Not subject to the
 * destructive-edit budget: it only ever puts something back. No
 * Idempotency-Key either: a repeat finds nothing in the bin and answers 404,
 * with nothing restored twice.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  const { type, id } = await params;
  const scope = isRestoreType(type) ? RESTORE_TYPES[type].scope : "family:read";

  return withIntegrationAuth(request, scope, async (context) => {
    if (!isRestoreType(type)) {
      return NextResponse.json({ error: `unknown type \`${type}\``, code: "not_found" }, { status: 404 });
    }
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `no such ${type} in the recycle bin`, code: "not_found" }, { status: 404 });
    }
    try {
      const restored = await restoreDeletedItem(context.familyId, type, id);
      if (!restored) {
        return NextResponse.json(
          { error: `no such ${type} in the recycle bin (it may already have been restored)`, code: "not_found" },
          { status: 404 },
        );
      }
      return NextResponse.json({ ok: true, type, id });
    } catch (err) {
      await logApiError("integration/recycle-bin/restore", err);
      return NextResponse.json({ error: `Could not restore the ${type}`, code: "internal_error" }, { status: 500 });
    }
  });
}
