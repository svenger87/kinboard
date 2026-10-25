import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./source-helpers";

/**
 * Rotating the join code said "all connected devices will need to rejoin",
 * and none did: the rotation was a browser-side UPDATE of the code, a
 * session lives for a year, and nothing tied it to the code it joined with.
 * After a lost phone the new code changed who could join next, not who was
 * already in. revokeFamilySessions existed for exactly this and had no caller.
 */

const src = (...parts: string[]) => codeOnly(readFileSync(join(__dirname, "..", "src", ...parts), "utf8"));

test.describe("rotating the join code", () => {
  const route = src("app", "api", "family", "join-code", "route.ts");

  test("signs every other device out, and keeps the one doing it", () => {
    expect(route).toContain("revokeFamilySessions(familyId, { exceptSessionId: auth.session.sessionId })");
    const revoke = src("lib", "session.ts");
    expect(revoke).toContain('if (options.exceptSessionId) query = query.neq("id", options.exceptSessionId);');
    // A failed revoke must not read as success.
    expect(revoke).toContain("could not revoke sessions");
  });

  test("needs a session and the settings PIN", () => {
    expect(route).toContain("requireSession(request)");
    expect(route).toContain("requireSettingsUnlock(auth.session)");
    // The family is the session's, never one named in the request.
    expect(route).toContain("const familyId = auth.session.familyId;");
    expect(route).not.toMatch(/body\?\.family_id/);
  });

  test("draws the code from a cryptographic source", () => {
    expect(route).toContain("randomInt(JOIN_CODE_CHARS.length)");
    expect(route).not.toContain("Math.random");
  });

  test("the settings page goes through the route, not a direct update", () => {
    const hooks = src("hooks", "use-supabase-queries.ts");
    const hook = hooks.slice(hooks.indexOf("export function useRegenerateJoinCode"), hooks.indexOf("export function useRenameFamily"));
    expect(hook).toContain('fetch("/api/family/join-code"');
    expect(hook).not.toContain('.from("families")');
  });

  test("the confirmation says what happens, in every language", () => {
    for (const locale of ["en", "de", "fr"]) {
      const messages = JSON.parse(readFileSync(join(__dirname, "..", "messages", `${locale}.json`), "utf8"));
      expect(messages.settings.regenerateConfirm, locale).toBeTruthy();
      expect(messages.settings.regenerateFailed, locale).toBeTruthy();
    }
  });
});
