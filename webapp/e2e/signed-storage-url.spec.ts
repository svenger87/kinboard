import { test, expect } from "@playwright/test";
import { toBrowserStorageUrl } from "../src/lib/supabase/signed-url";

/**
 * `createAdminClient()` is built with SUPABASE_URL=http://kong:8000 so its own
 * calls take the in-network path — and `createSignedUrl` derives the URL it
 * returns from that same base. Handed straight to the browser, every signed
 * photo URL points at a hostname only the container can resolve.
 *
 * `publicStorageUrl` already solves this for public buckets by building the
 * URL itself. A signed URL cannot be rebuilt — the token is the point — so the
 * origin is swapped and the path and query kept exactly as issued.
 */

const EXTERNAL = "http://localhost:8130";

test("the internal origin is replaced with the browser-facing one", () => {
  const signed = "http://kong:8000/storage/v1/object/sign/family-photos/fam/a.jpg?token=abc.def";
  expect(toBrowserStorageUrl(signed, EXTERNAL, undefined)).toBe(
    "http://localhost:8130/storage/v1/object/sign/family-photos/fam/a.jpg?token=abc.def",
  );
});

test("the token survives untouched — it is what makes the URL work", () => {
  const token = "eyJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJmL2EuanBnIn0.sig-with-_-and-dashes";
  const signed = `http://kong:8000/storage/v1/object/sign/family-photos/f/a.jpg?token=${token}`;
  expect(toBrowserStorageUrl(signed, EXTERNAL, undefined)).toContain(`token=${token}`);
});

test("a trailing slash on the configured base does not double up", () => {
  const signed = "http://kong:8000/storage/v1/object/sign/family-photos/f/a.jpg?token=t";
  expect(toBrowserStorageUrl(signed, "http://localhost:8130/", undefined)).toBe(
    "http://localhost:8130/storage/v1/object/sign/family-photos/f/a.jpg?token=t",
  );
});

test("an https external base is honoured — a wall panel is often behind TLS", () => {
  const signed = "http://kong:8000/storage/v1/object/sign/family-photos/f/a.jpg?token=t";
  expect(toBrowserStorageUrl(signed, "https://kinboard.example.com", undefined)).toBe(
    "https://kinboard.example.com/storage/v1/object/sign/family-photos/f/a.jpg?token=t",
  );
});

/**
 * Kong's key-auth sits on the catchall `/storage/v1/` route. kong.yml splits
 * `/storage/v1/object/public/` off precisely so a browser <img> can load a
 * public-bucket image without carrying a key — signed URLs get no such
 * exemption, so without an apikey every one of them comes back
 *
 *   401 {"message":"No API key found in request"}
 *
 * which renders as a broken image and nothing in the logs about storage.
 * The anon key is public by design: it is inlined into the client bundle and
 * every other Supabase call the browser makes already carries it.
 */
test("the anon key is attached, because Kong's key-auth guards the signed route", () => {
  const signed = "http://kong:8000/storage/v1/object/sign/family-photos/f/a.jpg?token=t";
  const url = toBrowserStorageUrl(signed, EXTERNAL, "anon-key-123");
  expect(url).toContain("token=t");
  expect(url).toContain("apikey=anon-key-123");
});

test("an existing apikey is not appended twice", () => {
  const signed = "http://kong:8000/storage/v1/object/sign/f/a.jpg?token=t&apikey=already";
  const url = toBrowserStorageUrl(signed, EXTERNAL, "anon-key-123");
  expect(url.match(/apikey=/g)).toHaveLength(1);
  expect(url).toContain("apikey=already");
});

test("with no anon key configured the URL is left alone rather than given an empty one", () => {
  const signed = "http://kong:8000/storage/v1/object/sign/f/a.jpg?token=t";
  expect(toBrowserStorageUrl(signed, EXTERNAL, undefined)).toBe(
    "http://localhost:8130/storage/v1/object/sign/f/a.jpg?token=t",
  );
});

test("a relative signed URL is returned as-is rather than mangled", () => {
  expect(toBrowserStorageUrl("/storage/v1/object/sign/x?token=t", EXTERNAL, undefined)).toBe(
    "/storage/v1/object/sign/x?token=t",
  );
});

test("with no external base configured the path is kept, same as publicStorageUrl", () => {
  const signed = "http://kong:8000/storage/v1/object/sign/family-photos/f/a.jpg?token=t";
  expect(toBrowserStorageUrl(signed, undefined, undefined)).toBe(
    "/storage/v1/object/sign/family-photos/f/a.jpg?token=t",
  );
});
