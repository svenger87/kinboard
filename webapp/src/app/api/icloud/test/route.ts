import { NextRequest, NextResponse } from "next/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { parseAlbumToken, fetchAlbum } from "@/lib/icloud-album";

/**
 * Check a shared-album link before saving it.
 *
 * The common failure is not a typo: it is an album whose "Public Website"
 * switch is off, which looks identical to a wrong link from the outside. The
 * error text says which, because the fix is on the owner's phone.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    family_id?: string;
    link?: string;
  };

  if (!body.family_id || !body.link) {
    return NextResponse.json({ error: "family_id and link are required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, body.family_id)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const token = parseAlbumToken(body.link);
  if (!token) {
    return NextResponse.json({ ok: false, error: "not_an_icloud_link" }, { status: 200 });
  }

  try {
    const album = await fetchAlbum(token);
    return NextResponse.json({
      ok: true,
      token,
      streamName: album.streamName,
      photoCount: album.photos.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unreachable";
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
