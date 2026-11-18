import { test, expect } from "@playwright/test";
import {
  parseAlbumLink,
  isIcloudHost,
  cloudKitOrigin,
  cloudKitPhoto,
  fetchCloudKitPhotos,
  type CkRecord,
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

    // A hostname that merely *ends with* the string "icloud.com" is a domain
    // anyone can register. Checking the suffix as text rather than as a label
    // boundary is the whole bug.
    expect(parseAlbumToken("https://evilicloud.com/photos/B0x5CjqPFhOZ1B")).toBeNull();
    expect(parseAlbumToken("https://noticloud.com/photos/B0x5CjqPFhOZ1B")).toBeNull();
    expect(parseAlbumToken("https://icloud.com.attacker.net/photos/B0x5CjqPFhOZ1B")).toBeNull();

    // …while the real ones keep working, including the bare apex.
    expect(parseAlbumToken("https://icloud.com/sharedalbum/#B0x5CjqPFhOZ1B")).toBe("B0x5CjqPFhOZ1B");
    expect(parseAlbumToken("https://p23-sharedstreams.icloud.com/photos/B0x5CjqPFhOZ1B")).toBe(
      "B0x5CjqPFhOZ1B",
    );
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

/**
 * CloudKit shared albums: the link format iOS and macOS 26 hand out
 * (photos.icloud.com/shared/album/<token>). Written from the shape the
 * CloudKit Web Services endpoints return; the fetch is stubbed.
 */
test.describe("parseAlbumLink", () => {
  test("the current link is CloudKit, every older form stays legacy", () => {
    expect(parseAlbumLink("https://www.icloud.com/shared/album/0aBcDeFgHiJkLmNoP")).toEqual({ token: "0aBcDeFgHiJkLmNoP", format: "cloudkit" });
    expect(parseAlbumLink("https://photos.icloud.com/shared/album/0aBcDeFgHiJkLmNoP?x=1")).toEqual({ token: "0aBcDeFgHiJkLmNoP", format: "cloudkit" });
    expect(parseAlbumLink("https://www.icloud.com/sharedalbum/#B0x5CjqPFhOZ1B")).toEqual({ token: "B0x5CjqPFhOZ1B", format: "legacy" });
    expect(parseAlbumLink("https://share.icloud.com/photos/B0x5CjqPFhOZ1B")).toEqual({ token: "B0x5CjqPFhOZ1B", format: "legacy" });
    expect(parseAlbumLink("B0x5CjqPFhOZ1B")).toEqual({ token: "B0x5CjqPFhOZ1B", format: "legacy" });
  });

  test("the same path on another host is refused", () => {
    expect(parseAlbumLink("https://evil.example/shared/album/0aBcDeFgHiJkLmNoP")).toBeNull();
    expect(parseAlbumLink("https://icloud.com.evil.example/shared/album/0aBcDeFgHiJkLmNoP")).toBeNull();
    expect(parseAlbumLink("")).toBeNull();
  });
});

test.describe("hosts the server follows", () => {
  test("only iCloud hosts are followed", () => {
    expect(isIcloudHost("p23-sharedstreams.icloud.com")).toBe(true);
    expect(isIcloudHost("icloud.com")).toBe(true);
    expect(isIcloudHost("icloud.com.evil.example")).toBe(false);
    expect(isIcloudHost("evil-icloud.com")).toBe(false);
    expect(isIcloudHost("169.254.169.254")).toBe(false);
    expect(isIcloudHost(undefined)).toBe(false);
  });

  test("CloudKit's partition is used only as an https iCloud origin", () => {
    expect(cloudKitOrigin("https://p42-ckdatabasews.icloud.com:443")).toBe("https://p42-ckdatabasews.icloud.com");
    expect(cloudKitOrigin("https://evil.example")).toBe("https://ckdatabasews.icloud.com");
    expect(cloudKitOrigin("http://p42-ckdatabasews.icloud.com")).toBe("https://ckdatabasews.icloud.com");
    expect(cloudKitOrigin("not a url")).toBe("https://ckdatabasews.icloud.com");
    expect(cloudKitOrigin(undefined)).toBe("https://ckdatabasews.icloud.com");
  });
});

const res = (name: string, w: number, url = `https://cvws.icloud-content.com/${name}`) => ({
  [`${name}Res`]: { value: { downloadURL: url } },
  [`${name}Width`]: { value: w },
  [`${name}Height`]: { value: Math.round(w * 0.75) },
});
const master = (id: string, fields: Record<string, unknown>): CkRecord => ({
  recordName: id,
  recordType: "CPLMaster",
  fields: fields as CkRecord["fields"],
});

test.describe("cloudKitPhoto", () => {
  test("a JPEG rendition wins over the HEIC original a browser cannot show", () => {
    const p = cloudKitPhoto(master("m1", { ...res("resOriginal", 4032), ...res("resJPEGFull", 2048) }), 1_700_000_000_000)!;
    expect(p.url).toContain("resJPEGFull");
    expect(p.dateCreated).toBe(new Date(1_700_000_000_000).toISOString());
  });

  test("the smallest JPEG that still covers a wall screen, else the largest", () => {
    const covering = cloudKitPhoto(master("m", { ...res("resJPEGThumb", 480), ...res("resJPEGMed", 1920), ...res("resJPEGFull", 4032) }), null)!;
    expect(covering.width).toBe(1920);
    const small = cloudKitPhoto(master("m", { ...res("resJPEGThumb", 480), ...res("resJPEGMed", 1200) }), null)!;
    expect(small.width).toBe(1200);
  });

  test("videos and records without a rendition are skipped", () => {
    expect(cloudKitPhoto(master("v", { itemType: { value: "com.apple.quicktime-movie" }, ...res("resJPEGFull", 1920) }), null)).toBeNull();
    expect(cloudKitPhoto(master("e", {}), null)).toBeNull();
    expect(cloudKitPhoto(master("mp4", { itemType: { value: "public.mpeg-4" }, ...res("resJPEGFull", 1920) }), null)).toBeNull();
    expect(cloudKitPhoto(master("heic", { itemType: { value: "public.heic" }, ...res("resJPEGFull", 1920) }), null)).not.toBeNull();
    expect(cloudKitPhoto(master("vid", { ...res("resVidMed", 1920) }), null)).toBeNull();
  });
});

test.describe("fetchCloudKitPhotos", () => {
  const realFetch = globalThis.fetch;
  test.afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** Stub fetch: answers resolve, then the query pages in order; records every URL asked. */
  function stub(partition: string, pages: { records: CkRecord[]; continuationMarker?: string }[]) {
    const urls: string[] = [];
    let page = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      const body = url.includes("/records/resolve")
        ? {
            results: [
              {
                zoneID: { zoneName: "SharedSync-1", ownerRecordName: "_owner" },
                anonymousPublicAccess: { token: "anon-token", databasePartition: partition },
                share: { fields: { "cloudkit.title": { value: "Familie" } } },
              },
            ],
          }
        : pages[page++] ?? { records: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    return urls;
  }

  const asset = (id: string, masterId: string, date: number): CkRecord => ({
    recordName: id,
    recordType: "CPLAsset",
    fields: { masterRef: { value: { recordName: masterId } }, assetDate: { value: date } } as CkRecord["fields"],
  });

  test("photos come in the album's order, named after the share, from the partition Apple names", async () => {
    const urls = stub("https://p42-ckdatabasews.icloud.com:443", [
      {
        records: [
          asset("a2", "m2", 2000), master("m2", res("resJPEGFull", 1920)),
          asset("a1", "m1", 1000), master("m1", res("resJPEGFull", 1920)),
        ],
      },
    ]);
    const { streamName, photos } = await fetchCloudKitPhotos("0aBcDeFgHiJkLmNoP", 10);
    expect(streamName).toBe("Familie");
    expect(photos.map((p) => p.id)).toEqual(["m2", "m1"]);
    expect(urls[1]).toMatch(/^https:\/\/p42-ckdatabasews\.icloud\.com\/database\//);
    expect(urls[1]).toContain("publicAccessAuthToken=anon-token");
  });

  test("a partition outside iCloud is not followed", async () => {
    const urls = stub("https://evil.example", [{ records: [] }]);
    await fetchCloudKitPhotos("0aBcDeFgHiJkLmNoP", 10);
    expect(urls[1]).toMatch(/^https:\/\/ckdatabasews\.icloud\.com\//);
  });

  test("videos do not count towards the limit, so the next page is fetched", async () => {
    const video = (id: string) => master(id, { itemType: { value: "public.mpeg-4" }, ...res("resJPEGFull", 1920) });
    stub("https://ckdatabasews.icloud.com", [
      { records: [video("v1"), video("v2"), master("m1", res("resJPEGFull", 1920))], continuationMarker: "next" },
      { records: [master("m2", res("resJPEGFull", 1920))] },
    ]);
    const { photos } = await fetchCloudKitPhotos("0aBcDeFgHiJkLmNoP", 2);
    expect(photos.map((p) => p.id).sort()).toEqual(["m1", "m2"]);
  });
});
