import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import {
  acquireWholeDatabase,
  releaseWholeDatabase,
  dbContainer,
  SKIP_WITHOUT_DATABASE,
} from "./whole-database";
import { dueIndex, isDueDay, monthDay, prevDueDay } from "../src/lib/todo-turns";

/**
 * migrations/066_todo_turns.sql against a real database (#341): turns,
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

// Applied once per worker, for a database that predates these migrations. A
// stack has already applied them at boot, and re-applying them while other
// specs run takes locks on `todos` against the app's own queries: in CI that
// deadlocked once. A deadlock is retried -- both files are idempotent.
let migrated = false;
function applyMigration(): void {
  if (migrated) return;
  // instance_settings first: family_time_zone() reads it.
  for (const file of ["migrations/065_instance_settings.sql", "migrations/066_todo_turns.sql"]) {
    for (let attempt = 1; ; attempt++) {
      try {
        execFileSync("bash", ["-c",
          `docker exec -i ${dbContainer()} psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 < webapp/docker/${file}`],
          { cwd: process.cwd().replace(/\/webapp$/, ""), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        break;
      } catch (err) {
        if (attempt >= 3 || !String((err as Error).message).includes("deadlock detected")) throw err;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
      }
    }
  }
  migrated = true;
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
    // With hard_delete, as a purge runs: a plain DELETE's cascades are each
    // soft-deleted by their own trigger and left behind, and a task whose
    // person was already in the bin fails the delete outright -- its row is
    // updated twice in one transaction (person_id set null, then deleted_at),
    // and the second update re-checks its family.
    for (const id of families) {
      psql(`BEGIN; SELECT set_config('kinboard.hard_delete', 'on', true); DELETE FROM families WHERE id = '${id}'; COMMIT;`);
    }
  } finally {
    releaseWholeDatabase();
  }
});

/** Moves a task's schedule `days` back, as if that many days had passed. */
function ageTask(todo: string, days: number): void {
  psql(`BEGIN; SELECT set_config('kinboard.todo_system', 'on', true);
    UPDATE todos SET schedule_start_day = schedule_start_day - ${days}, tracking_started_day = tracking_started_day - ${days},
           schedule_anchor_day = schedule_anchor_day - ${days}
     WHERE id = '${todo}'; COMMIT;`);
}

/**
 * `days` pass for a task that has already written days down: its schedule,
 * what it was last ticked for, its written days and the keys of its points
 * all move back together. (ageTask moves the schedule alone, which is right
 * before anything is written.) The days move in two steps so no two rows
 * share a day on the way.
 */
function passDays(todo: string, days: number): void {
  psql(`BEGIN; SELECT set_config('kinboard.todo_system', 'on', true);
    UPDATE todos SET schedule_start_day = schedule_start_day - ${days}, tracking_started_day = tracking_started_day - ${days},
           schedule_anchor_day = schedule_anchor_day - ${days},
           carry_day = carry_day - ${days}, last_completed = last_completed - make_interval(days => ${days}),
           last_completed_day = last_completed_day - ${days} WHERE id = '${todo}';
    UPDATE todo_occurrences SET day = day - (${days} + 20000) WHERE todo_id = '${todo}';
    UPDATE todo_occurrences SET day = day + 20000 WHERE todo_id = '${todo}';
    UPDATE todo_point_awards SET completion_key = 'moving:' || (completion_key::date - ${days})::text
     WHERE todo_id = '${todo}' AND completion_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
    UPDATE todo_point_awards SET completion_key = substr(completion_key, 8) WHERE todo_id = '${todo}' AND completion_key LIKE 'moving:%';
    COMMIT;`);
}

/** The task's points as "day from today:person". */
const awards = (todo: string) =>
  psql(`SELECT string_agg((completion_key::date - (now() AT TIME ZONE 'UTC')::date) || ':' || (SELECT name FROM people WHERE id = a.person_id), ' ' ORDER BY completion_key)
          FROM todo_point_awards a WHERE todo_id = '${todo}';`);

/** Whose turns the next `n` days are, from tomorrow. */
const turns = (todo: string, n: number) =>
  psql(`SELECT string_agg((SELECT name FROM people WHERE id = todo_turn_person(t, (now() AT TIME ZONE 'UTC')::date + d)), ' ' ORDER BY d)
          FROM todos t, generate_series(1, ${n}) AS d WHERE t.id = '${todo}';`);

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
  // Tomorrow the turns carry on: B came after A and is still in the list,
  // then C, who took A's place.
  expect(turns(todo, 3)).toBe("B C B");
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

// A day sent with a tick is not believed. A tablet whose clock is a day off
// sends exactly these, from the board, with nothing hand-made about them.
const yesterday = "(now() AT TIME ZONE 'UTC')::date - 1";
const tomorrow = "(now() AT TIME ZONE 'UTC')::date + 1";

test("a tick sent with yesterday's date lands on today: a missed turn cannot be turned in", () => {
  const f = makeFamily();
  const todo = psql(`INSERT INTO todos (family_id, title, recurrence, rotation_person_ids, track_completion, points)
    VALUES ('${f.id}', 'Trash', 'daily', ARRAY['${f.a}', '${f.b}', '${f.c}']::uuid[], true, 5) RETURNING id;`);
  ageTask(todo, 1);
  psql(`SELECT close_todo_days('UTC');`);
  expect(history(todo)).toBe("-1:missed:A");

  psql(`UPDATE todos SET last_completed = now(), last_completed_day = ${yesterday} WHERE id = '${todo}';`);
  // Yesterday stays missed and unpaid; the tick went to today, B's.
  expect(history(todo)).toBe("-1:missed:A 0:done:B");
  expect(awards(todo)).toBe("0:B");
});

test("a tick sent with tomorrow's date lands on today: tomorrow's turn cannot be ticked early", () => {
  const f = makeFamily();
  const todo = psql(`INSERT INTO todos (family_id, title, recurrence, rotation_person_ids, track_completion, points)
    VALUES ('${f.id}', 'Dishes', 'daily', ARRAY['${f.a}', '${f.b}', '${f.c}']::uuid[], true, 5) RETURNING id;`);
  psql(`UPDATE todos SET last_completed = now(), last_completed_day = ${tomorrow} WHERE id = '${todo}';`);
  expect(history(todo)).toBe("0:done:A");
  expect(awards(todo)).toBe("0:A");
  expect(psql(`SELECT last_completed_day - (now() AT TIME ZONE 'UTC')::date FROM todos WHERE id = '${todo}';`)).toBe("0");
});

test("an un-tick sent with yesterday's date cannot reopen a closed day", () => {
  const f = makeFamily();
  const todo = psql(`INSERT INTO todos (family_id, title, recurrence, rotation_person_ids, track_completion, points)
    VALUES ('${f.id}', 'Plants', 'daily', ARRAY['${f.a}', '${f.b}', '${f.c}']::uuid[], true, 5) RETURNING id;`);
  psql(`UPDATE todos SET last_completed = now() WHERE id = '${todo}';`);
  passDays(todo, 1);
  psql(`SELECT close_todo_days('UTC');`);
  psql(`UPDATE todos SET last_completed = now() WHERE id = '${todo}';`);
  expect(history(todo)).toBe("-1:done:A 0:done:B");
  expect(awards(todo)).toBe("-1:A 0:B");

  psql(`UPDATE todos SET last_completed = NULL, last_completed_day = ${yesterday} WHERE id = '${todo}';`);
  // It reached today, the open day: yesterday is closed, and stays done and paid.
  expect(history(todo)).toBe("-1:done:A 0:open:B");
  expect(awards(todo)).toBe("-1:A");
  // And what the screens read back still says yesterday was the last one done.
  expect(psql(`SELECT last_completed_day - (now() AT TIME ZONE 'UTC')::date FROM todos WHERE id = '${todo}';`)).toBe("-1");
});

test("today is the family's zone, else the server's, and only then Berlin", () => {
  const f = makeFamily();
  const bare = psql(`INSERT INTO families (name, join_code) VALUES ('turns-test-tz', 'TZ' || upper(substr(md5(random()::text), 1, 8))) RETURNING id;`);
  families.push(bare);
  const recorded = psql(`SELECT coalesce((SELECT value FROM instance_settings WHERE key = 'server_timezone'), '')`);
  try {
    psql(`INSERT INTO instance_settings (key, value) VALUES ('server_timezone', 'Pacific/Kiritimati')
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`);
    expect(psql(`SELECT family_time_zone('${f.id}')`)).toBe("UTC");
    // A family with no zone of its own gets the server's -- what a trigger, passing nothing, sees.
    expect(psql(`SELECT family_time_zone('${bare}')`)).toBe("Pacific/Kiritimati");
    expect(psql(`SELECT family_today('${bare}') = (now() AT TIME ZONE 'Pacific/Kiritimati')::date`)).toBe("t");
    // The cron passes the server's TZ itself; that comes before the recorded one.
    expect(psql(`SELECT family_time_zone('${bare}', 'Pacific/Pago_Pago')`)).toBe("Pacific/Pago_Pago");
    // A zone Postgres does not know is passed over, not trusted.
    psql(`INSERT INTO settings (family_id, key, value) VALUES ('${bare}', 'timezone', '"Mars/Olympus_Mons"');`);
    expect(psql(`SELECT family_time_zone('${bare}')`)).toBe("Pacific/Kiritimati");
    psql(`DELETE FROM instance_settings WHERE key = 'server_timezone';`);
    expect(psql(`SELECT family_time_zone('${bare}')`)).toBe("Europe/Berlin");
    expect(psql(`SELECT has_function_privilege('authenticated', 'public.family_time_zone(uuid, text)', 'EXECUTE')`)).toBe("f");
    expect(psql(`SELECT has_table_privilege('authenticated', 'public.instance_settings', 'SELECT')`)).toBe("f");
  } finally {
    psql(recorded
      ? `INSERT INTO instance_settings (key, value) VALUES ('server_timezone', '${recorded.replace(/'/g, "''")}')
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`
      : `DELETE FROM instance_settings WHERE key = 'server_timezone';`);
  }
});

test("after an edit the turns carry on after the open day's person, in the new order", () => {
  const f = makeFamily();
  const todo = psql(`INSERT INTO todos (family_id, title, recurrence, rotation_person_ids, track_completion)
    VALUES ('${f.id}', 'Table', 'daily', ARRAY['${f.a}', '${f.b}', '${f.c}']::uuid[], true) RETURNING id;`);
  ageTask(todo, 1);
  psql(`SELECT close_todo_days('UTC');`);
  expect(history(todo)).toBe("-1:missed:A");
  // Today is B's. Reordered to C, B, A: after B comes A, then C -- not C,
  // which would restart the list and could hand anyone two turns in a row.
  psql(`UPDATE todos SET rotation_person_ids = ARRAY['${f.c}', '${f.b}', '${f.a}']::uuid[] WHERE id = '${todo}';`);
  expect(history(todo)).toBe("-1:missed:A 0:open:B");
  expect(turns(todo, 3)).toBe("A C B");
  expect(psql(`SELECT rotation_offset FROM todos WHERE id = '${todo}';`)).toBe("2");
  // An edit that leaves the order alone carries on just the same.
  psql(`UPDATE todos SET title = 'Table (after dinner)', recurrence = 'daily' WHERE id = '${todo}';`);
  expect(turns(todo, 3)).toBe("A C B");
});

test("when today's person leaves the family, the turns carry on with whoever came after them", () => {
  const f = makeFamily();
  const todo = psql(`INSERT INTO todos (family_id, title, recurrence, rotation_person_ids, track_completion)
    VALUES ('${f.id}', 'Laundry', 'daily', ARRAY['${f.a}', '${f.b}', '${f.c}']::uuid[], true) RETURNING id;`);
  ageTask(todo, 1);
  psql(`SELECT close_todo_days('UTC');`);
  // Today is B's. B leaves: today stays hers, and C -- next after her -- follows.
  psql(`UPDATE people SET deleted_at = now() WHERE id = '${f.b}';`);
  expect(psql(`SELECT rotation_person_ids::text FROM todos WHERE id = '${todo}';`)).toBe(`{${f.a},${f.c}}`);
  expect(history(todo)).toBe("-1:missed:A 0:open:B");
  expect(turns(todo, 3)).toBe("C A C");
});

test("monthly keeps the same date each month, and its anchor outlives an edit", () => {
  // The month's last day when it is shorter, always counted from the anchor.
  expect(psql(`SELECT string_agg(todo_month_day('2026-01-31', k)::text, ' ' ORDER BY k) FROM generate_series(0, 4) AS k;`))
    .toBe("2026-01-31 2026-02-28 2026-03-31 2026-04-30 2026-05-31");
  expect(psql(`SELECT todo_month_day('2028-01-31', 1);`)).toBe("2028-02-29");
  expect(psql(`SELECT todo_first_due_day('monthly', '2026-01-31', '2026-02-01');`)).toBe("2026-02-28");
  // A set-up that starts on 28 February, its dates counted from 31 January.
  expect(psql(`SELECT todo_is_due_day('monthly', '2026-02-28', '2026-03-31', '2026-01-31');`)).toBe("t");
  expect(psql(`SELECT todo_prev_due_day('monthly', '2026-02-28', '2026-04-29', '2026-01-31');`)).toBe("2026-03-31");
  expect(psql(`SELECT todo_due_index('monthly', '2026-02-28', '2026-04-30', '2026-01-31');`)).toBe("2");

  // The trigger keeps the anchor when an edit moves the start on.
  const f = makeFamily();
  const todo = psql(`INSERT INTO todos (family_id, title, recurrence, rotation_person_ids)
    VALUES ('${f.id}', 'Rent', 'monthly', ARRAY['${f.a}', '${f.b}']::uuid[]) RETURNING id;`);
  const today = "(now() AT TIME ZONE 'UTC')::date";
  expect(psql(`SELECT (schedule_anchor_day = ${today}) || ',' || (schedule_start_day = ${today}) FROM todos WHERE id = '${todo}';`)).toBe("true,true");
  psql(`UPDATE todos SET rotation_person_ids = ARRAY['${f.b}', '${f.a}']::uuid[] WHERE id = '${todo}';`);
  expect(psql(`SELECT (schedule_anchor_day = ${today}) || ',' || (carry_day = ${today}) || ',' || (schedule_start_day = todo_month_day(${today}, 1))
    FROM todos WHERE id = '${todo}';`)).toBe("true,true,true");
  // Today stays A's; next month carries on after her, with B.
  expect(psql(`SELECT (SELECT name FROM people WHERE id = todo_turn_person(t, todo_month_day(${today}, 1))) || ' '
    || (SELECT name FROM people WHERE id = todo_turn_person(t, todo_month_day(${today}, 2))) FROM todos t WHERE id = '${todo}';`)).toBe("B A");
});

test("the schedule functions give what lib/todo-turns.ts gives, day by day", () => {
  // Monthly anchors on the month's last days, leap years and the year's end,
  // each with set-ups starting on its first three due days; and the other
  // recurrences with an anchor that is not their start, which they ignore.
  const schedules: { recurrence: string; anchor: string; start: string }[] = [];
  for (const anchor of ["2026-01-28", "2026-01-29", "2026-01-30", "2026-01-31", "2027-01-31", "2028-01-29",
    "2028-01-31", "2026-03-31", "2026-05-30", "2026-08-31", "2026-12-31"]) {
    for (const k of [0, 1, 2]) schedules.push({ recurrence: "monthly", anchor, start: monthDay(anchor, k) });
  }
  for (const recurrence of ["daily", "weekly", "biweekly", "days:MO,WE"]) {
    schedules.push({ recurrence, anchor: "2026-09-28", start: "2026-10-05" });
  }
  const values = schedules.map((x) => `('${x.recurrence}', '${x.start}'::date, '${x.anchor}'::date)`).join(", ");
  // Several anchors share a start -- 28 February is the second due day of
  // the 28th to the 31st of January -- so each row carries its anchor.
  const rows = psql(`SELECT s.recurrence || '|' || s.anchor || '|' || s.start || '|' || d::date
      || '|' || CASE WHEN todo_is_due_day(s.recurrence, s.start, d::date, s.anchor) THEN 't' ELSE 'f' END
      || '|' || coalesce(todo_prev_due_day(s.recurrence, s.start, d::date, s.anchor)::text, '-')
      || '|' || todo_due_index(s.recurrence, s.start, d::date, s.anchor)
    FROM (VALUES ${values}) AS s(recurrence, start, anchor),
         generate_series(s.start - 5, s.start + 400, INTERVAL '1 day') AS d
    ORDER BY s.recurrence, s.anchor, s.start, d;`).split("\n");
  let compared = 0;
  const differ: string[] = [];
  for (const row of rows) {
    const [recurrence, anchor, start, day, due, prev, index] = row.split("|");
    const ts = [isDueDay(recurrence, start, day, anchor) ? "t" : "f", prevDueDay(recurrence, start, day, anchor) ?? "-",
      String(dueIndex(recurrence, start, day, anchor))].join("|");
    if (ts !== [due, prev, index].join("|")) differ.push(`${row} | ts ${ts}`);
    compared++;
  }
  expect(compared).toBe(schedules.length * 406);
  expect(differ.slice(0, 5)).toEqual([]);
});

