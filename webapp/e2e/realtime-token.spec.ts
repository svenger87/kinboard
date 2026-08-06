import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The realtime socket must carry the family-scoped token.
 *
 * This is pinned because the failure is invisible. supabase-js resolves the
 * WebSocket's token in `_getAccessToken()`, which is a different path from the
 * `global.fetch` override that authenticates every HTTP call — a socket never
 * goes through fetch. With no `accessToken` option it falls back to
 * `auth.getSession()` and then to the anon key.
 *
 * Kinboard doesn't use GoTrue, so there was never a session to find, and the
 * socket connected with the anon key. That key has no `family_id` claim, so
 * `current_family_id()` is NULL inside `realtime.apply_rls()` and every policy
 * filters every row away. The connection succeeded and delivered nothing, from
 * the day row-level security landed in 1.6.0 until this was found.
 *
 * Nothing complained: the "live updates paused" pill watches the *connection*,
 * and the connection was healthy. Only the data was missing. A test is the only
 * thing that would notice.
 */

const src = (...p: string[]) => readFileSync(join(__dirname, "..", "src", ...p), "utf8");

test("the browser client passes an accessToken to supabase-js", () => {
  const client = src("lib", "supabase", "client.ts");
  expect(client).toMatch(/accessToken:\s*async\s*\(\)\s*=>/);
});

test("that token is the family token, not the anon key", () => {
  const client = src("lib", "supabase", "client.ts");
  const opt = client.slice(client.indexOf("accessToken:"));
  expect(opt.slice(0, 200)).toContain("getFamilyToken");
});

test("it falls back to the anon key so anonymous pages still connect", () => {
  // /join has no family yet. Returning null there would leave the socket
  // unable to open at all, which is a regression rather than a fix.
  const client = src("lib", "supabase", "client.ts");
  const opt = client.slice(client.indexOf("accessToken:"));
  expect(opt.slice(0, 200)).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
});

test("the socket is re-authenticated before the token expires", () => {
  // Tokens last an hour; a wall display holds one socket for days. Without a
  // refresh the JWT ages out and the server stops honouring the subscription
  // while the connection still looks fine — the same silent failure again.
  const realtime = src("hooks", "use-realtime.ts");
  expect(realtime).toMatch(/realtime\.setAuth\(\)/);
  expect(realtime).toMatch(/REALTIME_REAUTH_INTERVAL_MS/);

  const interval = /const REALTIME_REAUTH_INTERVAL_MS = ([^;]+);/.exec(realtime);
  expect(interval, "refresh interval must be declared").not.toBeNull();
  // Comfortably inside the 1-hour FAMILY_TOKEN_TTL_SECONDS.
  expect(eval(interval![1])).toBeLessThan(60 * 60 * 1000);
});

test("the refresh timer is cleared when the subscription goes away", () => {
  const realtime = src("hooks", "use-realtime.ts");
  expect(realtime).toContain("clearInterval(reauthTimer)");
});
