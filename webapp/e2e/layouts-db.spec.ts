import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dbContainer } from "./whole-database";

/**
 * public.layouts and devices.layout_id (migrations/086_layouts.sql), against
 * the stack's database: RLS with a family read policy, no write grant for the
 * browser roles (the server writes layouts), the device column the browser
 * cannot write, deleting a layout clearing it, and the migration running again
 * without a change.
 *
 * In two families of their own, removed afterwards. Needs a running stack:
 * FAMILY_CODE says there is one (e2e.yml sets it).
 */

test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE: a running stack");
test.describe.configure({ mode: "serial" });

const FAMILY = "c1a0de00-0086-4000-8000-00000000d001";
const OTHER_FAMILY = "c1a0de00-0086-4000-8000-00000000d002";
const LAYOUT = "c1a0de00-0086-4000-8000-00000000d0a1";
const OTHER_LAYOUT = "c1a0de00-0086-4000-8000-00000000d0a2";
const DEVICE = "c1a0de00-0086-4000-8000-00000000d0e1";
const OLD_LAYOUT = "c1a0de00-0086-4000-8000-00000000d0a3";

function psql(sql: string, user = "postgres"): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", user, "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}

function asFamily(role: "authenticated" | "anon", family: string, sql: string): { ok: boolean; out: string } {
  try {
    const out = psql(`BEGIN;
      SELECT set_config('request.jwt.claims', '{"family_id":"${family}"}', true);
      SET LOCAL ROLE ${role};
      ${sql}
      COMMIT;`);
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: String((e as { stderr?: string }).stderr ?? e) };
  }
}

function purge() {
  psql(`SELECT set_config('kinboard.hard_delete', 'on', false);
    DELETE FROM devices WHERE family_id IN ('${FAMILY}', '${OTHER_FAMILY}');
    DELETE FROM families WHERE id IN ('${FAMILY}', '${OTHER_FAMILY}');`);
}

const grantsSql = `SELECT string_agg(grantee || ':' || privilege_type, ',' ORDER BY grantee, privilege_type)
  FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'layouts' AND grantee IN ('anon', 'authenticated', 'service_role')`;
const deviceGrantsSql = `SELECT string_agg(grantee || ':' || privilege_type || ':' || column_name, ',' ORDER BY grantee, privilege_type, column_name)
  FROM information_schema.column_privileges WHERE table_name = 'devices' AND grantee IN ('anon', 'authenticated')`;

test.beforeAll(() => {
  purge();
  psql(`INSERT INTO families (id, name, join_code, setup_completed) VALUES ('${FAMILY}', 'claude-layouts', 'CLAUDELAY01', true), ('${OTHER_FAMILY}', 'claude-layouts-2', 'CLAUDELAY02', true);
    INSERT INTO layouts (id, family_id, name, width, height) VALUES ('${LAYOUT}', '${FAMILY}', 'claude-layout', 1920, 1080), ('${OTHER_LAYOUT}', '${OTHER_FAMILY}', 'claude-layout-2', 1920, 1080);
    INSERT INTO devices (id, family_id, name, hardware_id) VALUES ('${DEVICE}', '${FAMILY}', 'claude-layout-tablet', 'claude-layout-tablet');`);
});

test.afterAll(() => {
  purge();
  expect(psql(`SELECT count(*) FROM families WHERE id IN ('${FAMILY}', '${OTHER_FAMILY}')`)).toBe("0");
  expect(psql(`SELECT count(*) FROM layouts WHERE id IN ('${LAYOUT}', '${OTHER_LAYOUT}')`)).toBe("0");
});

test("the table: RLS on with the family read policy, defaults and checks", () => {
  expect(psql(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.layouts'::regclass`)).toBe("t");
  expect(psql(`SELECT count(*) FROM pg_policies WHERE tablename = 'layouts' AND policyname = 'layouts_family_read' AND cmd = 'SELECT'`)).toBe("1");
  expect(psql(`SELECT count(*) FROM pg_policies WHERE tablename = 'layouts'`)).toBe("1");
  expect(psql(`SELECT home::text || '|' || screensaver::text FROM layouts WHERE id = '${LAYOUT}'`)).toBe("[]|[]");
  for (const bad of [
    `name, width, height) VALUES ('', 1000, 500`,
    `name, width, height) VALUES ('${"x".repeat(61)}', 1000, 500`,
    `name, width, height) VALUES ('a', 599, 500`,
    `name, width, height) VALUES ('a', 20001, 500`,
    `name, width, height) VALUES ('a', 1000, 299`,
    `name, width, height) VALUES ('a', 1000, 20001`,
  ]) {
    expect(() => psql(`INSERT INTO layouts (family_id, ${bad.replace("VALUES (", `VALUES ('${FAMILY}', `)})`), bad).toThrow();
  }
  expect(psql(`SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.layouts'::regclass AND tgname = 'kinboard_change_feed' AND NOT tgisinternal`)).toBe("1");
});

test("a family token reads its own family's layouts and nobody else's", () => {
  const mine = asFamily("authenticated", FAMILY, `SELECT id FROM layouts ORDER BY id;`);
  expect(mine.ok, mine.out).toBe(true);
  expect(mine.out).toContain(LAYOUT);
  expect(mine.out).not.toContain(OTHER_LAYOUT);
  const anon = asFamily("anon", FAMILY, `SELECT id FROM layouts;`);
  expect(anon.ok).toBe(false);
});

test("grants: the browser roles hold no write on layouts and none on devices.layout_id", () => {
  for (const role of ["anon", "authenticated"]) {
    for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      expect(psql(`SELECT has_table_privilege('${role}', 'public.layouts', '${priv}')`), `${role} ${priv}`).toBe("f");
    }
    expect(psql(`SELECT has_column_privilege('${role}', 'public.devices', 'layout_id', 'INSERT')
      || '|' || has_column_privilege('${role}', 'public.devices', 'layout_id', 'UPDATE')`), role).toBe("false|false");
  }
  expect(psql(`SELECT has_table_privilege('authenticated', 'public.layouts', 'SELECT')`)).toBe("t");
  expect(psql(`SELECT has_table_privilege('anon', 'public.layouts', 'SELECT')`)).toBe("f");
  expect(psql(`SELECT has_table_privilege('service_role', 'public.layouts', 'INSERT')
    AND has_table_privilege('service_role', 'public.layouts', 'UPDATE')
    AND has_table_privilege('service_role', 'public.layouts', 'DELETE')`)).toBe("t");

  const write = asFamily("authenticated", FAMILY, `UPDATE layouts SET name = 'x' WHERE id = '${LAYOUT}';`);
  expect(write.ok).toBe(false);
  const pick = asFamily("authenticated", FAMILY, `UPDATE devices SET layout_id = '${LAYOUT}' WHERE id = '${DEVICE}';`);
  expect(pick.ok).toBe(false);
  // The rest of a device is still writable.
  const beat = asFamily("authenticated", FAMILY, `UPDATE devices SET last_seen = now() WHERE id = '${DEVICE}' RETURNING id;`);
  expect(beat.ok, beat.out).toBe(true);
});

test("deleting a layout clears devices.layout_id and keeps the device", () => {
  expect(psql(`SELECT confrelid::regclass::text || '|' || confdeltype::text FROM pg_constraint
    WHERE conrelid = 'public.devices'::regclass AND contype = 'f'
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.devices'::regclass AND attname = 'layout_id')]::int2[]`))
    .toBe("layouts|n");
  psql(`UPDATE devices SET layout_id = '${LAYOUT}' WHERE id = '${DEVICE}'`);
  psql(`DELETE FROM layouts WHERE id = '${LAYOUT}'`);
  expect(psql(`SELECT name || '|' || COALESCE(layout_id::text, 'null') FROM devices WHERE id = '${DEVICE}'`)).toBe("claude-layout-tablet|null");
  psql(`INSERT INTO layouts (id, family_id, name, width, height) VALUES ('${LAYOUT}', '${FAMILY}', 'claude-layout', 1920, 1080)`);
});

test("the migration runs again on the next boot and changes nothing", () => {
  const file = readFileSync(join(process.cwd(), "docker", "migrations/086_layouts.sql"), "utf8");
  const before = [psql(grantsSql), psql(deviceGrantsSql)];
  psql(file);
  psql(file);
  expect([psql(grantsSql), psql(deviceGrantsSql)]).toEqual(before);
  expect(psql(`SELECT count(*) FROM pg_policies WHERE tablename = 'layouts'`)).toBe("1");
  expect(psql(`SELECT count(*) FROM layouts WHERE id = '${LAYOUT}'`)).toBe("1");
});

test("087: layouts.grid is NOT NULL, 48 by default; a 12-column row is converted to steps once", () => {
  expect(psql(`SELECT data_type || '|' || is_nullable || '|' || column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'layouts' AND column_name = 'grid'`)).toBe("smallint|NO|48");
  expect(psql(`SELECT grid FROM layouts WHERE id = '${LAYOUT}'`)).toBe("48");
  expect(() => psql(`UPDATE layouts SET grid = NULL WHERE id = '${LAYOUT}'`)).toThrow();

  // A row as an older image left it: cells, grid 12.
  const saver = `[{"id":"a","widget":"clock","x":7,"y":1,"w":5,"h":3,"text":"L","options":{"seconds":true}}]`;
  const home = `[{"id":"h","widget":"date","x":0,"y":2,"w":4,"h":1,"text":"M"}]`;
  psql(`INSERT INTO layouts (id, family_id, name, width, height, grid, home, screensaver, updated_at)
    VALUES ('${OLD_LAYOUT}', '${FAMILY}', 'claude-old', 1080, 1920, 12, '${home}'::jsonb, '${saver}'::jsonb, '2026-01-02T03:04:05Z')`);
  // A 48-step row with items must not be touched.
  psql(`UPDATE layouts SET screensaver = '[{"id":"b","widget":"date","x":1,"y":1,"w":8,"h":4,"text":"M"}]'::jsonb WHERE id = '${LAYOUT}'`);
  const row = (id: string) => psql(`SELECT grid || '|' || home::text || '|' || screensaver::text || '|' || updated_at::text FROM layouts WHERE id = '${id}'`);
  const fresh = row(LAYOUT);

  const file = readFileSync(join(process.cwd(), "docker", "migrations/087_layout_steps.sql"), "utf8");
  psql(file);
  expect(psql(`SELECT grid FROM layouts WHERE id = '${OLD_LAYOUT}'`)).toBe("48");
  expect(JSON.parse(psql(`SELECT screensaver::text FROM layouts WHERE id = '${OLD_LAYOUT}'`))).toEqual([
    { id: "a", widget: "clock", x: 28, y: 4, w: 20, h: 12, text: "L", options: { seconds: true } },
  ]);
  expect(JSON.parse(psql(`SELECT home::text FROM layouts WHERE id = '${OLD_LAYOUT}'`))).toEqual([
    { id: "h", widget: "date", x: 0, y: 8, w: 16, h: 4, text: "M" },
  ]);
  expect(psql(`SELECT updated_at = '2026-01-02T03:04:05Z' FROM layouts WHERE id = '${OLD_LAYOUT}'`)).toBe("t");
  expect(row(LAYOUT)).toBe(fresh);

  // Again, as on every boot: nothing changes.
  const converted = row(OLD_LAYOUT);
  psql(file);
  expect(row(OLD_LAYOUT)).toBe(converted);
  expect(row(LAYOUT)).toBe(fresh);
  expect(psql(`SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'layouts' AND column_name = 'grid'`)).toBe("48");
});
