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
 * A single JPEG of the current frame. go2rtc connects to the camera on the
 * first call and holds the stream open, so the second call is fast; the
 * caller's polling interval sets how often we ask.
 */
export function snapshotUrl(src: string): string {
  return `${baseUrl()}/api/frame.jpeg?src=${encodeURIComponent(src)}`;
}

/** WebRTC signalling endpoint. Takes an SDP offer, answers with an SDP answer. */
export function webrtcUrl(src: string): string {
  return `${baseUrl()}/api/webrtc?src=${encodeURIComponent(src)}`;
}

export function fetchSnapshot(src: string, signal?: AbortSignal): Promise<Response> {
  return fetch(snapshotUrl(src), { signal });
}
