import { NextRequest, NextResponse } from "next/server";
import { getStoredSecrets } from "@/lib/integration-secrets";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

// GET /api/calendar/feed/status?family_id=<uuid> → { enabled: boolean }
// Lets the settings UI reflect feed state across reloads without ever
// returning the token itself (the token is server-only, mirrored nowhere
// client-readable).
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const familyId = request.nextUrl.searchParams.get("family_id");

  if (!familyId) {
    return NextResponse.json({ error: "family_id is required" }, { status: 400 });
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const stored = await getStoredSecrets(familyId, "calendar_feed");
  return NextResponse.json({ enabled: typeof stored?.token === "string" && stored.token.length > 0 });
}
