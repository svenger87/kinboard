import { NextRequest, NextResponse } from "next/server";
import { getStoredSecrets } from "@/lib/integration-secrets";

// GET /api/calendar/feed/status?family_id=<uuid> → { enabled: boolean }
// Lets the settings UI reflect feed state across reloads without ever
// returning the token itself (the token is server-only, mirrored nowhere
// client-readable).
export async function GET(request: NextRequest) {
  const familyId = request.nextUrl.searchParams.get("family_id");

  if (!familyId) {
    return NextResponse.json({ error: "family_id is required" }, { status: 400 });
  }

  const stored = await getStoredSecrets(familyId, "calendar_feed");
  return NextResponse.json({ enabled: typeof stored?.token === "string" && stored.token.length > 0 });
}
