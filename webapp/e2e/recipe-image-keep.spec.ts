import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { execFileSync } from "node:child_process";
import { establishSession } from "./session";
import {
  isRemoteImage, keepRemoteImage, KeepImageError, KEEP_IMAGE_USER_AGENT, KEPT_IMAGE_EDGE, MAX_REMOTE_IMAGE_BYTES, remoteCandidates,
  withSourceAddresses, type KeepImageDeps,
} from "../src/lib/recipe-image-keep";

/**
 * A recipe's picture from the web is kept on this server.
 *
 * Reported in discussion #445: recipe pictures chosen through the web search
 * were gone every morning and took minutes to come back, some never. The
 * recipe held the address of the original on the source's server, and every
 * screen downloaded the full-size original from there each time.
 */

class Blocked extends Error {}

function deps(over: Partial<KeepImageDeps> = {}) {
  const stored: { key: string; bytes: number }[] = [];
  const scaledWith: number[] = [];
  const d: KeepImageDeps = {
    fetchRemote: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }),
    isBlocked: (e) => e instanceof Blocked,
    scale: async (data, edge) => {
      scaledWith.push(edge);
      return new Uint8Array([9, ...data]);
    },
    store: async (key, data) => {
      stored.push({ key, bytes: data.byteLength });
    },
    urlFor: (key) => `/storage/v1/object/public/recipe-images/${key}`,
    stamp: () => "1700000000000-abc123",
    ...over,
  };
  return { d, stored, scaledWith };
}

const reason = async (run: Promise<unknown>) => run.then(() => "kept", (e) => (e instanceof KeepImageError ? e.reason : `other: ${e}`));

test("what counts as a picture on someone else's server", () => {
  for (const url of ["https://upload.wikimedia.org/a.jpg", "http://example.com/x.png", " HTTPS://EXAMPLE.COM/x "]) expect(isRemoteImage(url), url).toBe(true);
  for (const url of ["/storage/v1/object/public/recipe-images/f/1.webp", "", null, undefined, "data:image/png;base64,AAAA", "ftp://x/y.jpg"]) {
    expect(isRemoteImage(url), String(url)).toBe(false);
  }
});

test("fetched once, scaled to the kept size, stored under the family, and the local address comes back", async () => {
  const { d, stored, scaledWith } = deps();
  const url = await keepRemoteImage("https://example.com/big.jpg", "fam-1", d);
  expect(url).toBe("/storage/v1/object/public/recipe-images/fam-1/1700000000000-abc123.webp");
  expect(stored).toEqual([{ key: "fam-1/1700000000000-abc123.webp", bytes: 4 }]);
  expect(scaledWith).toEqual([KEPT_IMAGE_EDGE]);
});

test("a page instead of a picture, a refusal, an address that may not be fetched: each is its own answer and nothing is stored", async () => {
  const html = deps({ fetchRemote: async () => new Response("<html>", { headers: { "content-type": "text/html; charset=utf-8" } }) });
  expect(await reason(keepRemoteImage("https://example.com/x", "f", html.d))).toBe("not_an_image");
  const gone = deps({ fetchRemote: async () => new Response("no", { status: 404 }) });
  expect(await reason(keepRemoteImage("https://example.com/x", "f", gone.d))).toBe("unreachable");
  const throttled = deps({ fetchRemote: async () => new Response("slow down", { status: 429 }) });
  expect(await reason(keepRemoteImage("https://example.com/x", "f", throttled.d))).toBe("unreachable");
  const inside = deps({ fetchRemote: async () => { throw new Blocked("10.0.0.1"); } });
  expect(await reason(keepRemoteImage("http://10.0.0.1/x.jpg", "f", inside.d))).toBe("blocked");
  const down = deps({ fetchRemote: async () => { throw new TypeError("fetch failed"); } });
  expect(await reason(keepRemoteImage("https://example.com/x", "f", down.d))).toBe("unreachable");
  for (const each of [html, gone, throttled, inside, down]) expect(each.stored).toEqual([]);
});

test("a body larger than the limit is given up on, declared or not", async () => {
  const declared = deps({
    fetchRemote: async () => new Response("x", { headers: { "content-type": "image/jpeg", "content-length": String(MAX_REMOTE_IMAGE_BYTES + 1) } }),
  });
  expect(await reason(keepRemoteImage("https://example.com/x", "f", declared.d))).toBe("too_large");
  // No length declared, and the body just keeps coming.
  let sent = 0;
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent += 1024 * 1024;
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
  });
  const undeclared = deps({ fetchRemote: async () => new Response(endless, { headers: { "content-type": "image/jpeg" } }) });
  expect(await reason(keepRemoteImage("https://example.com/x", "f", undeclared.d))).toBe("too_large");
  expect(sent).toBeLessThan(MAX_REMOTE_IMAGE_BYTES + 4 * 1024 * 1024);
  expect(undeclared.stored).toEqual([]);
});

test("bytes that are not a picture, and a store that fails", async () => {
  const garbage = deps({ scale: async () => { throw new Error("Input buffer contains unsupported image format"); } });
  expect(await reason(keepRemoteImage("https://example.com/x", "f", garbage.d))).toBe("undecodable");
  expect(garbage.stored).toEqual([]);
  const full = deps({ store: async () => { throw new Error("ENOSPC"); } });
  expect(await reason(keepRemoteImage("https://example.com/x", "f", full.d))).toBe("storage");
});

test("a host that sends no type, or a generic one, is left to the decoder", async () => {
  for (const type of [undefined, "application/octet-stream", "binary/octet-stream"]) {
    const { d, stored } = deps({
      fetchRemote: async () => new Response(new Uint8Array([1]), type ? { headers: { "content-type": type } } : undefined),
    });
    // Response adds text/plain to a string body, not to bytes: no header here means none.
    expect(await reason(keepRemoteImage("https://example.com/x", "f", d)), String(type)).toBe("kept");
    expect(stored).toHaveLength(1);
  }
});

test("a Wikimedia original is asked for as its standard thumbnail first, at the width that covers what is kept", () => {
  const original = "https://upload.wikimedia.org/wikipedia/commons/3/3f/Fronalpstock_big.jpg";
  const thumb = (w: number) => `https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Fronalpstock_big.jpg/${w}px-Fronalpstock_big.jpg`;
  expect(remoteCandidates(original, 1600)).toEqual([thumb(1920), original]);
  expect(remoteCandidates(original, 1200)).toEqual([thumb(1280), original]);
  expect(remoteCandidates(original, 600)).toEqual([thumb(960), original]);
  // A language wiki's own upload, and a name with escapes, keep their spelling.
  expect(remoteCandidates("https://upload.wikimedia.org/wikipedia/de/a/ab/K%C3%A4se_Sp%C3%A4tzle.JPG", 1600)[0]).toBe(
    "https://upload.wikimedia.org/wikipedia/de/thumb/a/ab/K%C3%A4se_Sp%C3%A4tzle.JPG/1920px-K%C3%A4se_Sp%C3%A4tzle.JPG",
  );
  // Already a thumbnail, another host, a file type whose thumbnail has another name, nonsense: as they are.
  for (const url of [thumb(1280), "https://images.unsplash.com/photo-1", "https://upload.wikimedia.org/wikipedia/commons/3/3f/Diagram.svg", "https://upload.wikimedia.org.evil.example/wikipedia/commons/3/3f/x.jpg", "not a url"]) {
    expect(remoteCandidates(url, 1600), url).toEqual([url]);
  }
});

test("when the thumbnail is not to be had, the original is; an address that may not be fetched is not tried twice", async () => {
  const original = "https://upload.wikimedia.org/wikipedia/commons/3/3f/Small.jpg";
  const asked: string[] = [];
  const small = deps({
    fetchRemote: async (url) => {
      asked.push(url);
      // A file narrower than the standard width has no such thumbnail.
      return url.includes("/thumb/") ? new Response("no", { status: 400 }) : new Response(new Uint8Array([1]), { headers: { "content-type": "image/jpeg" } });
    },
  });
  expect(await reason(keepRemoteImage(original, "f", small.d))).toBe("kept");
  expect(asked).toEqual(["https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Small.jpg/1920px-Small.jpg", original]);
  expect(small.stored).toHaveLength(1);

  const calls: string[] = [];
  const blocked = deps({ fetchRemote: async (url) => { calls.push(url); throw new Blocked("no"); } });
  expect(await reason(keepRemoteImage(original, "f", blocked.d))).toBe("blocked");
  expect(calls).toHaveLength(1);
});

test("the server says who it is: an unnamed client is what Wikimedia answers 429", () => {
  expect(KEEP_IMAGE_USER_AGENT).toMatch(/^Kinboard\/[0-9.]+ \(\+https:\/\/[^)]+\)$/);
  const route = readFileSync(join(__dirname, "..", "src", "app", "api", "recipes", "keep-image", "route.ts"), "utf8");
  expect(route).toContain('"User-Agent": KEEP_IMAGE_USER_AGENT');
});

test("a smaller size can be asked for: a shopping tile is not kept at a recipe's size", async () => {
  const { d, scaledWith } = deps();
  await keepRemoteImage("https://example.com/milk.jpg", "fam-1", d, 600);
  expect(scaledWith).toEqual([600]);
});

test("a backup gets the addresses the pictures came from, and leaves every other row as it is", () => {
  const sources = new Map([
    ["/storage/v1/object/public/recipe-images/f/1.webp", "https://upload.wikimedia.org/a.jpg"],
    ["/storage/v1/object/public/shopping-images/f/2.webp", "https://images.openfoodfacts.org/b.jpg"],
  ]);
  const uploaded = { id: "u", image_url: "/storage/v1/object/public/recipe-images/f/own-photo.jpg" };
  const untouched = { id: "n", image_url: null, title: "x" };
  const rows = [
    { id: "r", image_url: "/storage/v1/object/public/recipe-images/f/1.webp", title: "Soup" },
    uploaded,
    untouched,
    { id: "c", image_url: "/storage/v1/object/public/shopping-images/f/2.webp", thumbnail_url: "/storage/v1/object/public/shopping-images/f/2.webp" },
  ];
  const out = withSourceAddresses(rows, sources);
  expect(out[0]).toEqual({ id: "r", image_url: "https://upload.wikimedia.org/a.jpg", title: "Soup" });
  // An uploaded photo has no source: it stays, and the export lists it as a file to copy.
  expect(out[1]).toBe(uploaded);
  expect(out[2]).toBe(untouched);
  expect(out[3]).toEqual({ id: "c", image_url: "https://images.openfoodfacts.org/b.jpg", thumbnail_url: "https://images.openfoodfacts.org/b.jpg" });
  // The rows given in are not changed.
  expect(rows[0].image_url).toBe("/storage/v1/object/public/recipe-images/f/1.webp");
  expect(withSourceAddresses(null, sources)).toEqual([]);
});

test("the route works on the caller's own row only, records the source first, and writes back only if the address is still the one it fetched", () => {
  const route = readFileSync(join(__dirname, "..", "src", "app", "api", "recipes", "keep-image", "route.ts"), "utf8");
  expect(route).toContain("const auth = await requireSession(request);");
  // Read under the session's family, never one from the body.
  expect(route).toContain("const familyId = auth.session.familyId;");
  expect(route).toContain('query.eq("family_id", familyId)');
  expect(route).toContain('query.eq("pocket_money_accounts.family_id", familyId)');
  expect(route).not.toMatch(/body\??\.family_id/);
  expect(route).toContain('.eq("image_url", remote);');
  // The address fetched comes from the row, through the guarded fetch.
  expect(route).toContain("safeFetch(url,");
  expect(route).not.toMatch(/body\??\.url/);
  // Where it came from is written before the row is changed, and a failure there stops it.
  const record = route.indexOf('.from("kept_images")');
  const change = route.indexOf(".update({ image_url: local })");
  expect(record).toBeGreaterThan(-1);
  expect(change).toBeGreaterThan(record);
  expect(route.slice(record, change)).toContain('throw new KeepImageError("storage", `kept_images:');
});

test("the export writes source addresses back before it counts stored files", () => {
  const route = readFileSync(join(__dirname, "..", "src", "app", "api", "export", "route.ts"), "utf8");
  const back = route.indexOf("recipes = withSourceAddresses(recipes, keptSources);");
  expect(back).toBeGreaterThan(-1);
  expect(route.indexOf("const storageObjects = collectStorageObjects({")).toBeGreaterThan(back);
  for (const table of ["shopping_items", "item_catalog", "pocket_money_goals"]) {
    expect(route).toContain(`${table} = withSourceAddresses(${table}, keptSources);`);
  }
});

test("the table of sources is the server's alone", () => {
  const sql = readFileSync(join(__dirname, "..", "docker", "migrations", "093_kept_images.sql"), "utf8");
  for (const role of ["PUBLIC", "anon", "authenticated"]) expect(sql).toContain(`REVOKE ALL ON TABLE public.kept_images FROM ${role};`);
  expect(sql).toContain("GRANT ALL ON TABLE public.kept_images TO service_role;");
  expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS");
  expect(sql).not.toMatch(/GRANT[^;]*\b(anon|authenticated)\b/i);
});

test.describe("against a running server and the internet", () => {
  const FAMILY_CODE = process.env.FAMILY_CODE ?? "";
  const REMOTE = process.env.KEEP_IMAGE_REMOTE_URL ?? "";
  test.skip(!FAMILY_CODE || !REMOTE, "needs a running stack and KEEP_IMAGE_REMOTE_URL (a public picture)");
  // A cold dev server compiles each route on first use, and the picture is 14 MB.
  test.describe.configure({ timeout: 600_000 });

  const psql = (sql: string) =>
    execFileSync("docker", ["exec", "-i", process.env.DB_CONTAINER ?? "kbfresh-db", "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c", sql], { encoding: "utf8" }).trim();
  const TITLE = "claude-keep-image";
  const cleanup = () => {
    psql(`DELETE FROM recipes WHERE title LIKE '${TITLE}%'`);
    psql(`DELETE FROM shopping_items WHERE name LIKE '${TITLE}%'`);
    psql(`DELETE FROM item_catalog WHERE name LIKE '${TITLE}%'`);
    psql(`DELETE FROM pocket_money_goals WHERE name LIKE '${TITLE}%'`);
    psql(`DELETE FROM kept_images WHERE source_url = '${REMOTE}'`);
    psql(`DELETE FROM devices WHERE name LIKE '${TITLE}%'`);
  };
  test.beforeAll(cleanup);
  test.afterAll(cleanup);

  test("opening the recipes page brings a remote picture onto this server, smaller, and the page shows it from here", async ({ page }, testInfo) => {
    const familyId = psql(`SELECT id FROM families WHERE join_code = '${FAMILY_CODE}'`);
    const title = `${TITLE}-${testInfo.project.name}`;
    const id = psql(`INSERT INTO recipes (family_id, title, image_url) VALUES ('${familyId}', '${title}', '${REMOTE}') RETURNING id`);
    await establishSession(page, FAMILY_CODE, `${TITLE} ${testInfo.project.name}`);

    // Compile the route before the page needs it.
    await page.request.post("/api/recipes/keep-image", { data: { id: "nope" }, timeout: 180_000 });
    await page.goto("/recipes", { timeout: 180_000 });
    await expect.poll(() => psql(`SELECT image_url FROM recipes WHERE id = '${id}'`), { timeout: 300_000, intervals: [2_000] }).toMatch(
      new RegExp(`^/storage/v1/object/public/recipe-images/${familyId}/[0-9]+-[a-z0-9]+\\.webp$`),
    );
    const local = psql(`SELECT image_url FROM recipes WHERE id = '${id}'`);

    // The stored copy is a WebP no larger than the kept size.
    const stored = await page.request.get(local);
    expect(stored.status()).toBe(200);
    expect(stored.headers()["content-type"]).toBe("image/webp");
    const size = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    }, local);
    expect(Math.max(...size)).toBeLessThanOrEqual(KEPT_IMAGE_EDGE);
    expect(Math.max(...size)).toBeGreaterThan(0);

    // And the card on the page now loads it from here, not from the source.
    await expect(page.locator(`img[alt="${title}"]`).first()).toHaveAttribute("src", local, { timeout: 30_000 });

    // Asked again, nothing is fetched again.
    const again = await page.request.post("/api/recipes/keep-image", { data: { id } });
    expect(await again.json()).toEqual({ url: local, kept: false });

    // Where it came from is on record, and a backup carries that address, not the copy's.
    expect(psql(`SELECT source_url FROM kept_images WHERE family_id = '${familyId}' AND local_url = '${local}'`)).toBe(REMOTE);
    const backup = (await (await page.request.get(`/api/export?family_id=${familyId}`)).json()) as {
      data: { recipes: { id: string; image_url: string | null }[] };
      storage: { objects: { row_id: string }[] };
    };
    expect(backup.data.recipes.find((r) => r.id === id)?.image_url).toBe(REMOTE);
    expect(backup.storage.objects.some((o) => o.row_id === id)).toBe(false);
  });

  test("a shopping item and a savings goal: kept small, the family's catalogue entry follows, the goal keeps its source label", async ({ page }, testInfo) => {
    const familyId = psql(`SELECT id FROM families WHERE join_code = '${FAMILY_CODE}'`);
    const name = `${TITLE}-${testInfo.project.name}`;
    const item = psql(`INSERT INTO shopping_items (family_id, name, image_url) VALUES ('${familyId}', '${name}', '${REMOTE}') RETURNING id`);
    psql(`INSERT INTO item_catalog (family_id, name, name_normalized, image_url, thumbnail_url) VALUES ('${familyId}', '${name}', lower('${name}'), '${REMOTE}', '${REMOTE}')`);
    const account = psql(`SELECT id FROM pocket_money_accounts WHERE family_id = '${familyId}' LIMIT 1`);
    await establishSession(page, FAMILY_CODE, `${TITLE} ${testInfo.project.name} c`);

    const kept = (await (await page.request.post("/api/recipes/keep-image", { data: { id: item, kind: "shopping" }, timeout: 180_000 })).json()) as { url: string; kept: boolean };
    expect(kept.kept).toBe(true);
    expect(kept.url).toMatch(new RegExp(`^/storage/v1/object/public/shopping-images/${familyId}/`));
    expect(psql(`SELECT image_url FROM shopping_items WHERE id = '${item}'`)).toBe(kept.url);
    expect(psql(`SELECT image_url || '|' || thumbnail_url FROM item_catalog WHERE family_id = '${familyId}' AND name = '${name}'`)).toBe(`${kept.url}|${kept.url}`);
    const served = await page.request.get(kept.url);
    expect(served.status()).toBe(200);
    const edge = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      return Math.max(img.naturalWidth, img.naturalHeight);
    }, kept.url);
    expect(edge).toBeLessThanOrEqual(600);

    test.skip(!account, "the family has no pocket-money account to hang a goal on");
    const goal = psql(`INSERT INTO pocket_money_goals (account_id, name, target_amount_cents, image_url, image_source) VALUES ('${account}', '${name}', 1000, '${REMOTE}', 'url') RETURNING id`);
    const keptGoal = (await (await page.request.post("/api/recipes/keep-image", { data: { id: goal, kind: "goal" }, timeout: 180_000 })).json()) as { url: string; kept: boolean };
    expect(keptGoal.kept).toBe(true);
    expect(keptGoal.url).toMatch(new RegExp(`^/storage/v1/object/public/goal-images/${familyId}/`));
    expect(psql(`SELECT image_url || '|' || image_source FROM pocket_money_goals WHERE id = '${goal}'`)).toBe(`${keptGoal.url}|url`);
  });

  test("another family's recipe is not found, and no session is refused", async ({ page, request }, testInfo) => {
    const other = psql(`SELECT id FROM recipes WHERE family_id <> (SELECT id FROM families WHERE join_code = '${FAMILY_CODE}') LIMIT 1`);
    await establishSession(page, FAMILY_CODE, `${TITLE} ${testInfo.project.name} b`);
    if (other) expect((await page.request.post("/api/recipes/keep-image", { data: { id: other } })).status()).toBe(404);
    expect((await page.request.post("/api/recipes/keep-image", { data: { id: "00000000-0000-4000-8000-000000000000" } })).status()).toBe(404);
    expect((await page.request.post("/api/recipes/keep-image", { data: { id: "nope" } })).status()).toBe(400);
    expect((await page.request.post("/api/recipes/keep-image", { data: { id: "00000000-0000-4000-8000-000000000000", kind: "people" } })).status()).toBe(400);
    expect([401, 403]).toContain((await request.post("/api/recipes/keep-image", { data: { id: "00000000-0000-4000-8000-000000000000" } })).status());
  });
});
