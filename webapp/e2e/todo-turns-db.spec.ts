import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import {
  acquireWholeDatabase,
  releaseWholeDatabase,
  dbContainer,
  SKIP_WITHOUT_DATABASE,
} from "./whole-database";

/**
 * migration_zzzzzy_todo_turns.sql against a real database (#341): turns,
 * ticks and un-ticks, missed days, edits that apply from the next due day,
 * points to whoever's turn it was, and the task log. The schedule functions
 * themselves are mirrored in lib/todo-turns.ts and checked against the same
 * values in todo-turns.spec.ts.
 *
 * Time cannot be moved in a database, so "four days later" is made by moving
 * the task's schedule four days back, with the trigger stepped aside as the
 * quarter-hourly pass steps it aside.
 */

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1"],
    { encoding: "utf8", input: sql },
  ).trim();
}

function applyMigration(): void {
  execFileSync("bash", ["-c",
    `docker exec -i ${dbContainer()} psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 < webapp/docker/migration_zzzzzy_todo_turns.sql`],
    { cwd: process.cwd().replace(/\/webapp$/, ""), encoding: "utf8" });
}

test.skip(SKIP_WITHOUT_DATABASE, "no database container reachable, and no FAMILY_CODE promising a stack");
test.beforeEach(acquireWholeDatabase);
test.afterEach(releaseWholeDatabase);

const families: string[] = [];
interface Family { id: string; a: string; b: string; c: string }

function makeFamily(): Family {
  applyMigration();
  const id = psql(`INSERT INTO families (name, join_code) VALUES ('turns-test', 'TT' || upper(substr(md5(random()::text), 1, 8))) RETURNING id;`);
  families.push(id);
  psql(`INSERT INTO settings (family_id, key, value) VALUES ('${id}', 'timezone', '"UTC"');`);
  const person = (name: string) =>
    psql(`INSERT INTO people (family_id, name, color, is_child) VALUES ('${id}', '${name}', '#123456', true) RETURNING id;`);
  return { id, a: person("A"), b: person("B"), c: person("C") };
}

test.afterAll(async () => {
  await acquireWholeDatabase();
  try {
    for (const id of families) psql(`DELETE FROM families WHERE id = '${id}';`);
  } finally {
    releaseWholeDatabase();
  }
});

/** Moves a task's schedule `days` back, as if that many days had passed. */
function ageTask(todo: string, days: number): void {
  psql(`BEGIN; SELECT set_config('kinboard.todo_system', 'on', true);
    UPDATE todos SET schedule_start_day = schedule_start_day - ${days}, tracking_started_day = tracking_started_day - ${days}
     WHERE id = '${todo}'; COMMIT;`);
}

const history = (todo: string) =>
  psql(`SELECT string_agg((day - (now() AT TIME ZONE 'UTC')::date) || ':' || status || ':' || (SELECT name FROM people WHERE id = o.person_id), ' ' ORDER BY day)
          FROM todo_occurrences o WHERE todo_id = '${todo}';`);

test("turns follow the date, missed days are written down with whose turn it was, and points go to the turn's person", () => {
  const f = makeFamily();
  const todo = psql(`INSERT INTO todos (family_id, title, recurrence, rotation_person_ids, track_completion, points)
    VALUES ('${f.id}', 'Dishes', 'daily', ARRAY['${f.a}', '${f.b}', '${f.c}']::uuid[], true, 5) RETURNING id;`);
  expect(psql(`SELECT person_id FROM todos WHERE id = '${todo}';`)).toBe(f.a);

  ageTask(todo, 4);
  psql(`SELECT close_todo_days('UTC');`);
  expect(history(todo)).toBe("-4:missed:A -3:missed:B -2:missed:C -1:missed:A");
  // Day 4 of A, B, C is B's, and person_id has moved on to her.
  expect(psql(`SELECT person_id FROM todos WHERE id = '${todo}';`)).toBe(f.b);

  psql(`UPDATE todos SET last_completed = now() WHERE id = '${todo}';`);
  expect(history(todo)).toContain("0:done:B");
  expect(psql(`SELECT person_id || ':' || points FROM todo_point_awards WHERE todo_id = '${todo}';`)).toBe(`${f.b}:5`);

  // Un-ticking takes the day and its points back while it is open.
  psql(`UPDATE todos SET last_completed = NULL WHERE id = '${todo}';`);
  expect(history(todo)).toContain("0:open:B");
  expect(psql(`SELECT count(*) FROM todo_point_awards WHERE todo_id = '${todo}';`)).toBe("0");

  expect(psql(`SELECT string_agg(kind, ',' ORDER BY at) FROM todo_events WHERE todo_id = '${todo}';`))
    .toBe("created,completed,uncompleted");
});

test("an edit applies from the next due day: the open day keeps its person, the past stays as written", () => {
  const f = makeFamily();
  const todo = psql(`INSERT INTO todos (family_id, title, recurrence, rotation_person_ids, track_completion)
    VALUES ('${f.id}', 'Bins', 'daily', ARRAY['${f.a}', '${f.b}']::uuid[], true) RETURNING id;`);
  ageTask(todo, 2);
  psql(`UPDATE todos SET rotation_person_ids = ARRAY['${f.c}', '${f.b}']::uuid[] WHERE id = '${todo}';`);

  // -2 was A's, -1 B's, today A's under the old order: written down, and kept.
  expect(history(todo)).toBe("-2:missed:A -1:missed:B 0:open:A");
  expect(psql(`SELECT (carry_day - (now() AT TIME ZONE 'UTC')::date) || ',' || (schedule_start_day - (now() AT TIME ZONE 'UTC')::date) FROM todos WHERE id = '${todo}';`))
    .toBe("0,1");
  // Tomorrow the new order starts counting again, at C.
  expect(psql(`SELECT todo_turn_person(t, (now() AT TIME ZONE 'UTC')::date + 1) FROM todos t WHERE id = '${todo}';`)).toBe(f.c);
  // And today can still be ticked, as A's.
  psql(`UPDATE todos SET last_completed = now() WHERE id = '${todo}';`);
  expect(history(todo)).toContain("0:done:A");
});

test("before the first due day nothing can be ticked, from anywhere", () => {
  const f = makeFamily();
  const todo = psql(`INSERT INTO todos (family_id, title, recurrence, track_completion, person_id, due_date)
    VALUES ('${f.id}', 'Car', 'weekly', true, '${f.a}', (now() AT TIME ZONE 'UTC')::date + 3) RETURNING id;`);
  expect(() => psql(`UPDATE todos SET last_completed = now() WHERE id = '${todo}';`)).toThrow(/no turn of this task is open yet/);
});

test("a person removed from the family drops out of the rotation; a plain repeating task is untouched", () => {
  const f = makeFamily();
  const rota = psql(`INSERT INTO todos (family_id, title, recurrence, rotation_person_ids)
    VALUES ('${f.id}', 'Walk', 'days:MO,WE,FR', ARRAY['${f.a}', '${f.b}']::uuid[]) RETURNING id;`);
  psql(`UPDATE people SET deleted_at = now() WHERE id = '${f.b}';`);
  expect(psql(`SELECT rotation_person_ids::text FROM todos WHERE id = '${rota}';`)).toBe(`{${f.a}}`);

  const plain = psql(`INSERT INTO todos (family_id, title, recurrence, person_id, points)
    VALUES ('${f.id}', 'Plants', 'daily', '${f.a}', 3) RETURNING id;`);
  psql(`UPDATE todos SET last_completed = now(), last_completed_day = (now() AT TIME ZONE 'UTC')::date WHERE id = '${plain}';`);
  expect(psql(`SELECT schedule_start_day IS NULL FROM todos WHERE id = '${plain}';`)).toBe("t");
  expect(psql(`SELECT points FROM todo_point_awards WHERE todo_id = '${plain}';`)).toBe("3");
});

test("the browser may read the history and the log, and write neither", () => {
  expect(psql(`SELECT has_table_privilege('authenticated', 'public.todo_occurrences', 'SELECT')`)).toBe("t");
  expect(psql(`SELECT has_table_privilege('authenticated', 'public.todo_occurrences', 'INSERT')`)).toBe("f");
  expect(psql(`SELECT has_table_privilege('authenticated', 'public.todo_events', 'UPDATE')`)).toBe("f");
  expect(psql(`SELECT has_function_privilege('authenticated', 'public.close_todo_days(text)', 'EXECUTE')`)).toBe("f");
});
