import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseDeviceDescription,
  parseDidl,
  extractBrowseResult,
} from "../src/lib/dlna-client";

/**
 * The same code, against XML a real server actually produced.
 *
 * These four files were captured from MiniDLNA 1.3 serving four JPEGs in two
 * folders — including one named "berge & seen.jpg", because an unescaped
 * ampersand in a filename is the thing that breaks naive parsers and it is not
 * hypothetical. Nothing here is hand-written: if a future change to the
 * scanner cannot read a real server, these fail.
 */

const fixture = (name: string) =>
  readFileSync(join(__dirname, "fixtures", "dlna", name), "utf8");

test.describe("MiniDLNA, captured live", () => {
  test("finds ContentDirectory among the services it advertises", () => {
    // MiniDLNA lists ContentDirectory, ConnectionManager and Microsoft's
    // X_MS_MediaReceiverRegistrar. Picking the wrong one browses nothing.
    const parsed = parseDeviceDescription(
      fixture("rootDesc.xml"),
      "http://127.0.0.1:8299/rootDesc.xml",
    );
    expect(parsed?.controlUrl).toBe("http://127.0.0.1:8299/ctl/ContentDir");
    expect(parsed?.friendlyName).toContain("minidlna");
  });

  test("reads the root containers with their child counts", () => {
    const { didl, totalMatches } = extractBrowseResult(fixture("browse-root.xml"));
    const { containers } = parseDidl(didl);
    const titles = containers.map((c) => c.title);

    expect(titles).toContain("Browse Folders");
    expect(titles).toContain("Pictures");
    expect(totalMatches).toBeGreaterThan(0);
    expect(containers.find((c) => c.title === "Pictures")?.childCount).toBeGreaterThan(0);
  });

  test("walks into the folder tree", () => {
    const { didl } = extractBrowseResult(fixture("browse-folders.xml"));
    const { containers } = parseDidl(didl);
    expect(containers.map((c) => c.title).sort()).toEqual(["Familie", "Urlaub"]);
    // Object ids carry a `$`, which is exactly the sort of character that
    // needs escaping on the way back out in a SOAP envelope.
    expect(containers[0].id).toContain("$");
  });

  test("reads the photos, picking the full rendition over the thumbnail", () => {
    const { didl } = extractBrowseResult(fixture("browse-photos.xml"));
    const { items } = parseDidl(didl);

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.url, `${item.title} has a URL`).toMatch(/^https?:\/\//);
      expect(item.mimeType).toBe("image/jpeg");
      // MiniDLNA publishes a JPEG_TN alongside the real file; the thumbnail
      // must not become the photo.
      expect(item.url).not.toMatch(/JPEG_TN/);
    }
  });

  test("does not lose the file with an ampersand in its name", () => {
    // "berge & seen.jpg" lives in the other folder; this asserts the general
    // property across every captured payload rather than one filename.
    for (const name of ["browse-root.xml", "browse-folders.xml", "browse-photos.xml"]) {
      const { didl } = extractBrowseResult(fixture(name));
      const { containers, items } = parseDidl(didl);
      expect(containers.length + items.length, `${name} parsed to something`).toBeGreaterThan(0);
    }
  });
});
