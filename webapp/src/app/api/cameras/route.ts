import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { fetchSnapshot, isRtspUrl, withRtspCredentials } from "@/lib/go2rtc";
import { createHash } from "crypto";
import type { CameraSettings, CameraConfig } from "@/types/home-assistant";

// MD5 is required by RFC 7616 HTTP Digest authentication, which is the
// only auth method most IP cameras (Hikvision, Amcrest/Dahua, etc.)
// implement. We're not choosing MD5 for security — we're matching the
// camera firmware's protocol. The "password hashed insecurely" CodeQL
// finding is inherent to Digest-MD5 and cannot be remediated without
// breaking compatibility with every camera the project supports.
// CodeQL alerts dismissed: #4 (insufficient-password-hash) + #24
// (weak-cryptographic-algorithm).
function md5(str: string): string {
  return createHash("md5").update(str).digest("hex");
}

// Parse WWW-Authenticate header for digest auth
function parseDigestChallenge(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  const matches = Array.from(header.matchAll(/(\w+)=(?:"([^"]+)"|([^,\s]+))/g));
  for (const match of matches) {
    result[match[1]] = match[2] || match[3];
  }
  return result;
}

// Generate digest auth header
function generateDigestAuth(
  method: string,
  uri: string,
  username: string,
  password: string,
  challenge: Record<string, string>
): string {
  const { realm, nonce, qop, opaque } = challenge;
  const nc = "00000001";
  const cnonce = Math.random().toString(36).substring(2, 10);

  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);

  let response: string;
  if (qop) {
    response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
  } else {
    response = md5(`${ha1}:${nonce}:${ha2}`);
  }

  let authHeader = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
  if (qop) {
    authHeader += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  }
  if (opaque) {
    authHeader += `, opaque="${opaque}"`;
  }

  return authHeader;
}

// Fetch with digest authentication
async function fetchWithDigestAuth(
  url: string,
  username: string,
  password: string,
  signal?: AbortSignal
): Promise<Response> {
  // First request to get challenge
  const initialResponse = await fetch(url, {
    method: "GET",
    signal,
  });

  if (initialResponse.status !== 401) {
    return initialResponse;
  }

  const wwwAuth = initialResponse.headers.get("www-authenticate");
  if (!wwwAuth || !wwwAuth.toLowerCase().startsWith("digest")) {
    throw new Error("Server does not support digest auth");
  }

  const challenge = parseDigestChallenge(wwwAuth);
  const parsedUrl = new URL(url);
  const uri = parsedUrl.pathname + parsedUrl.search;

  const authHeader = generateDigestAuth("GET", uri, username, password, challenge);

  return fetch(url, {
    method: "GET",
    headers: {
      Authorization: authHeader,
    },
    signal,
  });
}

// GET: Proxy camera snapshot/stream
// Security: a device session for the family, plus a camera_id that family has
// configured and enabled. "Valid family_id" used to be the whole check, which
// meant a live view of someone else's front door for anyone holding an id
// that was never secret — and the proxy supplied their camera's credentials.
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const searchParams = request.nextUrl.searchParams;
  const familyId = searchParams.get("family_id");
  const cameraId = searchParams.get("camera_id");
  const type = searchParams.get("type") || "snapshot"; // snapshot or stream

  if (!familyId || !cameraId) {
    return NextResponse.json(
      { error: "family_id and camera_id are required" },
      { status: 400 }
    );
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // Get camera settings from Supabase
  const supabase = createAdminClient();
   
  const { data: settingsRow } = await (supabase as any)
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", "cameras")
    .single();

  if (!settingsRow?.value) {
    return NextResponse.json(
      { error: "No cameras configured" },
      { status: 404 }
    );
  }

  const cameraSettings = settingsRow.value as CameraSettings;
  const camera = cameraSettings.cameras?.find((c: CameraConfig) => c.id === cameraId);

  if (!camera) {
    return NextResponse.json(
      { error: "Camera not found" },
      { status: 404 }
    );
  }

  if (!camera.enabled) {
    return NextResponse.json(
      { error: "Camera is disabled" },
      { status: 403 }
    );
  }

  try {
    // Determine URL to fetch
    const url = type === "stream" ? camera.stream_url : (camera.snapshot_url || camera.stream_url);

    let response: Response;

    // A camera that is powered off but still answers ARP, or one behind a
    // dropped VPN, held these sockets open for the OS-level TCP timeout.
    // The thumbnail refreshes every 10s (2s fullscreen), so hung requests
    // accumulated faster than they retired. `fetchWithDigestAuth` has
    // taken a signal all along; nothing ever passed one.
    const signal = AbortSignal.timeout(10_000);

    // An rtsp:// URL is not something fetch() can open — it threw here, and
    // the tile said "Snapshot could not be loaded" for every correctly
    // configured RTSP camera. go2rtc speaks RTSP and hands back a JPEG.
    // Cameras that also publish an HTTP still image are unaffected: that URL
    // goes in the Snapshot URL field and is fetched directly, below.
    if (isRtspUrl(url)) {
      try {
        response = await fetchSnapshot(withRtspCredentials(url, camera.auth), signal);
      } catch (err) {
        // Not the camera — go2rtc itself is unreachable. Distinct from a
        // camera that won't answer, and a distinct thing to go and fix.
        console.error("go2rtc unreachable (check GO2RTC_URL / the go2rtc service):", err);
        return NextResponse.json(
          { error: "Streaming bridge unavailable" },
          { status: 502 },
        );
      }

      if (!response.ok) {
        // Log the reason — this is the only place it exists — but keep it
        // off the wire: the text can quote the URL, credentials and all.
        const detail = await response.text().catch(() => "");
        console.error(`Camera ${cameraId}: go2rtc returned ${response.status}`, detail);
        return NextResponse.json(
          { error: "Streaming bridge could not reach the camera" },
          { status: 502 },
        );
      }

      const frame = await response.arrayBuffer();

      // A camera that doesn't answer does NOT come back as an error status.
      // go2rtc returns 200 with an empty body and no content-type — measured
      // at ~5s against an unroutable address. Passing that straight through
      // would be a 200 carrying nothing, which the browser reports as a
      // broken image and the log doesn't mention at all.
      if (frame.byteLength === 0) {
        console.error(
          `Camera ${cameraId}: go2rtc returned an empty frame — camera unreachable, or the stream path is wrong`,
        );
        return NextResponse.json(
          { error: "Streaming bridge could not reach the camera" },
          { status: 502 },
        );
      }

      return new NextResponse(frame, {
        status: 200,
        headers: {
          "Content-Type": response.headers.get("content-type") || "image/jpeg",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    }

    if (camera.auth) {
      if (camera.auth.type === "digest") {
        response = await fetchWithDigestAuth(
          url,
          camera.auth.username,
          camera.auth.password,
          signal,
        );
      } else {
        // Basic auth
        const authHeader = Buffer.from(`${camera.auth.username}:${camera.auth.password}`).toString("base64");
        response = await fetch(url, {
          headers: {
            Authorization: `Basic ${authHeader}`,
          },
          signal,
        });
      }
    } else {
      response = await fetch(url, { signal });
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: `Camera returned ${response.status}` },
        { status: response.status }
      );
    }

    // For MJPEG streams, we need to stream the response
    if (type === "stream" && camera.stream_type === "mjpeg") {
      const headers = new Headers();
      const contentType = response.headers.get("content-type");
      if (contentType) {
        headers.set("Content-Type", contentType);
      }
      headers.set("Cache-Control", "no-cache, no-store, must-revalidate");

      return new NextResponse(response.body, {
        status: 200,
        headers,
      });
    }

    // For snapshots, return the image
    const imageBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/jpeg";

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    console.error("Camera proxy error:", err);
    return NextResponse.json(
      { error: "Failed to fetch from camera" },
      { status: 500 }
    );
  }
}
