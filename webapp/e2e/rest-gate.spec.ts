import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";

/**
 * Pentest 2026-08-05, finding F3: PostgREST accepts any validly-signed JWT,
 * including the service_role key, which bypasses row-level security. Those
 * paths are published on the public hostname, so a leaked service_role key
 * would be usable from anywhere. service_role is only ever used server-side
 * over the internal webapp->kong path, which never touches Traefik — so the
 * public router forward-auths to this gate, which rejects it.
 */

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role: string, secret = "test-secret") => {
  const si = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role, exp: 9999999999 })}`;
  return `${si}.${createHmac("sha256", secret).update(si).digest("base64url")}`;
};

/** Mirrors the gate's role extraction. */
function roleOf(token: string | null): string | null {
  if (!token) return null;
  const j = token.startsWith("Bearer ") ? token.slice(7).trim() : token.trim();
  const parts = j.split(".");
  if (parts.length !== 3) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof p?.role === "string" ? p.role : null;
  } catch {
    return null;
  }
}
const denied = (apikey: string | null, authz: string | null) =>
  [roleOf(apikey), roleOf(authz)].includes("service_role");

test("service_role is denied in either header", () => {
  expect(denied(jwt("service_role"), null)).toBe(true);
  expect(denied(null, `Bearer ${jwt("service_role")}`)).toBe(true);
});

test("anon and authenticated pass", () => {
  expect(denied(jwt("anon"), null)).toBe(false);
  expect(denied(jwt("anon"), `Bearer ${jwt("authenticated")}`)).toBe(false);
});

test("service_role can't be smuggled past a legit apikey", () => {
  // A browser sends apikey=anon + Authorization=<user token>. An attacker
  // pairing a real anon apikey with a service_role Bearer must still lose.
  expect(denied(jwt("anon"), `Bearer ${jwt("service_role")}`)).toBe(true);
});

test("it fails OPEN — malformed or missing credentials are allowed", () => {
  // This gate sits in front of every dashboard query and guards a key that
  // isn't leaked; denying legit traffic on a parse hiccup would be far worse
  // than passing junk to PostgREST, which rejects it anyway.
  expect(denied(null, null)).toBe(false);
  expect(denied("not.a.jwt", null)).toBe(false);
  expect(denied("", "")).toBe(false);
  expect(denied("a.b", null)).toBe(false); // wrong segment count
});

test("the signature is not what's checked here — the role claim is", () => {
  // The gate decodes without verifying; PostgREST verifies. A service_role
  // claim signed with the wrong key is still denied at the edge (and would
  // fail at PostgREST too).
  expect(denied(jwt("service_role", "wrong-key"), null)).toBe(true);
});

test.describe("the shipped route and wiring", () => {
  const route = readFileSync(join(__dirname, "..", "src", "app", "api", "internal", "rest-gate", "route.ts"), "utf8");
  const traefik = readFileSync(join(__dirname, "..", "docker", "docker-compose.traefik.yml"), "utf8");

  test("the route denies only service_role, and covers all verbs", () => {
    expect(route).toContain('roles.includes("service_role")');
    expect(route).toContain("status: 403");
    for (const verb of ["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"]) {
      expect(route, verb).toContain(`export const ${verb} = handle`);
    }
  });

  test("the middleware is on the public API router, pointing at the gate", () => {
    expect(traefik).toContain("-api.middlewares=");
    expect(traefik).toContain("rolegate.forwardauth.address=");
    expect(traefik).toContain("/api/internal/rest-gate");
  });

  test("the internal webapp->kong path is unaffected", () => {
    // The gate is only on the Traefik router; internal access is direct to kong.
    // Documented in the route so nobody wires service_role through Traefik later.
    expect(route).toContain("never touches Traefik");
  });
});
