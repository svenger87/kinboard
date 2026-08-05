import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * device_sessions holds credentials, and the browser must not be able to write
 * them.
 *
 * The table shipped with `GRANT SELECT, INSERT, UPDATE, DELETE ... TO anon,
 * authenticated` — a leftover from when row-level security was off across the
 * schema and every table was granted alike. Nothing in the app ever used it:
 * session.ts is the only consumer and it goes through the service role. What it
 * did allow, for anyone able to make a PostgREST call as their own family, was
 * to write their own credentials: INSERT a chosen token hash with a far-future
 * expiry for a session that never ends, clear revoked_at to undo a sign-out, or
 * DELETE to sign another device out.
 *
 * That is the same shape as the ON DELETE SET NULL foreign key this table also
 * carried — a credential outliving the thing meant to end it — so both are
 * pinned here rather than left to review.
 */

const docker = join(__dirname, "..", "docker");
const sql = (name: string) => readFileSync(join(docker, name), "utf8");

/** Every migration, so a future file can't re-grant what this one revokes. */
const allSql = readdirSync(docker)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => ({ name: f, body: readFileSync(join(docker, f), "utf8") }));

test("no migration grants the browser roles access to device_sessions", () => {
  const offenders = allSql
    .filter(({ body }) =>
      // A GRANT naming this table and either browser role, ignoring REVOKEs.
      // [^;] already spans newlines, so no dotAll flag (tsconfig targets es2017).
      /GRANT[^;]*\bdevice_sessions\b[^;]*\b(anon|authenticated)\b/i.test(body),
    )
    .map(({ name }) => name);
  expect(offenders, "device_sessions must be service_role only").toEqual([]);
});

test("device_sessions is explicitly revoked and granted to service_role", () => {
  const body = sql("migration_device_sessions.sql");
  expect(body).toMatch(/REVOKE ALL ON TABLE public\.device_sessions FROM PUBLIC/i);
  expect(body).toMatch(/REVOKE ALL ON TABLE public\.device_sessions FROM anon/i);
  expect(body).toMatch(/REVOKE ALL ON TABLE public\.device_sessions FROM authenticated/i);
  expect(body).toMatch(/GRANT ALL ON TABLE public\.device_sessions TO service_role/i);
});

test("deleting a device takes its sessions with it", () => {
  // ON DELETE SET NULL here meant removing a device in Settings left a working
  // credential behind. The database is the only place that can guarantee this:
  // devices are deleted straight from the browser through PostgREST.
  const body = sql("migration_device_sessions_cascade.sql");
  expect(body).toMatch(
    /FOREIGN KEY \(device_id\) REFERENCES public\.devices\(id\) ON DELETE CASCADE/i,
  );
  expect(body).not.toMatch(/device_id[^;]*ON DELETE SET NULL/i);
});

test("a session cannot exist without a device", () => {
  // A null device_id has nothing to cascade from, so it would reopen the gap.
  expect(sql("migration_device_sessions_cascade.sql")).toMatch(
    /ALTER COLUMN device_id SET NOT NULL/i,
  );
  // ...and the server can't create one either.
  const session = readFileSync(join(__dirname, "..", "src", "lib", "session.ts"), "utf8");
  const signature = session.slice(session.indexOf("export async function createSession"));
  expect(signature.slice(0, 600)).toMatch(/deviceId: string;/);
  expect(signature.slice(0, 600)).not.toMatch(/deviceId\?: string \| null/);
});

test("session validation rejects a session whose device is gone", () => {
  const session = readFileSync(join(__dirname, "..", "src", "lib", "session.ts"), "utf8");
  expect(session).toMatch(/if \(!row\.device_id\) return null;/);
});
