import { NextRequest, NextResponse } from "next/server";
import { getMergedSetting } from "@/lib/integration-secrets";
import type { HomeAssistantSettings } from "@/types/home-assistant";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

// GET: Proxy camera image/stream from Home Assistant
// Proxies the household's own Home Assistant with the token stored for that
// family — see the note in ../route.ts.
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const searchParams = request.nextUrl.searchParams;
  const familyId = searchParams.get("family_id");
  const entityId = searchParams.get("entity_id");
  const type = searchParams.get("type") || "snapshot"; // "snapshot" or "stream"

  if (!familyId || !entityId) {
    return NextResponse.json(
      { error: "family_id and entity_id are required" },
      { status: 400 }
    );
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // The entity id is interpolated straight into the path of a request that
  // carries the family's Home Assistant token. Unchecked, a value like
  // "../../states" walks out of /api/camera_proxy/ and reaches other Home
  // Assistant endpoints with those credentials — the host can't be changed
  // (it comes from PIN-protected settings) but the path could be.
  //
  // Home Assistant entity ids are `domain.object_id`, lowercase alphanumerics
  // and underscores. Anything else is not an entity id.
  if (!/^[a-z0-9_]+\.[a-z0-9_]+$/.test(entityId)) {
    return NextResponse.json({ error: "invalid entity_id" }, { status: 400 });
  }

  // Get Home Assistant settings (with secrets merged in) from Supabase
  const haSettings = await getMergedSetting<HomeAssistantSettings>(familyId, "home_assistant");

  if (!haSettings) {
    return NextResponse.json(
      { error: "Home Assistant not configured" },
      { status: 401 }
    );
  }

  if (!haSettings.url || !haSettings.access_token) {
    return NextResponse.json(
      { error: "Home Assistant URL or access token not configured" },
      { status: 401 }
    );
  }

  try {
    // Use camera_proxy for snapshots, camera_proxy_stream for MJPEG
    const endpoint = type === "stream"
      ? `${haSettings.url}/api/camera_proxy_stream/${entityId}`
      : `${haSettings.url}/api/camera_proxy/${entityId}`;

    const isStream = type === "stream";

    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${haSettings.access_token}`,
      },
      // A snapshot must not hang forever on a camera that is powered off
      // but still answers. A stream, by definition, never completes — so
      // the timeout applies only to getting the response headers back for
      // one, and the body is passed through rather than awaited.
      signal: isStream
        ? AbortSignal.timeout(15_000)
        : AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error("Camera proxy error:", response.status);
      return NextResponse.json(
        { error: "Failed to fetch camera image" },
        { status: response.status }
      );
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";

    // camera_proxy_stream is multipart/x-mixed-replace: it never ends, so
    // arrayBuffer() never resolved. "Start stream" showed a blank frame
    // forever while the container's memory climbed by the camera's full
    // bitrate until the OOM killer took it — and closing the dialog did
    // not stop the download. Streams are piped straight through, which is
    // what the sibling /api/cameras proxy already does for MJPEG.
    if (isStream) {
      return new NextResponse(response.body, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-store",
        },
      });
    }

    const imageBuffer = await response.arrayBuffer();

    return new NextResponse(imageBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    console.error("Error fetching camera image:", err);
    return NextResponse.json(
      { error: "Failed to fetch camera image" },
      { status: 500 }
    );
  }
}
