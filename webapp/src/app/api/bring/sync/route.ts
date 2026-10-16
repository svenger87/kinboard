import { NextRequest, NextResponse } from "next/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { BringAuthError } from "@/lib/bring-server";
import { syncBringFamily } from "@/lib/bring-sync";

export const dynamic = "force-dynamic";

/**
 * Read the family's Bring! list into its shopping list now: "Sync now" in
 * Settings → Bring!, and the shopping page when it opens. Runs whatever
 * "Auto sync" is set to — that switch is about the background poll.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  let familyId: unknown;
  try {
    ({ family_id: familyId } = await request.json());
  } catch {
    familyId = undefined;
  }
  if (typeof familyId !== "string" || !familyId) {
    return NextResponse.json({ error: "family_id is required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  try {
    return NextResponse.json(await syncBringFamily(familyId));
  } catch (err) {
    if (err instanceof BringAuthError) {
      return NextResponse.json({ error: "Token expired" }, { status: 401 });
    }
    console.error("Bring sync error:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
