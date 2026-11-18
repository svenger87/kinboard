import { NextRequest, NextResponse } from "next/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { parseAlbumLink, fetchAlbum, fetchCloudKitPhotos } from "@/lib/icloud-album";

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

  const parsed = parseAlbumLink(body.link);
  if (!parsed) {
    return NextResponse.json({ ok: false, error: "not_an_icloud_link" }, { status: 200 });
  }

  try {
    if (parsed.format === "cloudkit") {
      // CloudKit pages through the album, so the check stops at a cap rather
      // than fetching every photo; at the cap the count is "more than".
      const CHECK_CAP = 500;
      const { streamName, photos } = await fetchCloudKitPhotos(parsed.token, CHECK_CAP);
      return NextResponse.json({
        ok: true,
        token: parsed.token,
        format: parsed.format,
        streamName,
        photoCount: photos.length,
        photoCountCapped: photos.length >= CHECK_CAP,
      });
    }
    const album = await fetchAlbum(parsed.token);
    return NextResponse.json({
      ok: true,
      token: parsed.token,
      format: parsed.format,
      streamName: album.streamName,
      photoCount: album.photos.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unreachable";
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
