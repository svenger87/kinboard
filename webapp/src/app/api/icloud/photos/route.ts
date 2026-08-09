import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { getSharedAlbumPhotos } from "@/lib/icloud-album";

interface IcloudSettings {
  token: string;
  album_name?: string;
}

/**
 * Photos from the family's shared album.
 *
 * The URLs are Apple's own, signed and short-lived — roughly an hour — so they
 * are handed to the browser rather than proxied or cached. They are https, so
 * there is no mixed-content problem to solve, and the client re-fetches this
 * list often enough that a URL never goes stale in place.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const familyId = params.get("family_id");
  const limit = Math.min(Number(params.get("limit") ?? 100) || 100, 500);

  if (!familyId) {
    return NextResponse.json({ error: "family_id is required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", "icloud")
    .maybeSingle();

  const settings = (data as { value: IcloudSettings | null } | null)?.value ?? null;
  if (!settings?.token) {
    return NextResponse.json({ photos: [] });
  }

  try {
    const { streamName, photos } = await getSharedAlbumPhotos(settings.token, limit);
    return NextResponse.json({ streamName, photos });
  } catch (e) {
    // An album whose sharing was switched off should empty the screensaver,
    // not fill the log with stack traces every rotation.
    console.warn("[icloud] album read failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ photos: [] });
  }
}
