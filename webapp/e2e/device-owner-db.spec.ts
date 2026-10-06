import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dbContainer } from "./whole-database";

/**
 * devices.person_id (RFC-017 §8.2, migration_zzzzzzzzz_device_owner.sql),
 * against the stack's database: the column and what deleting the person does
 * to it, that the migration runs again on the next boot without a change, and
 * the grants -- a family token can still write everything else about a device
 * (the heartbeat, a rename, the kiosk switch) but not who it belongs to.
 *
 * In a family of its own, removed afterwards. Needs a running stack:
 * FAMILY_CODE says there is one (e2e.yml sets it).
 */

test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE: a running stack");
test.describe.configure({ mode: "serial" });

const FAMILY = "c1a0de00-0017-4000-8000-00000000d001";
const OTHER_FAMILY = "c1a0de00-0017-4000-8000-00000000d002";
const CHILD = "c1a0de00-0017-4000-8000-00000000d0a1";
const DEVICE = "c1a0de00-0017-4000-8000-00000000d0e1";

function psql(sql: string, user = "postgres"): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", user, "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}

/** The statement as a family token runs it: the role and the family_id claim PostgREST sets. */
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
    DELETE FROM people WHERE family_id IN ('${FAMILY}', '${OTHER_FAMILY}');
    DELETE FROM families WHERE id IN ('${FAMILY}', '${OTHER_FAMILY}');`);
}

test.beforeAll(() => {
  purge();
  psql(`INSERT INTO families (id, name, join_code, setup_completed) VALUES ('${FAMILY}', 'claude-device-owner', 'CLAUDEDOWN1', true), ('${OTHER_FAMILY}', 'claude-device-owner-2', 'CLAUDEDOWN2', true);
    INSERT INTO people (id, family_id, name, is_child) VALUES ('${CHILD}', '${FAMILY}', 'claude-owner-kid', true);
    INSERT INTO devices (id, family_id, name, hardware_id) VALUES ('${DEVICE}', '${FAMILY}', 'claude-owner-phone', 'claude-owner-phone');`);
});

test.afterAll(() => {
  purge();
  expect(psql(`SELECT count(*) FROM families WHERE id IN ('${FAMILY}', '${OTHER_FAMILY}')`)).toBe("0");
});

test("the column: a nullable uuid that refers to people and is cleared when the person goes", () => {
  expect(psql(`SELECT data_type || '|' || is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'devices' AND column_name = 'person_id'`)).toBe("uuid|YES");
  expect(psql(`SELECT confrelid::regclass::text || '|' || confdeltype::text FROM pg_constraint
    WHERE conrelid = 'public.devices'::regclass AND contype = 'f'
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.devices'::regclass AND attname = 'person_id')]::int2[]`))
    .toBe("people|n");

  psql(`UPDATE devices SET person_id = '${CHILD}' WHERE id = '${DEVICE}'`);
  psql(`SELECT set_config('kinboard.hard_delete', 'on', false); DELETE FROM people WHERE id = '${CHILD}';`);
  // The device stays, belonging to nobody.
  expect(psql(`SELECT name || '|' || COALESCE(person_id::text, 'null') FROM devices WHERE id = '${DEVICE}'`)).toBe("claude-owner-phone|null");
  psql(`INSERT INTO people (id, family_id, name, is_child) VALUES ('${CHILD}', '${FAMILY}', 'claude-owner-kid', true)`);
});

test("the migration runs again on the next boot and changes nothing", () => {
  const file = readFileSync(join(process.cwd(), "docker", "migration_zzzzzzzzz_device_owner.sql"), "utf8");
  const before = psql(`SELECT string_agg(grantee || ':' || privilege_type || ':' || column_name, ',' ORDER BY grantee, privilege_type, column_name)
    FROM information_schema.column_privileges WHERE table_name = 'devices' AND grantee IN ('anon', 'authenticated')`);
  psql(file);
  psql(file);
  const after = psql(`SELECT string_agg(grantee || ':' || privilege_type || ':' || column_name, ',' ORDER BY grantee, privilege_type, column_name)
    FROM information_schema.column_privileges WHERE table_name = 'devices' AND grantee IN ('anon', 'authenticated')`);
  expect(after).toBe(before);
});

test("grants: the browser roles may write every column of a device but person_id", () => {
  for (const role of ["anon", "authenticated"]) {
    const cols = psql(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'devices' ORDER BY ordinal_position`).split("\n");
    expect(cols).toContain("person_id");
    for (const col of cols) {
      const can = psql(`SELECT has_column_privilege('${role}', 'public.devices', '${col}', 'UPDATE')
        || '|' || has_column_privilege('${role}', 'public.devices', '${col}', 'INSERT')
        || '|' || has_column_privilege('${role}', 'public.devices', '${col}', 'SELECT')`);
      expect(can, `${role} ${col}`).toBe(col === "person_id" ? "false|false|true" : "true|true|true");
    }
    // Not through a table-level grant either.
    expect(psql(`SELECT has_table_privilege('${role}', 'public.devices', 'UPDATE')
      || '|' || has_table_privilege('${role}', 'public.devices', 'INSERT')`), role).toBe("false|false");
  }
  // RLS is still on, with the family scope policy.
  expect(psql(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.devices'::regclass`)).toBe("t");
  expect(psql(`SELECT count(*) FROM pg_policies WHERE tablename = 'devices' AND policyname = 'devices_family_scope'`)).toBe("1");
});

test("a family token: the heartbeat, a rename and the kiosk switch still write; who it belongs to does not", () => {
  const beat = asFamily("authenticated", FAMILY,
    `UPDATE devices SET last_seen = now(), name = 'claude-owner-phone', is_kiosk = false WHERE id = '${DEVICE}' RETURNING id;`);
  expect(beat.ok, beat.out).toBe(true);
  expect(beat.out).toContain(DEVICE);

  const claim = asFamily("authenticated", FAMILY, `UPDATE devices SET person_id = '${CHILD}' WHERE id = '${DEVICE}';`);
  expect(claim.ok).toBe(false);
  expect(claim.out).toContain("permission denied for table devices");

  const clear = asFamily("authenticated", FAMILY, `UPDATE devices SET person_id = NULL WHERE id = '${DEVICE}';`);
  expect(clear.ok).toBe(false);
  expect(clear.out).toContain("permission denied");

  const register = asFamily("authenticated", FAMILY,
    `INSERT INTO devices (family_id, name, person_id) VALUES ('${FAMILY}', 'claude-owner-new', '${CHILD}');`);
  expect(register.ok).toBe(false);
  expect(register.out).toContain("permission denied");

  // Registering a device the old way, without an owner, still works.
  const plain = asFamily("authenticated", FAMILY,
    `INSERT INTO devices (family_id, name, user_agent) VALUES ('${FAMILY}', 'claude-owner-new', 'e2e') RETURNING name;`);
  expect(plain.ok, plain.out).toBe(true);

  // And the family scope still holds for what the token may write.
  const foreign = asFamily("authenticated", OTHER_FAMILY, `UPDATE devices SET name = 'x' WHERE id = '${DEVICE}' RETURNING id;`);
  expect(foreign.ok, foreign.out).toBe(true);
  expect(foreign.out).not.toContain(DEVICE);
  expect(psql(`SELECT COALESCE(person_id::text, 'null') FROM devices WHERE id = '${DEVICE}'`)).toBe("null");
});
