import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import {
  acquireWholeDatabase,
  releaseWholeDatabase,
  dbContainer,
  SKIP_WITHOUT_DATABASE,
} from "./whole-database";

/**
 * migration_zzzzzzzzzzzz_point_adjustments.sql against a real database
 * (discussion #349): a parent's bonus and correction count in
 * point_person_totals() like task points, a correction past what was spent is
 * owed, an adjustment can be taken back and a task's award cannot, and only
 * the server may call either function.
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
    `docker exec -i ${dbContainer()} psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 < webapp/docker/migration_zzzzzzzzzzzz_point_adjustments.sql`],
    { cwd: process.cwd().replace(/\/webapp$/, ""), encoding: "utf8" });
}

test.skip(SKIP_WITHOUT_DATABASE, "no database container reachable, and no FAMILY_CODE promising a stack");
test.beforeEach(acquireWholeDatabase);
test.afterEach(releaseWholeDatabase);

const families: string[] = [];
test.afterAll(async () => {
  await acquireWholeDatabase();
  try {
    for (const id of families) psql(`SELECT set_config('kinboard.hard_delete', 'on', false); DELETE FROM families WHERE id = '${id}';`);
  } finally {
    releaseWholeDatabase();
  }
});

function makeFamily(): { id: string; kid: string; parent: string } {
  applyMigration();
  const id = psql(`INSERT INTO families (name, join_code) VALUES ('adjust-test', 'AJ' || upper(substr(md5(random()::text), 1, 8))) RETURNING id;`);
  families.push(id);
  const kid = psql(`INSERT INTO people (family_id, name, color, is_child) VALUES ('${id}', 'Kid', '#123456', true) RETURNING id;`);
  const parent = psql(`INSERT INTO people (family_id, name, color, is_child) VALUES ('${id}', 'Mum', '#654321', false) RETURNING id;`);
  return { id, kid, parent };
}

const totals = (f: { id: string; kid: string }) =>
  JSON.parse(psql(`SELECT point_person_totals('${f.id}', '${f.kid}');`)) as Record<string, number>;
const adjust = (f: { id: string }, person: string, points: number, note: string | null = null) =>
  JSON.parse(psql(`SELECT adjust_person_points('${f.id}', '${person}', ${points}, ${note === null ? "NULL" : `'${note}'`});`));

test("a bonus and a correction count like task points; a correction past what was spent is owed", () => {
  const f = makeFamily();
  psql(`INSERT INTO todo_point_awards (family_id, person_id, completion_key, points) VALUES ('${f.id}', '${f.kid}', 'task-1', 60);
        INSERT INTO point_purchases (family_id, person_id, item_id, cost) VALUES ('${f.id}', '${f.kid}', 'test_hat', 50);`);
  expect(totals(f)).toMatchObject({ earned: 60, purchased: 50, balance: 10 });

  expect(adjust(f, f.kid, 5, "  Helped wash the car  ")).toMatchObject({ ok: true, balance: 15 });
  expect(psql(`SELECT note FROM todo_point_awards WHERE kind = 'adjustment' AND person_id = '${f.kid}';`)).toBe("Helped wash the car");

  expect(adjust(f, f.kid, -30, "Task had 10 instead of 1")).toMatchObject({ ok: true, balance: 0 });
  expect(totals(f)).toMatchObject({ earned: 35, balance: 0, owed: 15 });
});

test("an adjustment can be taken back; a task's award cannot be, from here", () => {
  const f = makeFamily();
  psql(`INSERT INTO todo_point_awards (family_id, person_id, completion_key, points) VALUES ('${f.id}', '${f.kid}', 'task-1', 20);`);
  const id = adjust(f, f.kid, -8).adjustment.id;
  expect(totals(f).balance).toBe(12);
  expect(JSON.parse(psql(`SELECT remove_person_point_adjustment('${f.id}', '${id}');`))).toMatchObject({ ok: true, balance: 20 });

  const task = psql(`SELECT id FROM todo_point_awards WHERE completion_key = 'task-1' AND person_id = '${f.kid}';`);
  expect(JSON.parse(psql(`SELECT remove_person_point_adjustment('${f.id}', '${task}');`))).toEqual({ ok: false, error: "not_found" });
  // Nor from another family.
  const other = makeFamily();
  const theirs = adjust(other, other.kid, 3).adjustment.id;
  expect(JSON.parse(psql(`SELECT remove_person_point_adjustment('${f.id}', '${theirs}');`))).toEqual({ ok: false, error: "not_found" });
});

test("only a child of the family, only whole non-zero points, and a task's award stays positive", () => {
  const f = makeFamily();
  expect(adjust(f, f.kid, 0)).toEqual({ ok: false, error: "invalid_points" });
  expect(adjust(f, f.kid, 10001)).toEqual({ ok: false, error: "invalid_points" });
  expect(adjust(f, f.parent, 5)).toEqual({ ok: false, error: "not_found" });
  const other = makeFamily();
  expect(adjust(f, other.kid, 5)).toEqual({ ok: false, error: "not_found" });
  expect(() => psql(`INSERT INTO todo_point_awards (family_id, person_id, completion_key, points) VALUES ('${f.id}', '${f.kid}', 'neg', -5);`))
    .toThrow(/todo_point_awards_kind_points_check/);
});

test("the browser may call neither function", () => {
  expect(psql(`SELECT has_function_privilege('authenticated', 'public.adjust_person_points(uuid, uuid, integer, text)', 'EXECUTE')`)).toBe("f");
  expect(psql(`SELECT has_function_privilege('authenticated', 'public.remove_person_point_adjustment(uuid, uuid)', 'EXECUTE')`)).toBe("f");
});
