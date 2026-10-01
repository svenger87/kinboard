import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  clampSnapshotWidth,
  isRtspUrl,
  withRtspCredentials,
  snapshotUrl,
  webrtcUrl,
} from "../src/lib/go2rtc";
import { inboundVideoBytes, showsLivePill } from "../src/lib/camera-live";

/**
 * The camera form has offered "RTSP" as a stream type since the first
 * release, and picking it could never work: the snapshot proxy took the URL
 * and called `fetch()` on it. Node has no rtsp:// handler, so it threw for
 * every correctly configured camera, and the tile said "Snapshot could not be
 * loaded" — which reads as "your URL is wrong" and sent at least one person
 * away checking a URL that was fine.
 *
 * So the first test here is the bug itself, still asserted: if `fetch()` ever
 * learns rtsp:// this file should be revisited, and until then the assertion
 * is the reason the go2rtc branch has to exist.
 */
test("fetch() cannot open an rtsp:// URL — the reason go2rtc is in the path", async () => {
  await expect(
    fetch("rtsp://192.0.2.10:554/Streaming/Channels/101"),
  ).rejects.toThrow();
});

test("rtsp and rtsps are recognised, http is left alone", () => {
  expect(isRtspUrl("rtsp://10.0.0.5:554/live")).toBe(true);
  expect(isRtspUrl("RTSP://10.0.0.5/live")).toBe(true);
  expect(isRtspUrl("rtsps://10.0.0.5/live")).toBe(true);
  expect(isRtspUrl("  rtsp://10.0.0.5/live")).toBe(true);

  // A camera with an HTTP still image keeps the direct path, digest auth
  // and all — go2rtc is for the streams it is needed for.
  expect(isRtspUrl("http://10.0.0.5/snapshot.jpg")).toBe(false);
  expect(isRtspUrl("https://10.0.0.5/ISAPI/Streaming/channels/101/picture")).toBe(false);
});

test("credentials from the auth fields are used when the URL has none", () => {
  const withAuth = withRtspCredentials("rtsp://10.0.0.5:554/live", {
    username: "admin",
    password: "hunter2",
  });
  expect(withAuth).toBe("rtsp://admin:hunter2@10.0.0.5:554/live");
});

test("a URL that already carries credentials is not rewritten", () => {
  // Re-encoding this would corrupt passwords containing % or @ — the exact
  // characters people are told to percent-encode by hand.
  const original = "rtsp://admin:p%40ss@10.0.0.5:554/live";
  expect(withRtspCredentials(original, { username: "other", password: "x" })).toBe(original);
  expect(withRtspCredentials(original, undefined)).toBe(original);
});

test("a password with URL-significant characters survives injection", () => {
  const url = withRtspCredentials("rtsp://10.0.0.5/live", {
    username: "admin",
    password: "p@ss:w/rd",
  });
  // Encoded going in, and the same string coming back out.
  const parsed = new URL(url);
  expect(decodeURIComponent(parsed.password)).toBe("p@ss:w/rd");
  expect(parsed.hostname).toBe("10.0.0.5");
});

test("the source is encoded into the go2rtc query, not concatenated", () => {
  const src = "rtsp://admin:p@ss@10.0.0.5:554/cam?channel=1&subtype=0";

  // "?" and "&" in a camera path used to end the query string early — the
  // Amcrest URL scheme is full of them.
  const snap = new URL(snapshotUrl(src));
  expect(snap.searchParams.get("src")).toBe(src);
  expect(snap.pathname).toBe("/api/frame.jpeg");

  const rtc = new URL(webrtcUrl(src));
  expect(rtc.searchParams.get("src")).toBe(src);
  expect(rtc.pathname).toBe("/api/webrtc");
});

/**
 * A 4K camera's full frame is ~700 KB of JPEG, sent every 5 seconds per tile
 * per viewer, to be drawn into a box a few hundred pixels wide. Measured on
 * a real Amcrest at 3840x2160: 696 KB unscaled, 44 KB at width=640, for the
 * same server-side decode cost. That is the whole reason this parameter
 * exists — the saving is transfer and browser decode, not go2rtc's work.
 */
test("a width is passed to go2rtc, and omitted when not asked for", () => {
  const src = "rtsp://10.0.0.5:554/live";

  expect(new URL(snapshotUrl(src, 640)).searchParams.get("width")).toBe("640");
  // No width means "whatever the camera sends" — unchanged behaviour.
  expect(new URL(snapshotUrl(src)).searchParams.has("width")).toBe(false);
});

test("the width is clamped rather than trusted", () => {
  // It arrives in a query string, so a caller can ask for anything.
  expect(clampSnapshotWidth("640")).toBe(640);
  expect(clampSnapshotWidth("999999")).toBe(3840);
  expect(clampSnapshotWidth("1")).toBe(64);
  expect(clampSnapshotWidth("640.7")).toBe(640);

  // Absent or nonsense means "don't scale", not "scale to zero".
  expect(clampSnapshotWidth(null)).toBeUndefined();
  expect(clampSnapshotWidth("")).toBeUndefined();
  expect(clampSnapshotWidth("wide")).toBeUndefined();
  expect(clampSnapshotWidth("-100")).toBeUndefined();
  expect(clampSnapshotWidth("0")).toBeUndefined();
});

/**
 * An RTSP URL is a credential. It goes from the server to go2rtc and stops
 * there — go2rtc quotes the source it failed on in its error text, and that
 * text used to be forwarded to the browser verbatim.
 */
test("neither camera route returns the streaming bridge's error text to the browser", () => {
  const routes = [
    "src/app/api/cameras/route.ts",
    "src/app/api/cameras/webrtc/route.ts",
  ];

  // Counting parens rather than matching a regex: an error body is full of
  // `${...}` and any [^}] pattern stops at the first one, which is how the
  // first version of this test passed while the leak was still there.
  const responseBodies = (source: string): string[] => {
    const bodies: string[] = [];
    const marker = "NextResponse.json(";

    for (let at = source.indexOf(marker); at !== -1; at = source.indexOf(marker, at + 1)) {
      let depth = 0;
      for (let i = at + marker.length - 1; i < source.length; i++) {
        if (source[i] === "(") depth++;
        else if (source[i] === ")" && --depth === 0) {
          bodies.push(source.slice(at, i + 1));
          break;
        }
      }
    }
    return bodies;
  };

  for (const route of routes) {
    const bodies = responseBodies(readFileSync(join(process.cwd(), route), "utf8"));
    expect(bodies.length).toBeGreaterThan(3);

    // Everything go2rtc says goes to console.error. None of it is
    // interpolated into a response the browser will read.
    for (const body of bodies) {
      expect(body).not.toMatch(/responseText|\bdetail\b|err instanceof Error/);
    }
  }
});

/**
 * The tile said LIVE twice when it was not. The pill only checked that
 * nothing was loading, so it sat on the refreshing still an RTSP camera
 * starts on. And the tile switched to video the moment ICE connected, which
 * for a browser that cannot take the camera's video codec is a connection
 * carrying audio alone: a black box, marked LIVE, that never drew a frame.
 * Found on a wall tablet whose Chrome had no H.265, watching an H.265 camera.
 */
test("the refreshing still of an RTSP camera is not labelled LIVE", () => {
  const base = { streamType: "rtsp" as const, isLoading: false, error: null };
  expect(showsLivePill({ ...base, rtspLive: false })).toBe(false);
  expect(showsLivePill({ ...base, rtspLive: true })).toBe(true);
});

test("MJPEG and WebRTC cameras keep their LIVE pill once loaded", () => {
  for (const streamType of ["mjpeg", "webrtc"] as const) {
    expect(showsLivePill({ streamType, rtspLive: false, isLoading: false, error: null })).toBe(true);
    expect(showsLivePill({ streamType, rtspLive: false, isLoading: true, error: null })).toBe(false);
    expect(showsLivePill({ streamType, rtspLive: false, isLoading: false, error: "gone" })).toBe(false);
  }
});

test("a connection carrying only audio has received no video", () => {
  // The shape getStats() reported for that tablet: go2rtc matched the audio
  // track and nothing else. Transport counts every byte and must not leak in.
  const audioOnly = new Map<string, object>([
    ["IT01A", { type: "inbound-rtp", kind: "audio", bytesReceived: 1_800_000 }],
    ["T01", { type: "transport", bytesReceived: 1_900_000 }],
  ]);
  expect(inboundVideoBytes(audioOnly)).toBe(0);

  const withVideo = new Map<string, object>([
    ...audioOnly,
    ["IT01V", { type: "inbound-rtp", kind: "video", bytesReceived: 4_200_000 }],
  ]);
  expect(inboundVideoBytes(withVideo)).toBe(4_200_000);

  // Older Chromium named the field mediaType.
  expect(inboundVideoBytes([{ type: "inbound-rtp", mediaType: "video", bytesReceived: 10 }])).toBe(10);
});

test("an RTSP camera goes live in one place, and not on ICE state alone", () => {
  const source = readFileSync(join(process.cwd(), "src/components/camera-viewer.tsx"), "utf8");

  // Exactly one call site, and it is goLive — which runs on the first video
  // packet, or when getStats() shows video bytes. The ICE handler only ever
  // reaches it through goLive, for a connection that already had video.
  const calls = [...source.matchAll(/setRtspLive\(true\)/g)];
  expect(calls).toHaveLength(1);

  const goLiveAt = source.indexOf("const goLive = () => {");
  expect(goLiveAt).toBeGreaterThan(-1);
  let depth = 0;
  let end = -1;
  for (let i = source.indexOf("{", goLiveAt); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) { end = i; break; }
  }
  expect(calls[0].index).toBeGreaterThan(goLiveAt);
  expect(calls[0].index).toBeLessThan(end);
});

test("a new connection attempt on an RTSP camera starts from the still", () => {
  // Refresh in fullscreen calls initWebRTC() on a tile that may already be
  // live. If the new connection never got video, the no-video timer closed
  // it and rtspLive stayed true: LIVE over a dead picture, and the still
  // never came back. The reset has to come before the old connection goes.
  const source = readFileSync(join(process.cwd(), "src/components/camera-viewer.tsx"), "utf8");
  const initAt = source.indexOf("const initWebRTC = useCallback(");
  expect(initAt).toBeGreaterThan(-1);
  const resetAt = source.indexOf("if (isFallbackCapable) setRtspLive(false);", initAt);
  const cleanupAt = source.indexOf("cleanupWebRTC();", initAt);
  expect(resetAt).toBeGreaterThan(initAt);
  expect(resetAt).toBeLessThan(cleanupAt);
});
