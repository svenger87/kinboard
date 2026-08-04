import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Four things Unsplash's API Guidelines require that Kinboard wasn't doing.
 *
 * The guidelines, quoted:
 *  - "your application must attribute Unsplash, the Unsplash photographer,
 *     and contain a link back to their Unsplash profile"
 *  - "All links back to Unsplash should use utm parameters in the
 *     ?utm_source=your_app_name&utm_medium=referral"
 *  - "When your application performs something similar to a download (like
 *     when a user chooses the image to include in a blog post, set as a
 *     header, etc.), you must send a request to the download endpoint
 *     returned under the photo.links.download_location property."
 *
 * Before this: the photographer's name was shown and nothing else.
 * photographerUrl was fetched, carried through the hook, and dropped;
 * download_location appeared nowhere in the codebase.
 */

const src = (...p: string[]) => readFileSync(join(__dirname, "..", "src", ...p), "utf8");
const screensaver = src("components", "screensaver.tsx");
const photosRoute = src("app", "api", "unsplash", "photos", "route.ts");
const trackRoute = src("app", "api", "unsplash", "track-download", "route.ts");

test("Unsplash is credited, not just the photographer", () => {
  for (const locale of ["en", "de", "fr"]) {
    const messages = JSON.parse(readFileSync(join(__dirname, "..", "messages", `${locale}.json`), "utf8"));
    const find = (node: unknown): Record<string, string> | null => {
      if (node && typeof node === "object") {
        const rec = node as Record<string, unknown>;
        if ("photoCreditUnsplash" in rec) return rec as Record<string, string>;
        for (const v of Object.values(rec)) {
          const r = find(v);
          if (r) return r;
        }
      }
      return null;
    };
    const node = find(messages);
    expect(node, locale).not.toBeNull();
    expect(node!.photoCreditUnsplash, locale).toContain("Unsplash");
    expect(node!.photoCreditUnsplash, locale).toContain("{photographer}");
  }
});

test("the credit links back to the photographer's profile", () => {
  const block = screensaver.slice(screensaver.indexOf("Photo metadata / attribution"));
  expect(block.slice(0, 1400)).toContain("href={currentPhotoMetadata.photographerUrl}");
  expect(block.slice(0, 1400)).toContain('rel="noopener noreferrer"');
});

test("it falls back to the plain credit when there's no profile URL", () => {
  // Immich photos have no photographer URL; they must not render a dead link.
  const block = screensaver.slice(screensaver.indexOf("Photo metadata / attribution"));
  expect(block.slice(0, 1600)).toContain('t("photoCredit", { photographer:');
});

test.describe("utm parameters", () => {
  // Mirrors withUtm in the photos route.
  const UTM = "utm_source=kinboard&utm_medium=referral";
  const withUtm = (u: string) => (u.includes("?") ? `${u}&${UTM}` : `${u}?${UTM}`);

  test("are appended to profile links", () => {
    expect(withUtm("https://unsplash.com/@jdoe")).toBe(`https://unsplash.com/@jdoe?${UTM}`);
  });

  test("don't break a URL that already has a query", () => {
    expect(withUtm("https://unsplash.com/@jdoe?x=1")).toBe(`https://unsplash.com/@jdoe?x=1&${UTM}`);
  });

  test("the route applies them", () => {
    expect(photosRoute).toContain("utm_source=kinboard&utm_medium=referral");
    expect(photosRoute).toContain("withUtm(photo.user.links.html)");
  });
});

test.describe("the display event", () => {
  test("download_location is carried to the client", () => {
    expect(photosRoute).toContain("downloadLocation: photo.links?.download_location");
  });

  test("the screensaver reports it once per photo", () => {
    expect(screensaver).toContain("/api/unsplash/track-download");
    expect(screensaver).toContain("reportedDownloads.current.has(downloadLocation)");
    expect(screensaver).toContain("reportedDownloads.current.add(downloadLocation)");
  });

  test("a reporting failure can't affect the screensaver", () => {
    const block = screensaver.slice(screensaver.indexOf("/api/unsplash/track-download") - 400);
    expect(block.slice(0, 900)).toContain(".catch(");
  });

  test("the access key stays server-side", () => {
    expect(trackRoute).toContain("Client-ID");
    expect(screensaver).not.toContain("Client-ID");
    expect(screensaver).not.toContain("access_key");
  });

  test("the tracking route only calls Unsplash", () => {
    // Same pinning as the image proxy — this URL also comes from the client.
    expect(trackRoute).toContain('ALLOWED_HOST = "api.unsplash.com"');
    expect(trackRoute).toContain("target.hostname !== ALLOWED_HOST");
    expect(trackRoute).toContain('target.protocol !== "https:"');
  });

  test("a non-Unsplash download_location is refused", () => {
    const ok = (raw: string) => {
      let u: URL;
      try { u = new URL(raw); } catch { return false; }
      return u.protocol === "https:" && u.hostname === "api.unsplash.com";
    };
    expect(ok("https://api.unsplash.com/photos/abc/download?ixid=x")).toBe(true);
    for (const bad of [
      "http://localhost:3000/",
      "https://evil.example/photos/abc/download",
      "https://api.unsplash.com.evil.example/x",
      "not a url",
    ]) {
      expect(ok(bad), bad).toBe(false);
    }
  });
});
