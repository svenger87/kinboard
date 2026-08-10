/**
 * go2rtc — the streaming bridge — from the server side.
 *
 * Nothing in a browser can open an `rtsp://` URL, and neither can `fetch()`.
 * So an RTSP camera has to go through go2rtc, which speaks RTSP to the camera
 * and WebRTC or JPEG to us. The camera settings form has offered "RTSP" as a
 * stream type since the beginning and this was the missing half of it: the
 * URL was handed straight to `fetch()`, which threw on the scheme, and the
 * tile reported "Snapshot could not be loaded" however good the URL was.
 *
 * go2rtc accepts a source URL directly as its `src` parameter and keys the
 * resulting stream by that string, so asking twice reuses one connection to
 * the camera and there is nothing to register, name or clean up. That is what
 * makes this a server-side URL rewrite rather than a config-file generator.
 *
 * These URLs are secrets: an RTSP URL normally carries `user:pass` in its
 * userinfo. They travel from this process to go2rtc over the internal Docker
 * network and never reach the browser. Worth knowing when reasoning about
 * where they end up: go2rtc masks only the values it substituted into its own
 * config from environment variables, so a source added at runtime is echoed
 * back verbatim by its `/api/streams`. That endpoint is why the bundled
 * compose binds go2rtc's HTTP API to loopback.
 */

/** Read at call time — a module-level constant would freeze the test env. */
function baseUrl(): string {
  return process.env.GO2RTC_URL || "http://go2rtc:1984";
}

/** `rtsp://` and its TLS variant. Everything else `fetch()` can handle. */
export function isRtspUrl(url: string): boolean {
  return /^rtsps?:\/\//i.test(url.trim());
}

/**
 * Credentials for an RTSP camera can arrive two ways: inside the URL, or in
 * the separate username/password fields. Those fields are labelled as HTTP
 * auth and that is what they do for a snapshot URL — but a household that
 * filled them in and left the RTSP URL bare has said everything needed, and
 * refusing to connect on a technicality would be pedantry. A URL that already
 * carries credentials is returned untouched, so nothing re-encodes them.
 */
export function withRtspCredentials(
  url: string,
  auth?: { username: string; password: string } | null,
): string {
  if (!auth?.username) return url;

  try {
    const parsed = new URL(url);
    if (parsed.username) return url;
    parsed.username = auth.username;
    parsed.password = auth.password ?? "";
    return parsed.toString();
  } catch {
    // Unparseable — hand it to go2rtc as given and let it report the failure.
    return url;
  }
}

/**
 * Widest snapshot we will ask go2rtc for, and the floor. A camera's own
 * resolution is the real cap — go2rtc does not upscale — so these only exist
 * to stop a caller asking for something absurd, since the width arrives in a
 * query string.
 */
const MIN_SNAPSHOT_WIDTH = 64;
const MAX_SNAPSHOT_WIDTH = 3840;

/** Clamp to something sane, or undefined for "whatever the camera sends". */
export function clampSnapshotWidth(width: unknown): number | undefined {
  const n = typeof width === "string" ? Number.parseInt(width, 10) : Number(width);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(MAX_SNAPSHOT_WIDTH, Math.max(MIN_SNAPSHOT_WIDTH, Math.trunc(n)));
}

/**
 * A single JPEG of the current frame. go2rtc connects to the camera on the
 * first call and holds the stream open, so the second call is fast; the
 * caller's polling interval sets how often we ask.
 *
 * `width` asks go2rtc to scale the frame down before encoding, and it matters
 * more than it looks. A 4K camera's full frame is ~700 KB of JPEG, sent every
 * 5 seconds per tile per viewer, to be drawn into a box a few hundred pixels
 * wide. Asking for 640 makes it ~44 KB — the same picture, 16x less of it.
 * The server-side cost is unchanged: decoding the 4K frame is the expensive
 * part and happens either way. What this saves is the transfer and the
 * browser's own decode, which is what the wall display actually feels.
 */
export function snapshotUrl(src: string, width?: number): string {
  const w = clampSnapshotWidth(width);
  return (
    `${baseUrl()}/api/frame.jpeg?src=${encodeURIComponent(src)}` +
    (w ? `&width=${w}` : "")
  );
}

/** WebRTC signalling endpoint. Takes an SDP offer, answers with an SDP answer. */
export function webrtcUrl(src: string): string {
  return `${baseUrl()}/api/webrtc?src=${encodeURIComponent(src)}`;
}

export function fetchSnapshot(
  src: string,
  signal?: AbortSignal,
  width?: number,
): Promise<Response> {
  return fetch(snapshotUrl(src, width), { signal });
}
