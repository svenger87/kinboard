import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createAdminClient } from "../src/lib/supabase/server";
import { dbContainer } from "./whole-database";

/**
 * RFC-018 §4 against a real database: migrations/071_image_urls_relative.sql
 * turns a stored picture link into the relative form only when it names an
 * object that is really in this install's storage — whatever host it carries,
 * because an install that changed address has rows under several hosts, all
 * its own. A picture somebody pasted from elsewhere must never be touched,
 * even one from another Supabase-backed site with exactly the same path shape.
 *
 * The rule lives in public.relative_storage_url(), which the migration's
 * UPDATE calls; it is exercised here through the service role, the only role
 * allowed to call it.
 */

const HAS_STACK = !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
test.skip(!HAS_STACK && !process.env.FAMILY_CODE, "needs SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL for a running stack");
test.describe.configure({ mode: "serial" });

const BUCKET = "recipe-images";
const NAME = `e2e-relative/${Date.now().toString(36)}-relative.png`;
const PATH = `/storage/v1/object/public/${BUCKET}/${NAME}`;
// Family photos are a private bucket: a "public" link to one is not a picture
// anybody could load, so it is not rewritten into one either.
const PRIVATE_BUCKET = "family-photos";

let db: any;

async function relative(url: string | null): Promise<string | null> {
  const { data, error } = await db.rpc("relative_storage_url", { p_url: url });
  expect(error).toBeNull();
  return data as string | null;
}

/**
 * Since 1.15 nothing writes storage.objects (uploads are plain files), and a
 * fresh install has no storage schema at all: supabase/postgres does not
 * create it, storage-api did. 071 is a one-time rewrite of URLs stored before
 * 1.13, so it only ever has work on an install upgraded from one that ran
 * storage-api — which still has the table. There the objects are seeded as
 * rows; on a stack without the table, the tests that need "our own object"
 * skip, and the function's pass-through is what is checked.
 */
let hasStorage = false;
const psql = (sql: string) =>
  execFileSync("docker", ["exec", "-i", dbContainer(), "psql", "-U", "supabase_admin", "-d", "postgres", "-tAq", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
  }).trim();

test.beforeAll(async () => {
  db = createAdminClient();
  hasStorage = psql("SELECT to_regclass('storage.objects') IS NOT NULL AND to_regclass('storage.buckets') IS NOT NULL;") === "t";
  if (!hasStorage) return;
  for (const bucket of [BUCKET, PRIVATE_BUCKET]) {
    psql(`INSERT INTO storage.objects (bucket_id, name) VALUES ('${bucket}', '${NAME}');`);
  }
});

test.afterAll(async () => {
  if (hasStorage) psql(`DELETE FROM storage.objects WHERE name = '${NAME}';`);
});

test("our own object becomes relative, under any host it was stored with", async () => {
  test.skip(!hasStorage, "no storage schema on this stack (fresh 1.15): nothing was ever stored with an absolute URL");
  for (const host of ["http://192.168.1.10:8100", "https://kinboard.example.com", "http://kong:8000", "HTTP://LAN:3001"]) {
    expect(await relative(`${host}${PATH}`)).toBe(PATH);
  }
});

test("the same path shape on somebody else's site is left alone", async () => {
  const foreign = `https://other.supabase.co/storage/v1/object/public/${BUCKET}/e2e-relative/not-ours.png`;
  expect(await relative(foreign)).toBe(foreign);
});

test("an object in a private bucket is not turned into a public link", async () => {
  const url = `http://192.168.1.10:8100/storage/v1/object/public/${PRIVATE_BUCKET}/${NAME}`;
  expect(await relative(url)).toBe(url);
});

test("links that are not ours, or not absolute, pass through unchanged", async () => {
  for (const url of [
    PATH,
    "https://img.chefkoch-cdn.de/rezepte/x.jpg",
    `http://192.168.1.10:8100${PATH}?width=200`,
    `http://192.168.1.10:8100/storage/v1/object/sign/${BUCKET}/${NAME}?token=t`,
  ]) {
    expect(await relative(url)).toBe(url);
  }
  expect(await relative(null)).toBeNull();
});

test("idempotent: the relative form maps to itself", async () => {
  const once = await relative(`http://192.168.1.10:8100${PATH}`);
  expect(await relative(once)).toBe(once);
});

/**
 * The migration itself, as the webapp's entrypoint runs it: psql as
 * `postgres`, which is not a superuser here, against real rows.
 */
test("the migration's UPDATE, run as postgres, rewrites only our own row, and a second run changes nothing", async () => {
  test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE for a family to own the rows");
  test.skip(!hasStorage, "no storage schema on this stack (fresh 1.15): nothing was ever stored with an absolute URL");
  const { data: fam } = await db.from("families").select("id").eq("join_code", process.env.FAMILY_CODE).single();
  const ours = `http://192.168.1.10:8100${PATH}`;
  const foreign = `https://other.supabase.co${PATH}`.replace(NAME, "e2e-relative/not-ours.png");
  const { data: rows, error } = await db
    .from("recipes")
    .insert([
      { family_id: fam.id, title: "e2e-relative ours", image_url: ours },
      { family_id: fam.id, title: "e2e-relative foreign", image_url: foreign },
    ])
    .select("id, image_url");
  expect(error).toBeNull();
  const ids = (rows as { id: string }[]).map((r) => r.id);
  const migration = readFileSync("docker/migrations/071_image_urls_relative.sql", "utf8");
  const run = () =>
    execFileSync("docker", ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
      input: migration,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  const urls = async () => {
    const { data } = await db.from("recipes").select("title, image_url").in("id", ids).order("title");
    return (data as { title: string; image_url: string }[]).map((r) => r.image_url);
  };
  try {
    run();
    expect(await urls()).toEqual([foreign, PATH]);
    run();
    expect(await urls()).toEqual([foreign, PATH]);
  } finally {
    // Soft-delete trigger: the first delete bins, the second removes.
    for (let i = 0; i < 2; i++) await db.from("recipes").delete().in("id", ids);
  }
});

test("not part of the public API", async () => {
  const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!.replace(/\/+$/, "");
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  test.skip(!anon, "needs NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const res = await fetch(`${base}/rest/v1/rpc/relative_storage_url`, {
    method: "POST",
    headers: { apikey: anon!, Authorization: `Bearer ${anon}`, "content-type": "application/json" },
    body: JSON.stringify({ p_url: `http://x${PATH}` }),
  });
  expect(res.ok).toBe(false);
});
