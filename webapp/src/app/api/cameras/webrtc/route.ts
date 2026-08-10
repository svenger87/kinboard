import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { webrtcUrl, withRtspCredentials } from "@/lib/go2rtc";
import type { CameraSettings, CameraConfig } from "@/types/home-assistant";

// Check if IP is a private/LAN address
function isPrivateIP(ip: string): boolean {
  // Remove IPv6 prefix if present
  const cleanIp = ip.replace(/^::ffff:/, "");

  // Check for private IPv4 ranges
  const privateRanges = [
    /^10\./,                      // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
    /^192\.168\./,                // 192.168.0.0/16
    /^127\./,                     // localhost
    /^::1$/,                      // IPv6 localhost
    /^fd[0-9a-f]{2}:/i,          // IPv6 private
    /^fe80:/i,                    // IPv6 link-local
  ];

  return privateRanges.some(range => range.test(cleanIp));
}

// Get client IP from request headers
function getClientIP(request: NextRequest): string {
  // Check various headers set by reverse proxies
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // x-forwarded-for can contain multiple IPs, first one is the client
    return forwarded.split(",")[0].trim();
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  // Fallback - this might be the proxy IP
  return request.headers.get("x-client-ip") || "unknown";
}

// Map streams to their WAN-optimized variants
const WAN_STREAM_MAP: Record<string, string> = {
  "hikvision": "hikvision_wan",
  "amcrest_hd": "amcrest_wan",
  // amcrest (substream) is already low bandwidth, no mapping needed
};

/**
 * Look up one of the family's cameras. The family comes from the session, so
 * a caller cannot ask about somebody else's.
 */
async function loadCamera(familyId: string, cameraId: string): Promise<CameraConfig | null> {
  const supabase = createAdminClient();

  const { data: settingsRow } = await (supabase as any)
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", "cameras")
    .single();

  if (!settingsRow?.value) return null;

  const settings = settingsRow.value as CameraSettings;
  return settings.cameras?.find((c: CameraConfig) => c.id === cameraId) ?? null;
}

// Proxy WebRTC signaling to go2rtc to avoid CORS issues.
//
// Two ways in. `camera_id` is the one the viewer uses: the camera's own URL is
// read from the family's settings here, on the server, so an RTSP camera can
// be played live without its credentials ever reaching the browser — and
// without this route becoming somewhere a caller can name an arbitrary host
// and have go2rtc dial it. `src` is the older form, naming a stream defined in
// go2rtc.yaml; it stays for installations already configured that way.
//
// Both are behind a session. The `src` form used to be open on the argument
// that stream names are unguessable, which they are not — the names shipped in
// the example config are `hikvision` and `amcrest`.
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const searchParams = request.nextUrl.searchParams;
  const cameraId = searchParams.get("camera_id");
  let src = searchParams.get("src");

  if (cameraId) {
    const camera = await loadCamera(auth.session.familyId, cameraId);

    if (!camera) {
      return NextResponse.json({ error: "Camera not found" }, { status: 404 });
    }
    if (!camera.enabled) {
      return NextResponse.json({ error: "Camera is disabled" }, { status: 403 });
    }

    src = withRtspCredentials(camera.stream_url, camera.auth);
  } else if (!src) {
    return NextResponse.json(
      { error: "camera_id or src is required" },
      { status: 400 }
    );
  }

  // Detect client location and use appropriate stream
  const clientIP = getClientIP(request);
  const isLAN = isPrivateIP(clientIP);

  // Switch to WAN-optimized stream if client is on WAN. Named streams only —
  // a camera_id resolves to one URL and there is no second one to swap to.
  if (!cameraId && !isLAN && WAN_STREAM_MAP[src]) {
    const originalSrc = src;
    src = WAN_STREAM_MAP[src];
    console.log(`[WebRTC Proxy] WAN client (${clientIP}), switching ${originalSrc} → ${src}`);
  } else {
    console.log(
      `[WebRTC Proxy] ${isLAN ? "LAN" : "WAN"} client (${clientIP}), using ${cameraId ? `camera ${cameraId}` : src}`,
    );
  }

  try {
    const body = await request.json();

    // go2rtc URL — set via GO2RTC_URL env var. In the bundled compose
    // stack, this resolves to http://go2rtc:1984 over the internal
    // Docker network.
    const targetUrl = webrtcUrl(src);

    // Deliberately not logged: for a camera_id the src is an RTSP URL with
    // the camera's password in it.
    console.log("[WebRTC Proxy] POST → go2rtc");

    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    const responseText = await response.text();

    // go2rtc quotes the source it failed on, and for a camera_id that source
    // is an RTSP URL with a password in it — likewise a fetch error, whose
    // message carries the URL it was calling. Both go to the log, where the
    // detail is worth having; neither goes back to the browser.
    if (!response.ok) {
      console.error(`[WebRTC Proxy] Error ${response.status}: ${responseText}`);
      return NextResponse.json(
        { error: `Streaming bridge returned ${response.status}` },
        { status: response.status }
      );
    }

    // Try to parse as JSON, go2rtc returns JSON for successful responses
    try {
      const answer = JSON.parse(responseText);
      return NextResponse.json(answer);
    } catch {
      // If not JSON, return the text as error
      console.error(`[WebRTC Proxy] Invalid JSON response: ${responseText}`);
      return NextResponse.json(
        { error: "Invalid response from the streaming bridge" },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("[WebRTC Proxy] Error:", err);
    return NextResponse.json(
      { error: "Failed to connect to the streaming bridge" },
      { status: 500 }
    );
  }
}
