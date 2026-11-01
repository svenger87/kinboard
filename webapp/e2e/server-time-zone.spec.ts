import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { codeOnly } from "./source-helpers";

/**
 * The day a scheduled task's tick lands on (#341).
 *
 * The database decides it: the family's own zone, else the server's -- which
 * the webapp's entrypoint records on every start, because a trigger cannot
 * read the webapp's environment -- and only then Europe/Berlin. It used to
 * fall straight back to Berlin, so on a server west of Berlin an evening
 * edit closed the family's open day early; and it believed the day a screen
 * sent, so a tablet whose clock was a day off could turn in a missed turn.
 * todo-turns-db.spec.ts drives all of that against a database; these guard
 * the wiring that only reads as code.
 */

const DOCKER = join(__dirname, "..", "docker");
const read = (file: string) => readFileSync(join(DOCKER, file), "utf8");

test("the entrypoint records the server's zone after the migrations, as a psql variable", () => {
  const sh = read("webapp-entrypoint.sh");
  const migrations = sh.indexOf("sh /app/migrate.sh; do");
  const record = sh.indexOf("server_timezone");
  expect(migrations).toBeGreaterThan(0);
  expect(record).toBeGreaterThan(migrations);
  expect(sh).toMatch(/-v tz="\$\{TZ:-\}"/);
  // A quoted heredoc: the shell pastes nothing into the SQL; psql quotes :'tz'.
  expect(sh).toMatch(/<<'SQL'[\s\S]*:'tz'[\s\S]*\nSQL\n/);
  // Only a zone Postgres knows is kept, and an unset TZ clears the old one.
  expect(sh).toMatch(/WHERE EXISTS \(SELECT 1 FROM pg_timezone_names WHERE name = :'tz'\)/);
  expect(sh).toMatch(/DELETE FROM public\.instance_settings[\s\S]*NOT EXISTS/);
});

test("instance_settings is the server's alone", () => {
  const sql = codeOnly(read("migrations/065_instance_settings.sql"), { sql: true });
  expect(sql).toMatch(/ALTER TABLE public\.instance_settings ENABLE ROW LEVEL SECURITY/);
  expect(sql).not.toMatch(/CREATE POLICY/);
  expect(sql).toMatch(/REVOKE ALL ON TABLE public\.instance_settings FROM anon/);
  expect(sql).toMatch(/REVOKE ALL ON TABLE public\.instance_settings FROM authenticated/);
  // family_time_zone() reads it, so it must exist first.
  expect("migrations/065_instance_settings.sql" < "migrations/066_todo_turns.sql").toBe(true);
});

test("the family's zone comes first, then the server's, then Berlin", () => {
  const sql = codeOnly(read("migrations/066_todo_turns.sql"), { sql: true });
  const fn = /FUNCTION public\.family_time_zone[\s\S]*?END \$\$;/.exec(sql)?.[0] ?? "";
  expect(fn).toMatch(/ARRAY\[own, p_fallback, server, 'Europe\/Berlin'\]/);
  expect(sql).toMatch(/'public\.family_time_zone\(uuid, text\)'/);
});

test("a tick's day is the family's, not the one the screen sent", () => {
  const sql = codeOnly(read("migrations/066_todo_turns.sql"), { sql: true });
  const trigger = /FUNCTION public\.todo_schedule_update[\s\S]*?END \$\$;/.exec(sql)?.[0] ?? "";
  expect(trigger.length).toBeGreaterThan(1000);
  expect(trigger).not.toMatch(/today\s*:=\s*NEW\.last_completed_day/);
  expect(trigger).toMatch(/today\s*:=\s*public\.family_today\(NEW\.family_id\)/);
});
