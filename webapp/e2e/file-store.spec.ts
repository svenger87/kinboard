import { test, expect } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentTypeFor, objectFile, openObject, putObject, removeObjects } from "../src/lib/files/store";
import { signedObjectUrl, verifySignedObject } from "../src/lib/files/signed";

/**
 * Uploaded files as plain files (1.15, replacing storage-api + imgproxy).
 * Keys come from URLs and database rows, so the store treats them as hostile.
 */

test.describe("object keys", () => {
  const root = "/srv/files";

  test("a bucket and key map under the bucket", () => {
    expect(objectFile("recipe-images", "fam/1700-abc.jpeg", root)).toBe("/srv/files/recipe-images/fam/1700-abc.jpeg");
  });

  test("nothing climbs out of its bucket, and unknown buckets do not exist", () => {
    for (const key of ["../family-photos/x.jpg", "fam/../../etc/passwd", "/etc/passwd", "fam//x.jpg", "fam/./x.jpg", "a\\\\b", "a\0b", ""]) {
      expect(objectFile("recipe-images", key, root), JSON.stringify(key)).toBeNull();
    }
    expect(objectFile("storage", "x.jpg", root)).toBeNull();
    expect(objectFile("..", "x.jpg", root)).toBeNull();
  });

  test("the type comes from the name; anything unknown is served as bytes, never as a page", () => {
    expect(contentTypeFor("f/a.jpeg")).toBe("image/jpeg");
    expect(contentTypeFor("f/a.WEBP")).toBe("image/webp");
    expect(contentTypeFor("f/a-thumb.webp")).toBe("image/webp");
    expect(contentTypeFor("f/a.svg")).toBe("application/octet-stream");
    expect(contentTypeFor("f/a.html")).toBe("application/octet-stream");
  });
});

test.describe("writing and reading", () => {
  let dir: string;
  test.beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kb-files-"));
    process.env.FILES_DIR = dir;
  });
  test.afterEach(() => {
    delete process.env.FILES_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  test("put, open, remove; a second put of the same key fails instead of overwriting", async () => {
    await putObject("goal-images", "fam/1-a.png", new Uint8Array([1, 2, 3]));
    expect(readFileSync(join(dir, "goal-images/fam/1-a.png"))).toEqual(Buffer.from([1, 2, 3]));
    await expect(putObject("goal-images", "fam/1-a.png", new Uint8Array([9]))).rejects.toThrow();
    expect(readFileSync(join(dir, "goal-images/fam/1-a.png"))).toEqual(Buffer.from([1, 2, 3]));
    const obj = await openObject("goal-images", "fam/1-a.png", dir);
    expect(obj?.stats.size).toBe(3);
    expect(obj?.contentType).toBe("image/png");
    await removeObjects("goal-images", ["fam/1-a.png", "fam/never-existed.png"]);
    expect(await openObject("goal-images", "fam/1-a.png", dir)).toBeNull();
  });

  test("without FILES_DIR an upload refuses rather than write where it would vanish", async () => {
    delete process.env.FILES_DIR;
    await expect(putObject("goal-images", "fam/1-a.png", new Uint8Array([1]))).rejects.toThrow(/FILES_DIR is not set/);
  });
});

test.describe("signed URLs for family photos", () => {
  const env = { JWT_SECRET: "test-secret" };
  const now = Date.UTC(2026, 10, 1, 12);
  const parse = (url: string) => {
    const u = new URL(url, "http://x");
    return { exp: u.searchParams.get("exp"), sig: u.searchParams.get("sig"), path: u.pathname };
  };

  test("relative, and valid for exactly the object it names until it expires", () => {
    const url = signedObjectUrl("family-photos", "fam/1-a.jpg", 3600, now, env);
    expect(url.startsWith("/storage/v1/object/sign/family-photos/fam/1-a.jpg?exp=")).toBe(true);
    const { exp, sig } = parse(url);
    expect(verifySignedObject("family-photos", "fam/1-a.jpg", exp, sig, now, env)).toBe(true);
    expect(verifySignedObject("family-photos", "fam/1-b.jpg", exp, sig, now, env)).toBe(false);
    expect(verifySignedObject("recipe-images", "fam/1-a.jpg", exp, sig, now, env)).toBe(false);
    expect(verifySignedObject("family-photos", "fam/1-a.jpg", exp, sig, now + 3601_000, env)).toBe(false);
  });

  test("a stretched expiry, another secret or garbage is refused", () => {
    const { exp, sig } = parse(signedObjectUrl("family-photos", "fam/1-a.jpg", 3600, now, env));
    expect(verifySignedObject("family-photos", "fam/1-a.jpg", String(Number(exp) + 60), sig, now, env)).toBe(false);
    expect(verifySignedObject("family-photos", "fam/1-a.jpg", exp, sig, now, { JWT_SECRET: "other" })).toBe(false);
    expect(verifySignedObject("family-photos", "fam/1-a.jpg", exp, "zz", now, env)).toBe(false);
    expect(verifySignedObject("family-photos", "fam/1-a.jpg", null, sig, now, env)).toBe(false);
  });
});
