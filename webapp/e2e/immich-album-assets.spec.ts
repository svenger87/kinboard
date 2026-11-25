import { expect, test } from "@playwright/test";
import { readImmichAlbumAssets, type ImmichAsset } from "../src/lib/immich/album-assets";
import { screensaverAlbumId } from "../src/lib/immich/screensaver-album";

/**
 * Reading one Immich album, against a mock that answers the way each major
 * Immich version does (#536).
 *
 * What differs between them, from Immich's own OpenAPI spec
 * (open-api/immich-openapi-specs.json at each tag) and release notes:
 *
 *   - GET /api/albums/{id} returned the album's `assets[]` up to v2.x. v3.0.0
 *     removed it ("chore!: remove without assets", immich#27835: "The
 *     AlbumResponseDto.assets has been removed"); the v3 migration guide
 *     points at POST /api/search/metadata instead.
 *   - POST /api/search/metadata filters by album with `albumIds: string[]`,
 *     first in v1.135.0 (absent from v1.134.0's spec). There has never been
 *     an `albumId` field. Unknown fields are dropped, not rejected
 *     (class-validator's whitelist before v3, zod's default object after), so
 *     a body with only `albumId` searches the whole library — the log in #536
 *     is exactly that: 76 pages, 75,180 assets, from a 12-photo album.
 *   - v3.2.0 marks `albumIds`, `page` and `type` deprecated in favour of
 *     `filter` / `cursor`, but they are still accepted in v3.4.x.
 *
 * The mock keeps those rules and nothing else: a library of 2,600 assets, an
 * album of 12 (one a video), unknown body fields stripped.
 */

type Version = "v1.118" | "v1.135" | "v2" | "v3" | "no-albumIds";

const LIBRARY_SIZE = 2600;
const BASE = "https://immich.example";
const KEY = "test-key";
const ALBUM = "a1b2c3d4-0000-4000-8000-000000000001";
const BIG_ALBUM = "a1b2c3d4-0000-4000-8000-000000000002";

function asset(i: number, type = "IMAGE"): ImmichAsset {
  return {
    id: `asset-${i}`,
    type,
    originalFileName: `IMG_${i}.jpg`,
    localDateTime: "2026-11-01T10:00:00.000Z",
    isFavorite: false,
  };
}

const library: ImmichAsset[] = Array.from({ length: LIBRARY_SIZE }, (_, i) =>
  asset(i, i % 7 === 0 ? "VIDEO" : "IMAGE"),
);
// The "TempTest" album: twelve assets scattered through the library, one video.
const albumAssets = [3, 50, 51, 99, 400, 401, 777, 1000, 1500, 2001, 2002, 2100].map((i) => library[i]);
// A large one, to see that paging still reaches its end.
const bigAlbumAssets = library.slice(0, 2400);
const albums: Record<string, { name: string; assets: ImmichAsset[] }> = {
  [ALBUM]: { name: "TempTest", assets: albumAssets },
  [BIG_ALBUM]: { name: "Everything", assets: bigAlbumAssets },
};

/** Which search/metadata body fields a version knows. Everything else is stripped. */
function knownSearchFields(version: Version): Set<string> {
  const base = ["page", "size", "type", "withExif", "isFavorite", "order"];
  if (version === "v1.118" || version === "no-albumIds") return new Set(base);
  return new Set([...base, "albumIds"]);
}

function mockImmich(version: Version, opts: { truncateAlbumAssets?: boolean } = {}) {
  const calls: { path: string; body?: Record<string, unknown> }[] = [];

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.origin).toBe(BASE);
    expect(new Headers(init?.headers).get("x-api-key")).toBe(KEY);

    const albumMatch = url.pathname.match(/^\/api\/albums\/([^/]+)$/);
    if (albumMatch && (init?.method ?? "GET") === "GET") {
      calls.push({ path: url.pathname });
      const album = albums[albumMatch[1]];
      if (!album) return json(404, { message: "Not found or no album.read access" });
      const response: Record<string, unknown> = {
        id: albumMatch[1],
        albumName: album.name,
        assetCount: album.assets.length,
      };
      // Up to v2 the details carry the assets; v3 dropped the field.
      if (version !== "v3" && version !== "no-albumIds") {
        response.assets = opts.truncateAlbumAssets ? album.assets.slice(0, 5) : album.assets;
      }
      return json(200, response);
    }

    if (url.pathname === "/api/search/metadata" && init?.method === "POST") {
      const raw = JSON.parse(String(init.body)) as Record<string, unknown>;
      const known = knownSearchFields(version);
      const body = Object.fromEntries(Object.entries(raw).filter(([k]) => known.has(k)));
      calls.push({ path: url.pathname, body: raw });

      const size = Number(body.size ?? 250);
      const page = Number(body.page ?? 1);
      if (size < 1 || size > 1000) return json(400, { message: "Validation failed" });

      let matches = library;
      if (Array.isArray(body.albumIds)) {
        const ids = new Set(
          (body.albumIds as string[]).flatMap((id) => (albums[id]?.assets ?? []).map((a) => a.id)),
        );
        matches = matches.filter((a) => ids.has(a.id));
      }
      if (typeof body.type === "string") matches = matches.filter((a) => a.type === body.type);

      const items = matches.slice((page - 1) * size, page * size);
      const more = page * size < matches.length;
      return json(200, {
        albums: { total: 0, count: 0, items: [], facets: [] },
        assets: { total: matches.length, count: items.length, items, facets: [], nextPage: more ? String(page + 1) : null },
      });
    }

    return json(404, { message: "no such endpoint in this mock" });
  }) as typeof fetch;

  const searches = () => calls.filter((c) => c.path === "/api/search/metadata");
  return { fakeFetch, calls, searches };
}

const albumIds = new Set(albumAssets.map((a) => a.id));

test.describe("reading the selected Immich album (#536)", () => {
  test("v3: the album's own assets, and the library is never paged", async () => {
    const immich = mockImmich("v3");
    const assets = await readImmichAlbumAssets(BASE, KEY, ALBUM, immich.fakeFetch);

    // Only the album, and all of its photos.
    expect(assets.length).toBeGreaterThan(0);
    expect(assets.every((a) => albumIds.has(a.id)), "an asset from outside the album came back").toBe(true);
    const images = albumAssets.filter((a) => a.type === "IMAGE").map((a) => a.id).sort();
    expect(assets.filter((a) => a.type === "IMAGE").map((a) => a.id).sort()).toEqual(images);

    // A 12-photo album is one page. Main walked the whole library here.
    expect(immich.searches().length).toBe(1);
    expect(immich.searches()[0].body?.albumIds).toEqual([ALBUM]);
  });

  test("v3: a large album pages to its end, and no further", async () => {
    const immich = mockImmich("v3");
    const assets = await readImmichAlbumAssets(BASE, KEY, BIG_ALBUM, immich.fakeFetch);
    const expected = bigAlbumAssets.filter((a) => a.type === "IMAGE").map((a) => a.id);
    expect(new Set(assets.map((a) => a.id))).toEqual(new Set(expected));
    expect(immich.searches().length).toBeLessThanOrEqual(Math.ceil(bigAlbumAssets.length / 1000));
  });

  for (const version of ["v1.118", "v1.135", "v2"] as const) {
    test(`${version}: the album details already list the assets, so there is no search`, async () => {
      const immich = mockImmich(version);
      const assets = await readImmichAlbumAssets(BASE, KEY, ALBUM, immich.fakeFetch);
      expect(assets.map((a) => a.id).sort()).toEqual([...albumIds].sort());
      expect(immich.searches().length).toBe(0);
    });
  }

  test("v1.118: when the details fall short, a search that ignores the album is not believed", async () => {
    // Before v1.135 search/metadata has no album filter at all and returns the
    // library. The album's own (partial) list is the honest answer then.
    const immich = mockImmich("v1.118", { truncateAlbumAssets: true });
    const assets = await readImmichAlbumAssets(BASE, KEY, ALBUM, immich.fakeFetch);
    expect(assets.every((a) => albumIds.has(a.id))).toBe(true);
    expect(assets.length).toBe(5);
    expect(immich.searches().length).toBeLessThanOrEqual(1);
  });

  test("a server that ignores the album filter gives no photos, not the whole library", async () => {
    // What a future Immich that drops `albumIds` would look like — or any
    // proxy that strips the body. One page is enough to notice.
    const immich = mockImmich("no-albumIds");
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const assets = await readImmichAlbumAssets(BASE, KEY, ALBUM, immich.fakeFetch);
      expect(assets).toEqual([]);
    } finally {
      console.error = original;
    }
    expect(immich.searches().length).toBe(1);
    expect(errors.map((e) => e.join(" ")).join("\n")).toMatch(/album/i);
  });

  test("an album that cannot be read gives no photos and no search", async () => {
    const immich = mockImmich("v3");
    const original = console.error;
    console.error = () => {};
    try {
      expect(await readImmichAlbumAssets(BASE, KEY, "a1b2c3d4-0000-4000-8000-00000000dead", immich.fakeFetch)).toEqual([]);
    } finally {
      console.error = original;
    }
    expect(immich.searches().length).toBe(0);
  });
});

test.describe("which album the screensaver shows (#536)", () => {
  const november = new Date("2026-11-15T12:00:00Z");
  const list = [
    { id: "wall", name: "Wallpaper November" },
    { id: "temp", name: "TempTest" },
  ];

  test("the album picked under 'Album for screensaver' wins", () => {
    expect(screensaverAlbumId("temp", list, november)).toBe("temp");
  });

  test("Automatic still means this month's Wallpaper album", () => {
    expect(screensaverAlbumId(undefined, list, november)).toBe("wall");
    expect(screensaverAlbumId(undefined, [{ id: "temp", name: "TempTest" }], november)).toBeUndefined();
  });
});
