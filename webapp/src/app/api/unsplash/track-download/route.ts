import { NextResponse } from "next/server";
import { getMergedSetting } from "@/lib/integration-secrets";

interface UnsplashSettings {
  access_key?: string;
}

/**
 * Report a display event to Unsplash.
 *
 * Their API guidelines require it: "When your application performs something
 * similar to a download (like when a user chooses the image to include in a
 * blog post, set as a header, etc.), you must send a request to the download
 * endpoint returned under the `photo.links.download_location` property."
 *
 * Showing a photo as the screensaver's wallpaper is that event, and Kinboard
 * has never sent it. The call is what tells a photographer their work was
 * used — it's how Unsplash counts downloads for the people whose photos this
 * is showing.
 *
 * It runs server-side because the access key has to stay there, and it is
 * deliberately fire-and-forget: this reports something that already happened,
 * so a failure must never affect what the screensaver does next.
 */
const ALLOWED_HOST = "api.unsplash.com";

export async function POST(request: Request) {
  let body: { family_id?: string; download_location?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { family_id: familyId, download_location: downloadLocation } = body;
  if (!familyId || !downloadLocation) {
    return NextResponse.json(
      { error: "family_id and download_location are required" },
      { status: 400 },
    );
  }

  // Same reasoning as the image proxy: this URL comes from the client, so it
  // is pinned to the host Unsplash actually serves it from. The download
  // location is a real Unsplash API URL and nothing else gets fetched here.
  let target: URL;
  try {
    target = new URL(downloadLocation);
  } catch {
    return NextResponse.json({ error: "download_location is not a URL" }, { status: 400 });
  }
  if (target.protocol !== "https:" || target.hostname !== ALLOWED_HOST) {
    return NextResponse.json({ error: "download_location is not an Unsplash URL" }, { status: 400 });
  }

  const settings = await getMergedSetting<UnsplashSettings>(familyId, "unsplash");
  if (!settings?.access_key) {
    return NextResponse.json({ error: "Unsplash not configured" }, { status: 401 });
  }

  const upstream = new URL(`https://${ALLOWED_HOST}`);
  upstream.pathname = target.pathname;
  upstream.search = target.search;

  try {
    const res = await fetch(upstream.href, {
      headers: {
        Authorization: `Client-ID ${settings.access_key}`,
        "Accept-Version": "v1",
      },
      signal: AbortSignal.timeout(10_000),
      redirect: "manual",
    });
    // Report the outcome but don't dress a failure up as an error the client
    // should act on — there is nothing useful for it to do about one.
    return NextResponse.json({ ok: res.ok, status: res.status });
  } catch (err) {
    console.warn("[unsplash/track-download] failed:", err);
    return NextResponse.json({ ok: false });
  }
}
