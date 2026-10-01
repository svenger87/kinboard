import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { logApiError } from "@/lib/api-error";
import { pendingActionRequests } from "@/lib/home/action-requests";
import { liveActionStore } from "@/lib/home/action-requests-live";
import { screenTranslator, withRooms } from "@/lib/home/action-requests-rooms";

export const dynamic = "force-dynamic";

/**
 * GET /api/assistant-actions — what assistants are waiting on a person for
 * (RFC-011 §4.3). The session's family only; requests that expired or whose
 * assistant was revoked are ended on the way and not listed. The screens
 * poll this and re-read it on every realtime change to the table.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const { familyId } = auth.session;
  try {
    const rows = await pendingActionRequests(familyId, { store: liveActionStore });
    return NextResponse.json({ requests: await withRooms(familyId, rows, screenTranslator(request)) });
  } catch (err) {
    await logApiError("assistant-actions", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
