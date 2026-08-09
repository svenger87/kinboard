import { NextRequest, NextResponse } from "next/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { browse } from "@/lib/dlna-client";
import { readDlnaSettings } from "@/lib/dlna-settings";

/**
 * The containers inside one container — "albums", in the settings UI's terms.
 *
 * DLNA has no notion of an album: it has a folder tree, and every server
 * arranges it differently (MiniDLNA's "Pictures / Folders / ...", Jellyfin's
 * per-library roots). So this browses one level at a time and lets the owner
 * walk down, rather than pretending to know where the photos live.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const familyId = params.get("family_id");
  const objectId = params.get("object_id") || "0";

  if (!familyId) {
    return NextResponse.json({ error: "family_id is required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const settings = await readDlnaSettings(familyId);
  if (!settings?.control_url) {
    return NextResponse.json({ error: "DLNA is not configured" }, { status: 400 });
  }

  try {
    const { containers, items, totalMatches } = await browse(settings.control_url, objectId);
    // Photo count is what makes a folder worth picking, so it travels with
    // the container rather than needing a second browse per row.
    return NextResponse.json({
      containers,
      photoCount: items.length,
      totalMatches,
      objectId,
    });
  } catch (e) {
    console.error("[dlna] browse failed:", e);
    return NextResponse.json({ error: "browse failed" }, { status: 502 });
  }
}
