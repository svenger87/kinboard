import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import {
  carriesServiceRole,
  downstreamResponseHeaders,
  roleOf,
  upstreamRequestHeaders,
} from "../src/lib/rest-proxy";

/**
 * /rest/v1 on the app's own origin, forwarded to PostgREST by the webapp
 * (1.15, replacing Kong). Pentest 2026-08-05, finding F3: PostgREST accepts
 * any validly signed JWT, including the service_role key, which bypasses
 * row-level security. That key is only ever used server-side, straight to
 * PostgREST inside the stack; from outside it is refused. The gate used to be
 * a Traefik forward-auth and so existed only on Traefik installs; it is now in
 * the proxy and on every install.
 */

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role: string, secret = "test-secret") => {
  const si = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role, exp: 9999999999 })}`;
  return `${si}.${createHmac("sha256", secret).update(si).digest("base64url")}`;
};
const h = (o: Record<string, string>) => new Headers(o);

test("service_role is refused in either header", () => {
  expect(carriesServiceRole(h({ authorization: `Bearer ${jwt("service_role")}` }))).toBe(true);
  expect(carriesServiceRole(h({ apikey: jwt("service_role") }))).toBe(true);
});

test("anon and family tokens pass, and service_role can't hide behind a legit apikey", () => {
  expect(carriesServiceRole(h({ apikey: jwt("anon"), authorization: `Bearer ${jwt("authenticated")}` }))).toBe(false);
  expect(carriesServiceRole(h({ apikey: jwt("anon"), authorization: `Bearer ${jwt("service_role")}` }))).toBe(true);
});

test("it fails open: malformed or missing credentials go on to PostgREST, which rejects them itself", () => {
  expect(carriesServiceRole(h({}))).toBe(false);
  expect(carriesServiceRole(h({ authorization: "Bearer not-a-jwt" }))).toBe(false);
  expect(roleOf("a.!!!.c")).toBeNull();
  // The signature is PostgREST's to check; the claim is what is gated here.
  expect(roleOf(jwt("service_role", "some-other-secret"))).toBe("service_role");
});

test("the device-session cookie and hop-by-hop headers never reach PostgREST", () => {
  const out = upstreamRequestHeaders(
    h({ cookie: "kb_session=x", host: "kb", connection: "keep-alive", apikey: "k", authorization: "Bearer t", prefer: "return=representation", range: "0-9" }),
  );
  expect([...out.keys()].sort()).toEqual(["authorization", "prefer", "range"]);
});

test("an already-decoded body is not described with the upstream's encoding or length", () => {
  const out = downstreamResponseHeaders(
    h({ "content-encoding": "gzip", "content-length": "12", "content-range": "0-9/10", "content-type": "application/json", "set-cookie": "x=1" }),
  );
  expect([...out.keys()].sort()).toEqual(["content-range", "content-type"]);
});

test("the route gates before it forwards, and covers every verb supabase-js uses", () => {
  const route = readFileSync("src/app/rest/v1/[...path]/route.ts", "utf8");
  expect(route.indexOf("carriesServiceRole(")).toBeLessThan(route.indexOf("await fetch("));
  for (const verb of ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"]) {
    expect(route).toMatch(new RegExp(`export const ${verb} = forward;`));
  }
});
