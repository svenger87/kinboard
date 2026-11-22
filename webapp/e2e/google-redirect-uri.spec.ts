import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { googleAcceptsRedirect, googleRedirectUri } from "../src/lib/google-redirect";
import { codeOnly } from "./source-helpers";

/**
 * The Google redirect URI (#503). Docker installs never passed
 * GOOGLE_REDIRECT_URI into the container, and the routes fell back to
 * http://localhost:3000/api/google/callback, so every Connect asked Google
 * for that address whatever was registered: redirect_uri_mismatch. Now it
 * follows the address the request came in on, or GOOGLE_REDIRECT_URI when
 * the container gets one, and Settings shows it.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const headers = (h: Record<string, string>) => new Headers(h);

test("the redirect URI follows the address Kinboard was opened on", () => {
  expect(googleRedirectUri(headers({ host: "192.168.1.20:3001" }), "http://192.168.1.20:3001", undefined))
    .toBe("http://192.168.1.20:3001/api/google/callback");
  // Behind a TLS proxy: the forwarded scheme and host.
  expect(googleRedirectUri(headers({ host: "webapp:3000", "x-forwarded-host": "kinboard.example.com", "x-forwarded-proto": "https" }), "http://webapp:3000", undefined))
    .toBe("https://kinboard.example.com/api/google/callback");
  expect(googleRedirectUri(headers({ host: "localhost:3001" }), "http://localhost:3001", ""))
    .toBe("http://localhost:3001/api/google/callback");
  // Never the old hard-wired fallback when the screen is somewhere else.
  expect(googleRedirectUri(headers({ host: "kinboard.example.com" }), "http://kinboard.example.com", undefined))
    .not.toContain("localhost:3000");
});

test("GOOGLE_REDIRECT_URI, when set, wins", () => {
  expect(googleRedirectUri(headers({ host: "192.168.1.20:3001" }), "http://192.168.1.20:3001", " https://kinboard.example.com/api/google/callback "))
    .toBe("https://kinboard.example.com/api/google/callback");
});

test("which addresses Google lets a web client register", () => {
  for (const ok of [
    "https://kinboard.example.com/api/google/callback",
    "http://localhost:3001/api/google/callback",
    "http://127.0.0.1:3001/api/google/callback",
    "https://kinboard.duckdns.org:8443/api/google/callback",
  ]) expect(googleAcceptsRedirect(ok), ok).toBe(true);
  for (const no of [
    "http://192.168.1.20:3001/api/google/callback",
    "http://kinboard.example.com/api/google/callback",
    "https://192.168.1.20/api/google/callback",
    "https://server.local/api/google/callback",
    "https://nas.lan:3001/api/google/callback",
    "https://fritz.box/api/google/callback",
    "https://server/api/google/callback",
    "not a url",
  ]) expect(googleAcceptsRedirect(no), no).toBe(false);
});

test("the wiring: both routes ask the helper, the container gets the variable, Settings shows the address", () => {
  for (const route of ["src/app/api/google/auth/route.ts", "src/app/api/google/callback/route.ts"]) {
    const src = codeOnly(read(route));
    expect(src, route).toContain("googleRedirectUri(request.headers, request.nextUrl.origin)");
    expect(src, route).not.toContain("localhost:3000");
  }
  const probe = codeOnly(read("src/app/api/google/configured/route.ts"));
  expect(probe).toContain("redirectAccepted: googleAcceptsRedirect(redirectUri)");
  const compose = read("docker/docker-compose.yml");
  expect(compose).toMatch(/GOOGLE_REDIRECT_URI: \$\{GOOGLE_REDIRECT_URI:-\}/);
  const page = codeOnly(read("src/app/settings/google/page.tsx"));
  expect(page).toContain("<GoogleRedirectHint");
  for (const loc of ["en", "de", "fr", "zh"]) {
    const google = JSON.parse(read(`messages/${loc}.json`)).settings.google;
    for (const key of ["redirectHeading", "redirectBody", "redirectCopy", "redirectCopied", "redirectFixed", "redirectUnsupported"]) {
      expect(typeof google[key], `${loc}.${key}`).toBe("string");
    }
  }
});
