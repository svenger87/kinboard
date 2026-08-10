import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRtspUrl, withRtspCredentials, snapshotUrl, webrtcUrl } from "../src/lib/go2rtc";

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
