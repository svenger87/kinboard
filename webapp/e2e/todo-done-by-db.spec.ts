import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import {
  acquireWholeDatabase,
  releaseWholeDatabase,
  dbContainer,
  SKIP_WITHOUT_DATABASE,
} from "./whole-database";

/**
 * migration_zzzzzzzzzzzzz_todo_done_by.sql against a real database: a tick
 * that says who did it pays them, one that does not pays as before, and the
 * answer never outlives its tick. todo-done-by.spec.ts covers the screens.
 */

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1"],
    { encoding: "utf8", input: sql },
  ).trim();
}

/**
 * Applied before every test, inside the lock. todo-turns-db.spec.ts re-applies
 * migration_zzzzzy_todo_turns.sql, whose record_todo_points this migration
 * replaces, so a run that put that file back last would test the old
 * function. Idempotent; a stack applies both at boot, in name order.
 */
function applyMigration(): void {
  execFileSync("bash", ["-c",
    `docker exec -i ${dbContainer()} psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 < webapp/docker/migration_zzzzzzzzzzzzz_todo_done_by.sql`],
    { cwd: process.cwd().replace(/\/webapp$/, ""), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

test.skip(SKIP_WITHOUT_DATABASE, "no database container reachable, and no FAMILY_CODE promising a stack");
test.beforeEach(async () => {
  await acquireWholeDatabase();
  applyMigration();
});
test.afterEach(releaseWholeDatabase);

const families: string[] = [];
interface Family { id: string; mira: string; jonas: string; dad: string }

function makeFamily(): Family {
  const id = psql(`INSERT INTO families (name, join_code) VALUES ('done-by-test', 'DB' || upper(substr(md5(random()::text), 1, 8))) RETURNING id;`);
  families.push(id);
  psql(`INSERT INTO settings (family_id, key, value) VALUES ('${id}', 'timezone', '"UTC"');`);
  const person = (name: string, child: boolean) =>
    psql(`INSERT INTO people (family_id, name, color, is_child) VALUES ('${id}', '${name}', '#123456', ${child}) RETURNING id;`);
  return { id, mira: person("Mira", true), jonas: person("Jonas", true), dad: person("Dad", false) };
}

test.afterAll(async () => {
  await acquireWholeDatabase();
  try {
    for (const id of families) {
      psql(`BEGIN; SELECT set_config('kinboard.hard_delete', 'on', true); DELETE FROM families WHERE id = '${id}'; COMMIT;`);
    }
  } finally {
    releaseWholeDatabase();
  }
});

const awardedTo = (todo: string) =>
  psql(`SELECT coalesce(string_agg((SELECT name FROM people WHERE id = a.person_id), ',' ORDER BY completion_key), '')
          FROM todo_point_awards a WHERE todo_id = '${todo}';`);
const lastBy = (todo: string) =>
  psql(`SELECT coalesce((SELECT name FROM people WHERE id = t.last_completed_by), '') || '|' || coalesce(t.done_by::text, '')
          FROM todos t WHERE id = '${todo}';`);

test("a one-off task: whoever did it gets the points, and an un-tick takes them back", () => {
  const f = makeFamily();
  const todo = psql(`INSERT INTO todos (family_id, title, person_id, points) VALUES ('${f.id}', 'Dishes', '${f.mira}', 5) RETURNING id;`);

  psql(`UPDATE todos SET completed = true, done_by = '${f.jonas}' WHERE id = '${todo}';`);
  expect(awardedTo(todo)).toBe("Jonas");
  // Recorded, and the argument is gone.
  expect(lastBy(todo)).toBe("Jonas|");
  expect(psql(`SELECT detail->>'done_by' FROM todo_events WHERE todo_id = '${todo}' AND kind = 'completed';`)).toBe(f.jonas);

  psql(`UPDATE todos SET completed = false WHERE id = '${todo}';`);
  expect(awardedTo(todo)).toBe("");
  expect(lastBy(todo)).toBe("|");

  // A tick that does not say, from Home Assistant or an assistant: the
  // assignee, as before -- not the last tick's answer.
  psql(`UPDATE todos SET completed = true WHERE id = '${todo}';`);
  expect(awardedTo(todo)).toBe("Mira");
});

test("taking turns: the day records whose turn it was and who did it; a second tick changes neither", () => {
  const f = makeFamily();
  const todo = psql(`INSERT INTO todos (family_id, title, recurrence, rotation_person_ids, track_completion, points)
    VALUES ('${f.id}', 'Bins', 'daily', ARRAY['${f.mira}', '${f.jonas}']::uuid[], true, 3) RETURNING id;`);
  const day = () => psql(`SELECT status || ':' || (SELECT name FROM people WHERE id = o.person_id) || ':' ||
      coalesce((SELECT name FROM people WHERE id = o.completed_by), '') FROM todo_occurrences o WHERE todo_id = '${todo}';`);

  psql(`UPDATE todos SET last_completed = now(), last_completed_day = current_date, done_by = '${f.jonas}' WHERE id = '${todo}';`);
  expect(day()).toBe("done:Mira:Jonas");
  expect(awardedTo(todo)).toBe("Jonas");

  psql(`UPDATE todos SET last_completed = now(), last_completed_day = current_date, done_by = '${f.mira}' WHERE id = '${todo}';`);
  expect(day()).toBe("done:Mira:Jonas");
  expect(awardedTo(todo)).toBe("Jonas");

  psql(`UPDATE todos SET last_completed = NULL, last_completed_day = current_date WHERE id = '${todo}';`);
  expect(day()).toBe("open:Mira:");
  expect(awardedTo(todo)).toBe("");

  psql(`UPDATE todos SET last_completed = now(), last_completed_day = current_date WHERE id = '${todo}';`);
  expect(awardedTo(todo)).toBe("Mira");
});

test("a parent who did it earns nobody points; someone from another family is ignored", () => {
  const f = makeFamily();
  const other = makeFamily();
  const daily = psql(`INSERT INTO todos (family_id, title, person_id, points, recurrence) VALUES ('${f.id}', 'Cat', '${f.mira}', 2, 'daily') RETURNING id;`);
  psql(`UPDATE todos SET last_completed = now(), last_completed_day = current_date, done_by = '${f.dad}' WHERE id = '${daily}';`);
  expect(awardedTo(daily)).toBe("");
  expect(lastBy(daily)).toBe("Dad|");

  const once = psql(`INSERT INTO todos (family_id, title, person_id, points) VALUES ('${f.id}', 'Bed', '${f.mira}', 1) RETURNING id;`);
  psql(`UPDATE todos SET completed = true, done_by = '${other.jonas}' WHERE id = '${once}';`);
  expect(awardedTo(once)).toBe("Mira");
  expect(lastBy(once)).toBe("|");
});

test("an edit cannot set who did it, and a new task cannot carry an answer", () => {
  const f = makeFamily();
  const todo = psql(`INSERT INTO todos (family_id, title, done_by) VALUES ('${f.id}', 'X', '${f.mira}') RETURNING id;`);
  expect(lastBy(todo)).toBe("|");
  psql(`UPDATE todos SET title = 'Y', last_completed_by = '${f.jonas}' WHERE id = '${todo}';`);
  expect(lastBy(todo)).toBe("|");
});
