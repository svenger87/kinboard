import { test, expect } from "@playwright/test";
import {
  parseAlbumToken,
  parseDerivatives,
  parseWebstream,
  parseAssetUrls,
  pickBestDerivative,
} from "../src/lib/icloud-album";

/**
 * Unlike the DLNA fixtures, these payloads are written from the documented
 * shape rather than captured from a live album — reaching Apple's servers
 * needs somebody's real shared-album token, and a test suite is not the place
 * to keep one. The field names and nesting match what the endpoint returns;
 * the pure functions here are what the tests are actually for.
 */

test.describe("parseAlbumToken", () => {
  test("accepts every form Apple hands out", () => {
    // The classic sharedalbum link, hash-delimited.
    expect(parseAlbumToken("https://www.icloud.com/sharedalbum/#B0x5CjqPFhOZ1B")).toBe("B0x5CjqPFhOZ1B");
    // The newer share.icloud.com link.
    expect(parseAlbumToken("https://share.icloud.com/photos/B0x5CjqPFhOZ1B")).toBe("B0x5CjqPFhOZ1B");
    // And the bare token, because people paste that too.
    expect(parseAlbumToken("B0x5CjqPFhOZ1B")).toBe("B0x5CjqPFhOZ1B");
    expect(parseAlbumToken("  B0x5CjqPFhOZ1B  ")).toBe("B0x5CjqPFhOZ1B");
  });

  test("refuses links that are not iCloud", () => {
    // Someone pasting a Google Photos link should be told, not silently fail
    // against Apple's servers.
    expect(parseAlbumToken("https://photos.app.goo.gl/abcdef")).toBeNull();
    expect(parseAlbumToken("https://evil.example.com/photos/B0x5CjqPFhOZ1B")).toBeNull();
  });

  test("refuses empty and malformed input", () => {
    for (const bad of ["", "   ", "not a token", "https://www.icloud.com/sharedalbum/#short"]) {
      expect(parseAlbumToken(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

test.describe("parseDerivatives / pickBestDerivative", () => {
  const derivatives = {
    "342": { fileSize: "48213", checksum: "aaa", width: "342", height: "256" },
    "1520": { fileSize: "812394", checksum: "bbb", width: "1520", height: "1140" },
    "2048": { fileSize: "1912394", checksum: "ccc", width: "2048", height: "1536" },
  };

  test("reads Apple's map of renditions, numbers as strings and all", () => {
    const parsed = parseDerivatives(derivatives);
    expect(parsed).toHaveLength(3);
    expect(parsed.every((d) => Number.isFinite(d.width) && Number.isFinite(d.fileSize))).toBe(true);
  });

  test("the largest rendition wins — a wall display is not a thumbnail", () => {
    expect(pickBestDerivative(parseDerivatives(derivatives))?.checksum).toBe("ccc");
  });

  test("a derivative with no checksum cannot be fetched, so it is dropped", () => {
    const parsed = parseDerivatives({ "1": { fileSize: "1", width: "1", height: "1" } });
    expect(parsed).toEqual([]);
  });

  test("no derivatives is null, not a crash", () => {
    expect(pickBestDerivative([])).toBeNull();
    expect(parseDerivatives(null)).toEqual([]);
    expect(parseDerivatives("nonsense")).toEqual([]);
  });
});

test.describe("parseWebstream", () => {
  const body = {
    streamName: "Urlaub 2026",
    photos: [
      {
        photoGuid: "GUID-1",
        caption: "Am Strand",
        dateCreated: "2026-07-14T10:12:00Z",
        derivatives: { "1520": { fileSize: "812394", checksum: "bbb", width: "1520", height: "1140" } },
      },
      {
        photoGuid: "GUID-2",
        caption: "",
        dateCreated: "2026-07-15T08:00:00Z",
        derivatives: { "2048": { fileSize: "1912394", checksum: "ccc", width: "2048", height: "1536" } },
      },
      // A video shares the album and has no still derivative worth showing.
      { photoGuid: "GUID-3", derivatives: {} },
      // And something malformed, because unofficial APIs do that.
      { caption: "no guid" },
    ],
  };

  test("keeps the album name and the usable photos", () => {
    const album = parseWebstream(body, "p23-sharedstreams.icloud.com");
    expect(album.streamName).toBe("Urlaub 2026");
    expect(album.host).toBe("p23-sharedstreams.icloud.com");
    expect(album.photos.map((p) => p.guid)).toEqual(["GUID-1", "GUID-2"]);
  });

  test("an empty caption is null rather than an empty label", () => {
    const album = parseWebstream(body, "h");
    expect(album.photos[0].caption).toBe("Am Strand");
    expect(album.photos[1].caption).toBeNull();
  });

  test("a response with nothing in it is an empty album, not an exception", () => {
    expect(parseWebstream({}, "h").photos).toEqual([]);
    expect(parseWebstream(null, "h").photos).toEqual([]);
    expect(parseWebstream({ photos: "not an array" }, "h").photos).toEqual([]);
  });
});

test.describe("parseAssetUrls", () => {
  test("joins location and path into a URL", () => {
    const urls = parseAssetUrls({
      items: {
        bbb: { url_location: "cvws.icloud-content.com", url_path: "/B/abc/def?o=1&v=2" },
        ccc: { url_location: "cvws.icloud-content.com", url_path: "/B/xyz?o=3" },
      },
    });
    expect(urls.get("bbb")).toBe("https://cvws.icloud-content.com/B/abc/def?o=1&v=2");
    expect(urls.size).toBe(2);
  });

  test("an item missing either half is skipped rather than half-built", () => {
    const urls = parseAssetUrls({
      items: {
        a: { url_location: "host" },
        b: { url_path: "/only/path" },
        c: { url_location: "host", url_path: "/ok" },
      },
    });
    expect([...urls.keys()]).toEqual(["c"]);
  });

  test("a body with no items is an empty map", () => {
    expect(parseAssetUrls({}).size).toBe(0);
    expect(parseAssetUrls(null).size).toBe(0);
  });
});
