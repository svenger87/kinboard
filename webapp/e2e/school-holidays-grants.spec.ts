import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

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
