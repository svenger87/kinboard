import { NextRequest, NextResponse } from "next/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { browse, reachableMediaUrl, type DlnaItem } from "@/lib/dlna-client";
import { readDlnaSettings, signImageUrl } from "@/lib/dlna-settings";

/** Fisher-Yates, so `random` genuinely shuffles rather than sorting by chance. */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Photos from the configured container, shaped like the Immich route's output
 * so the screensaver treats the two sources the same.
 *
 * The image URLs are rewritten to point at /api/dlna/image. A DLNA server
 * speaks http, a wall display is often on https, and the browser blocks that
 * mix silently — so the bytes come back through Kinboard.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const familyId = params.get("family_id");
  const limit = Math.min(Number(params.get("limit") ?? 50) || 50, 500);
  const random = params.get("random") === "true";
  const containerOverride = params.get("object_id");

  if (!familyId) {
    return NextResponse.json({ error: "family_id is required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const settings = await readDlnaSettings(familyId);
  if (!settings?.control_url) {
    return NextResponse.json({ photos: [] });
  }

  const objectId = containerOverride || settings.selected_container || "0";

  try {
    // Ask for more than we need when shuffling, so "random" draws from the
    // album rather than from whichever page the server returned first.
    const requestedCount = random ? Math.max(limit * 4, 200) : limit;
    const { items } = await browse(settings.control_url, objectId, { requestedCount });

    const ordered = random ? shuffle(items) : items;
    // Signed, not host-pinned: a media server advertises whichever address it
    // detected for itself, which is routinely not the one we reached it on.
    const proxied = (target: string) =>
      `/api/dlna/image?family_id=${encodeURIComponent(familyId)}` +
      `&item=${encodeURIComponent(target)}` +
      `&sig=${encodeURIComponent(signImageUrl(familyId, target))}`;

    const control = settings.control_url;
    const photos = ordered.slice(0, limit).map((item: DlnaItem) => ({
      id: item.id,
      title: item.title,
      url: proxied(reachableMediaUrl(item.url, control)),
      thumbnailUrl: item.thumbnailUrl
        ? proxied(reachableMediaUrl(item.thumbnailUrl, control))
        : null,
      mimeType: item.mimeType,
      resolution: item.resolution,
      date: item.date,
    }));

    return NextResponse.json({ photos });
  } catch (e) {
    console.error("[dlna] photos failed:", e);
    return NextResponse.json({ error: "browse failed" }, { status: 502 });
  }
}
