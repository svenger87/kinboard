import { expect, test } from "@playwright/test";
import { readImmichAlbumAssets, type ImmichAsset } from "../src/lib/immich/album-assets";
import { readImmichRandomAssets, randomAssetCount } from "../src/lib/immich/random-assets";
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
 *   - Random assets: GET /api/assets/random?count= until v2.x (deprecated in
 *     v1.116.0, removed in v3.0.0 by immich#27780); POST /api/search/random
 *     with `{ size, type, ... }` from v1.116.0 (immich#12741) to today, `size`
 *     1..1000. v1.116.0 alone answered it with a search result
 *     (`{ assets: { items } }`), every later version with a plain array.
 *     There has never been a GET /api/search/random.
 *
 * The mock keeps those rules and nothing else: a library of 2,600 assets, an
 * album of 12 (one a video), unknown body fields stripped.
 */

type Version = "v1.113" | "v1.116" | "v1.118" | "v1.135" | "v2" | "v3" | "no-albumIds";

/** POST /api/search/random exists from v1.116.0 on. */
const hasSearchRandom = (version: Version) => version !== "v1.113";
/** GET /api/assets/random exists until v3.0.0 removed it. */
const hasAssetsRandom = (version: Version) => version !== "v3" && version !== "no-albumIds";

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
  if (version === "v1.113" || version === "v1.116" || version === "v1.118" || version === "no-albumIds") {
    return new Set(base);
  }
  return new Set([...base, "albumIds"]);
}

/** A random pick of `n` assets from `pool`, the way Immich's random endpoints answer. */
function sample(pool: ImmichAsset[], n: number): ImmichAsset[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function mockImmich(
  version: Version,
  opts: {
    truncateAlbumAssets?: boolean;
    /** Make the random endpoints answer with this HTTP status instead. */
    randomStatus?: number;
    /** A server (or proxy) that drops `type` from the search/random body. */
    randomIgnoresType?: boolean;
  } = {},
) {
  const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.origin).toBe(BASE);
    expect(new Headers(init?.headers).get("x-api-key")).toBe(KEY);

    const method = init?.method ?? "GET";

    if (url.pathname === "/api/search/random" && method === "POST" && hasSearchRandom(version)) {
      const raw = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push({ method, path: url.pathname, body: raw });
      if (opts.randomStatus) return json(opts.randomStatus, { message: "Internal server error" });
      const size = Number(raw.size ?? 250);
      if (!Number.isInteger(size) || size < 1 || size > 1000) return json(400, { message: "Validation failed" });
      let pool = library;
      if (typeof raw.type === "string" && !opts.randomIgnoresType) pool = pool.filter((a) => a.type === raw.type);
      const items = sample(pool, size);
      // v1.116.0 answered with a search result; from v1.117.0 it is an array.
      if (version === "v1.116") {
        return json(200, { albums: { total: 0, count: 0, items: [], facets: [] }, assets: { total: items.length, count: items.length, items, facets: [], nextPage: null } });
      }
      return json(200, items);
    }

    if (url.pathname === "/api/assets/random" && method === "GET" && hasAssetsRandom(version)) {
      calls.push({ method, path: url.pathname });
      if (opts.randomStatus) return json(opts.randomStatus, { message: "Internal server error" });
      // No type filter here, ever: videos come back too.
      return json(200, sample(library, Number(url.searchParams.get("count") ?? 1)));
    }

    const albumMatch = url.pathname.match(/^\/api\/albums\/([^/]+)$/);
    if (albumMatch && method === "GET") {
      calls.push({ method, path: url.pathname });
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
      calls.push({ method: "POST", path: url.pathname, body: raw });

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

    // What Immich says to a route it does not have — GET /api/search/random
    // on every version, search/random before v1.116, assets/random from v3.
    calls.push({ method, path: url.pathname });
    return json(404, { message: `Cannot ${method} ${url.pathname}`, error: "Not Found", statusCode: 404 });
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

/** Run `fn` with console.error captured, and hand back what was logged. */
async function capturingErrors<T>(fn: () => Promise<T>): Promise<{ result: T; logged: string }> {
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    const result = await fn();
    return { result, logged: errors.map((e) => e.map(String).join(" ")).join("\n") };
  } finally {
    console.error = original;
  }
}

const libraryIds = new Set(library.map((a) => a.id));
const neverSearchRandomByGet = (calls: { method: string; path: string }[]) =>
  expect(
    calls.filter((c) => c.path === "/api/search/random" && c.method === "GET"),
    "GET /api/search/random does not exist in any Immich",
  ).toEqual([]);

test.describe("random photos when no album is picked", () => {
  for (const version of ["v1.113", "v1.116", "v1.118", "v1.135", "v2", "v3"] as const) {
    test(`${version}: random images from the library, asked for the way this version understands`, async () => {
      const immich = mockImmich(version);
      const assets = await readImmichRandomAssets(BASE, KEY, 12, immich.fakeFetch);

      // assets/random (v1.113) cannot leave videos out, so it is asked for
      // twice as many and may still fall a little short; never over.
      if (version === "v1.113") expect(assets.length).toBeGreaterThanOrEqual(6);
      else expect(assets.length).toBe(12);
      expect(assets.length).toBeLessThanOrEqual(12);
      expect(assets.every((a) => libraryIds.has(a.id))).toBe(true);
      expect(assets.every((a) => a.type === "IMAGE"), "a video came back").toBe(true);
      expect(new Set(assets.map((a) => a.id)).size).toBe(assets.length);

      neverSearchRandomByGet(immich.calls);
      // Never by paging the library, and never more than one fallback.
      expect(immich.searches()).toEqual([]);
      expect(immich.calls.length).toBeLessThanOrEqual(2);
      if (version === "v1.113") {
        expect(immich.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
          "POST /api/search/random",
          "GET /api/assets/random",
        ]);
      } else {
        expect(immich.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/search/random"]);
        expect(immich.calls[0].body).toMatchObject({ size: 12, type: "IMAGE" });
      }
    });
  }

  test("videos are filtered out even when the server sends them", async () => {
    // Before v1.116 there is no way to ask for images only; a proxy could drop
    // `type` from the body on any version.
    for (const [version, opts] of [
      ["v1.113", {}],
      ["v3", { randomIgnoresType: true }],
    ] as const) {
      const immich = mockImmich(version, opts);
      // 1000 is Immich's ceiling, so the over-ask on v1.113 cannot hide the
      // videos: about one in seven of what comes back is one.
      const assets = await readImmichRandomAssets(BASE, KEY, 1000, immich.fakeFetch);
      expect(assets.length, `${version}: no images at all`).toBeGreaterThan(0);
      expect(assets.every((a) => a.type === "IMAGE"), `${version}: a video came back`).toBe(true);
      expect(assets.length, `${version}: the server sent no videos to filter`).toBeLessThan(1000);
    }
  });

  test("an Immich error gives no photos and a log line, not an error", async () => {
    for (const status of [500, 401]) {
      const immich = mockImmich("v3", { randomStatus: status });
      const { result, logged } = await capturingErrors(() =>
        readImmichRandomAssets(BASE, KEY, 12, immich.fakeFetch),
      );
      expect(result).toEqual([]);
      expect(logged).toMatch(new RegExp(`random.*${status}`, "i"));
      neverSearchRandomByGet(immich.calls);
      // A server error is not a missing endpoint: no second try elsewhere.
      expect(immich.calls.length).toBe(1);
    }

    // And an Immich that cannot be reached at all.
    const unreachable = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const { result, logged } = await capturingErrors(() => readImmichRandomAssets(BASE, KEY, 12, unreachable));
    expect(result).toEqual([]);
    expect(logged).toMatch(/random/i);
  });

  test("a server with no random endpoint at all gives no photos, without paging the library", async () => {
    // v3 has search/random; take it away to see the end of the fallback chain.
    const immich = mockImmich("v3", { randomStatus: 404 });
    const { result, logged } = await capturingErrors(() => readImmichRandomAssets(BASE, KEY, 12, immich.fakeFetch));
    expect(result).toEqual([]);
    expect(logged).toMatch(/random/i);
    expect(immich.searches()).toEqual([]);
    neverSearchRandomByGet(immich.calls);
  });

  test("how many to ask for: the widget's limit, Immich's own cap, a default when unlimited", () => {
    expect(randomAssetCount(12)).toBe(12);
    expect(randomAssetCount(200)).toBe(200);
    expect(randomAssetCount(5000)).toBe(1000);
    expect(randomAssetCount(0)).toBe(250);
    expect(randomAssetCount(Number.NaN)).toBe(250);
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
