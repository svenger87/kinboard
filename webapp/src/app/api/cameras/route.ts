import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
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
// Security: Requires valid family_id and camera_id, camera must be enabled
export async function GET(request: NextRequest) {
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

    if (camera.auth) {
      if (camera.auth.type === "digest") {
        response = await fetchWithDigestAuth(url, camera.auth.username, camera.auth.password);
      } else {
        // Basic auth
        const authHeader = Buffer.from(`${camera.auth.username}:${camera.auth.password}`).toString("base64");
        response = await fetch(url, {
          headers: {
            Authorization: `Basic ${authHeader}`,
          },
        });
      }
    } else {
      response = await fetch(url);
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
