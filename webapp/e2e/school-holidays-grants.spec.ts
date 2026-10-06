import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dbContainer } from "./whole-database";
import { postJoin } from "./session";

/**
 * The browser client reads and writes `school_holidays` directly through
 * PostgREST as `anon`, so the table needs an explicit grant to that role.
 *
 * `ALTER DEFAULT PRIVILEGES` in this database grants new tables to
 * service_role, authenticator and the supabase admin roles — and to nobody
 * else. A new table therefore reaches the browser only if its migration writes
 * the GRANT out by hand.
 *
 * Shipped without one, the table was invisible to the app however correct its
 * RLS policy was: the insert was refused at the privilege layer and the form
 * appeared to do nothing. It survived review because a development database
 * that has picked up those default privileges grants them anyway, so it worked
 * locally and was dead on a correctly configured install.
 *
 * migration_zy_schema_hardening.sql records the same failure on
 * birthday_gift_ideas, with the same symptom. Twice is enough to assert it.
 */

const sql = readFileSync("docker/migration_school_holidays.sql", "utf8");

test("the migration grants school_holidays to the browser roles", () => {
  for (const role of ["anon", "authenticated"]) {
    const granted = new RegExp(
      `GRANT[^;]*\\bON\\s+TABLE\\s+public\\.school_holidays\\s+TO\\s+${role}\\b`,
      "i",
    ).test(sql);
    expect(granted, `no GRANT on public.school_holidays to ${role}`).toBe(true);
  }
});

test("the grant covers the writes the settings form makes", () => {
  const block = sql.slice(sql.indexOf("-- GRANTS"));
  for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    expect(block, `${privilege} missing from the browser grant`).toContain(privilege);
  }
});

const syncSql = readFileSync("docker/migration_zzzzz_school_holiday_sync.sql", "utf8");

test("the browser roles may write manual rows only (RFC-014 §5.1)", () => {
  for (const cmd of ["INSERT", "UPDATE", "DELETE"]) {
    expect(syncSql, cmd).toMatch(new RegExp(`AS RESTRICTIVE FOR ${cmd} TO anon, authenticated`));
  }
  expect(syncSql).toMatch(/REVOKE ALL ON FUNCTION public\.apply_school_holiday_sync\([^)]*\) FROM anon, authenticated/);
});

test.describe("through Kong, as the browser", () => {
  const FAMILY_CODE = process.env.FAMILY_CODE ?? "";
  test.skip(!FAMILY_CODE, "needs FAMILY_CODE and a running stack");

  test("a family can add a manual row, but not a synced one, and cannot touch a synced one", async ({ page }, testInfo) => {
    // Nothing is rendered, so one project is enough -- and the sync call below
    // deletes synced rows in its window, which a second project running at
    // the same time would have in the same place.
    test.skip(testInfo.project.name !== "desktop", "a database check; desktop only");
    // Ids of this run alone, so a parallel run of this or another live spec
    // keeps its session and its rows.
    const run = `${testInfo.project.name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const hardwareId = `e2e-claude-grants-${run}`;
    const synced = `claude-synced-${run}`;
    const psql = (sql: string) =>
      execFileSync("docker", ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c", sql], { encoding: "utf8" }).trim();

    await page.goto("/join", { waitUntil: "domcontentloaded" });
    const env = await page.evaluate(() => (window as unknown as { __ENV: Record<string, string> }).__ENV);
    // `same-origin` when Kong serves the app (RFC-018): the API is then at the page's own origin.
    const apiBase = env.NEXT_PUBLIC_SUPABASE_URL === "same-origin"
      ? await page.evaluate(() => window.location.origin)
      : env.NEXT_PUBLIC_SUPABASE_URL;
    // Through postJoin, which waits out a 429: the CI run joins from one IP for
    // every spec, and a single plain fetch here failed on the join limit alone.
    const joinRes = await postJoin(page.request, { joinCode: FAMILY_CODE, hardwareId, deviceName: "claude-grants" });
    expect(joinRes.ok(), await joinRes.text()).toBe(true);
    const joined = await joinRes.json();
    const familyId: string = joined.family.id;
    const rest = (method: string, path: string, data?: unknown) =>
      page.request.fetch(`${apiBase}/rest/v1/${path}`, {
        method,
        headers: {
          apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${joined.token}`,
          "content-type": "application/json",
          Prefer: "return=representation",
        },
        data,
      });

    try {
      const mine = await rest("POST", "school_holidays", { family_id: familyId, name: `claude-manual-${run}`, starts_on: "2031-01-01", ends_on: "2031-01-02" });
      expect(mine.status()).toBe(201);

      const forged = await rest("POST", "school_holidays", {
        family_id: familyId, name: `claude-forged-${run}`, starts_on: "2031-02-01", ends_on: "2031-02-02",
        source: "openholidays", external_id: `claude-forged-${run}`,
      });
      expect(forged.status()).toBe(403);

      // A synced row, put there as the owner: the function would want the
      // family's sync switched on for exactly this region, which this shared
      // family's setting need not be.
      psql(`INSERT INTO school_holidays (family_id, source, external_id, name, starts_on, ends_on, synced_at) VALUES ('${familyId}', 'openholidays', '${synced}', '${synced}', '2031-03-01', '2031-03-02', now());`);
      const edit = await rest("PATCH", `school_holidays?external_id=eq.${synced}`, { name: "edited", hidden: true });
      expect(await edit.json()).toEqual([]);
      const remove = await rest("DELETE", `school_holidays?external_id=eq.${synced}`);
      expect(await remove.json()).toEqual([]);
      expect(psql(`SELECT name || '|' || hidden FROM school_holidays WHERE external_id = '${synced}';`)).toBe(`${synced}|false`);
    } finally {
      psql(`DELETE FROM school_holidays WHERE family_id = '${familyId}' AND name LIKE 'claude-%-${run}';`);
      psql(`DELETE FROM devices WHERE hardware_id = '${hardwareId}';`);
    }
  });
});
