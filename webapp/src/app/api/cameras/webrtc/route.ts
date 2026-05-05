import { NextRequest, NextResponse } from "next/server";

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

// Proxy WebRTC signaling to go2rtc to avoid CORS issues
// Security: go2rtc is only accessible from within Docker network
// Stream names must be known to access (defined in go2rtc.yaml)
export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  let src = searchParams.get("src");

  if (!src) {
    return NextResponse.json(
      { error: "src parameter is required" },
      { status: 400 }
    );
  }

  // Detect client location and use appropriate stream
  const clientIP = getClientIP(request);
  const isLAN = isPrivateIP(clientIP);

  // Switch to WAN-optimized stream if client is on WAN
  if (!isLAN && WAN_STREAM_MAP[src]) {
    const originalSrc = src;
    src = WAN_STREAM_MAP[src];
    console.log(`[WebRTC Proxy] WAN client (${clientIP}), switching ${originalSrc} → ${src}`);
  } else {
    console.log(`[WebRTC Proxy] ${isLAN ? "LAN" : "WAN"} client (${clientIP}), using ${src}`);
  }

  try {
    const body = await request.json();

    // go2rtc URL — set via GO2RTC_URL env var. In the bundled compose
    // stack, this resolves to http://go2rtc:1984 over the internal
    // Docker network.
    const go2rtcUrl = process.env.GO2RTC_URL || "http://go2rtc:1984";
    const targetUrl = `${go2rtcUrl}/api/webrtc?src=${src}`;

    console.log(`[WebRTC Proxy] POST ${targetUrl}`);

    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(`[WebRTC Proxy] Error ${response.status}: ${responseText}`);
      return NextResponse.json(
        { error: `go2rtc error: ${response.status} - ${responseText}` },
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
        { error: `Invalid response from go2rtc: ${responseText}` },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("[WebRTC Proxy] Error:", err);
    return NextResponse.json(
      { error: `Failed to connect to go2rtc: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
