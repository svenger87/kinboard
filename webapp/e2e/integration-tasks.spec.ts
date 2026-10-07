import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createListTask,
  createServiceTask,
  familyPersonId,
  parseTaskExtras,
  taskTurnsPatch,
  type TaskDb,
} from "../src/lib/integration-tasks";
import { hasScope } from "../src/lib/integration-auth";
import { LISTS, toListItem } from "../src/lib/integration-lists";
import { parseRecurrence } from "../src/lib/todo-recurrence";
import { LEGACY_TODO_ICONS } from "../src/lib/todo-icons";
import { codeOnly } from "./source-helpers";

/**
 * RFC-012 task 4: tasks with assignee, repetition, priority, icon and points,
 * on POST /lists/tasks and PATCH /lists/tasks/{id}, and the RFC-012 §5 fix to
 * services/create_task, which used to store a person_id of another family.
 *
 * The fake client applies the `.eq`/`.is` filters it is given, so a lookup
 * that forgets `family_id` or `deleted_at` really does find the foreign or
 * binned person here.
 */

const OURS = "11111111-1111-1111-1111-111111111111";
const THEIRS = "22222222-2222-2222-2222-222222222222";
const MIA = "aaaaaaaa-aaaa-aaaa-aaaa-000000000001";
const BINNED = "aaaaaaaa-aaaa-aaaa-aaaa-000000000002";
const OTHER_CHILD = "bbbbbbbb-bbbb-bbbb-bbbb-000000000001";
const NOWHERE = "cccccccc-cccc-cccc-cccc-000000000001";
const NOAH = "aaaaaaaa-aaaa-aaaa-aaaa-000000000003";
const ONE_OFF = "dddddddd-dddd-dddd-dddd-000000000001";
const WEEKLY = "dddddddd-dddd-dddd-dddd-000000000002";
const FOREIGN_TASK = "dddddddd-dddd-dddd-dddd-000000000003";

type Row = Record<string, unknown>;
type Filter = [op: "eq" | "is", column: string, value: unknown];

function fakeDb() {
  const tables: Record<string, Row[]> = {
    people: [
      { id: MIA, family_id: OURS, deleted_at: null },
      { id: BINNED, family_id: OURS, deleted_at: "2026-09-30T10:00:00Z" },
      { id: OTHER_CHILD, family_id: THEIRS, deleted_at: null },
      { id: NOAH, family_id: OURS, deleted_at: null },
    ],
    todos: [],
    stored: [
      { id: ONE_OFF, family_id: OURS, deleted_at: null, recurrence: "once" },
      { id: WEEKLY, family_id: OURS, deleted_at: null, recurrence: "weekly" },
      { id: FOREIGN_TASK, family_id: THEIRS, deleted_at: null, recurrence: "weekly" },
    ],
  };
  const reads: string[] = [];
  const matches = (filters: Filter[]) => (row: Row) =>
    filters.every(([, column, value]) => (row[column] ?? null) === value);

  const db = {
    from(table: string) {
      const rows = (tables[table] ??= []);
      const filters: Filter[] = [];
      let source = rows;
      const chain = {
        // Reading a task finds the tasks already stored; inserts land in `todos`.
        select() { if (table === "todos") source = tables.stored; reads.push(table); return chain; },
        eq(column: string, value: unknown) { filters.push(["eq", column, value]); return chain; },
        is(column: string, value: unknown) { filters.push(["is", column, value]); return chain; },
        async maybeSingle() { return { data: source.filter(matches(filters))[0] ?? null, error: null }; },
        insert(row: Row) {
          const stored = { id: `todo-${rows.length + 1}`, ...row };
          rows.push(stored);
          return { select: () => ({ single: async () => ({ data: stored, error: null }) }) };
        },
      };
      return chain;
    },
  };
  return { db: db as unknown as TaskDb, tables, reads };
}

test.describe("recurrence", () => {
  test("accepts what the task form stores, and stores days the way it does", () => {
    for (const v of ["once", "daily", "weekly", "biweekly", "monthly"]) expect(parseRecurrence(v)).toBe(v);
    expect(parseRecurrence("days:MO,WE,FR")).toBe("days:MO,WE,FR");
    expect(parseRecurrence("days:fr, mo")).toBe("days:MO,FR");
    expect(parseRecurrence("days:SU,MO")).toBe("days:MO,SU");
    expect(parseRecurrence("days:MO,TU,WE,TH,FR,SA,SU")).toBe("daily");
  });

  test("refuses an unknown value, an empty days: and an unknown weekday code", () => {
    for (const bad of ["", "yearly", "Daily", "days:", "days: ", "days:XX", "days:MO,XX", "days:MO,", "MO,TU", null, 7, undefined]) {
      expect(parseRecurrence(bad), String(bad)).toBeNull();
    }
  });
});

test.describe("the other task fields", () => {
  test("only fields present in the body come back", () => {
    expect(parseTaskExtras({ summary: "x" })).toEqual({ ok: true, value: {} });
    expect(parseTaskExtras({ recurrence: "days:TU,TH", priority: "high", icon: "🧹", points: 5 })).toEqual({
      ok: true, value: { recurrence: "days:TU,TH", priority: "high", icon: "🧹", points: 5 },
    });
  });

  test("recurrence is checked, not passed through", () => {
    expect(parseTaskExtras({ recurrence: "days:" }).ok).toBe(false);
    expect(parseTaskExtras({ recurrence: "fortnightly" }).ok).toBe(false);
    expect(parseTaskExtras({ recurrence: null }).ok).toBe(false);
  });

  test("priority is high, medium or low", () => {
    for (const p of ["high", "medium", "low"]) expect(parseTaskExtras({ priority: p }).ok).toBe(true);
    for (const p of ["urgent", 50, null, "HIGH"]) expect(parseTaskExtras({ priority: p }).ok, String(p)).toBe(false);
  });

  test("icon is one emoji, or none; the form's old nine still pass", () => {
    expect(LEGACY_TODO_ICONS).toHaveLength(9);
    for (const icon of LEGACY_TODO_ICONS) expect(parseTaskExtras({ icon })).toEqual({ ok: true, value: { icon } });
    expect(parseTaskExtras({ icon: "🍦" })).toEqual({ ok: true, value: { icon: "🍦" } });
    expect(parseTaskExtras({ icon: null })).toEqual({ ok: true, value: { icon: null } });
    expect(parseTaskExtras({ icon: "" })).toEqual({ ok: true, value: { icon: null } });
    // The bin without its variation selector is the text character, not the emoji.
    for (const bad of ["\u{1F5D1}", "🇩🇪", "🧹🧹", "broom", 1]) expect(parseTaskExtras({ icon: bad }).ok, String(bad)).toBe(false);
  });

  test("points are a whole number from 0 to 10000", () => {
    for (const p of [0, 1, 10_000]) expect(parseTaskExtras({ points: p }).ok).toBe(true);
    for (const p of [-1, 10_001, 2.5, "5", null, Number.NaN]) expect(parseTaskExtras({ points: p }).ok, String(p)).toBe(false);
  });
});

test.describe("the assignee", () => {
  test("a person of this family who is not binned, or null", async () => {
    const { db } = fakeDb();
    expect(await familyPersonId(db, OURS, MIA)).toEqual({ ok: true, value: MIA });
    expect(await familyPersonId(db, OURS, null)).toEqual({ ok: true, value: null });
  });

  test("another family's person, a binned one and an unknown one are refused alike", async () => {
    const { db } = fakeDb();
    for (const id of [OTHER_CHILD, BINNED, NOWHERE]) {
      expect(await familyPersonId(db, OURS, id), id).toEqual({ ok: false, error: "no such person in this family" });
    }
    expect(await familyPersonId(db, OURS, "mia")).toEqual({ ok: false, error: "`person_id` must be a uuid or null" });
  });
});

test.describe("POST /lists/tasks", () => {
  test("stores every field the form offers", async () => {
    const { db, tables } = fakeDb();
    const result = await createListTask(db, OURS, {
      summary: " Feed the cat ", due: "2026-10-02", person_id: MIA,
      recurrence: "days:mo,fr", priority: "high", icon: "🐾", points: 3,
    });
    expect(result).toEqual({ status: 201, response: { id: "todo-1", summary: "Feed the cat", status: "needs_action", due: "2026-10-02" } });
    expect(tables.todos).toEqual([{
      id: "todo-1", family_id: OURS, title: "Feed the cat", completed: false, due_date: "2026-10-02",
      person_id: MIA, recurrence: "days:MO,FR", priority: "high", icon: "🐾", points: 3,
    }]);
  });

  test("with only a summary, leaves the rest to the column defaults", async () => {
    const { db, tables } = fakeDb();
    await createListTask(db, OURS, { summary: "Bins" });
    expect(tables.todos).toEqual([{ id: "todo-1", family_id: OURS, title: "Bins", completed: false }]);
  });

  test("refuses another family's person with the PATCH route's error, and writes nothing", async () => {
    const { db, tables } = fakeDb();
    const result = await createListTask(db, OURS, { summary: "Bins", person_id: OTHER_CHILD });
    expect(result).toEqual({ status: 400, response: { error: "no such person in this family", code: "invalid_request" } });
    expect(tables.todos).toEqual([]);
  });

  test("refuses a bad recurrence and writes nothing", async () => {
    const { db, tables } = fakeDb();
    for (const recurrence of ["days:", "days:MO,XX", "yearly"]) {
      const result = await createListTask(db, OURS, { summary: "Bins", recurrence });
      expect(result.status, recurrence).toBe(400);
    }
    expect(tables.todos).toEqual([]);
  });
});

test.describe("services/create_task (RFC-001)", () => {
  test("refuses another family's person with the PATCH route's error, and writes nothing", async () => {
    const { db, tables } = fakeDb();
    const result = await createServiceTask(db, OURS, { title: "Bins", person_id: OTHER_CHILD });
    expect(result).toEqual({ status: 400, response: { error: "no such person in this family", code: "invalid_request" } });
    expect(tables.todos).toEqual([]);
  });

  test("still assigns a person of this family", async () => {
    const { db, tables } = fakeDb();
    const result = await createServiceTask(db, OURS, { title: "Bins", person_id: MIA, due_at: "2026-10-02T18:00:00" });
    expect(result).toEqual({ status: 201, response: { id: "todo-1", title: "Bins" } });
    expect(tables.todos).toEqual([{ id: "todo-1", family_id: OURS, title: "Bins", completed: false, due_date: "2026-10-02", person_id: MIA }]);
  });

  test("the frozen contract is otherwise unchanged: a numeric priority and odd due_at are ignored, not refused", async () => {
    const { db, tables } = fakeDb();
    // Home Assistant's services.yaml sends priority as a number 0-100.
    expect((await createServiceTask(db, OURS, { title: "A", priority: 80 })).status).toBe(201);
    expect((await createServiceTask(db, OURS, { title: "B", due_at: "" })).status).toBe(201);
    expect((await createServiceTask(db, OURS, { title: "C", due_at: 5, person_id: 7 })).status).toBe(201);
    expect((await createServiceTask(db, OURS, { title: "D", due_at: "tomorrow" })).status).toBe(400);
    expect(tables.todos.map((t) => Object.keys(t).sort())).toEqual([
      ["completed", "family_id", "id", "title"],
      ["completed", "family_id", "id", "title"],
      ["completed", "family_id", "id", "title"],
    ]);
  });
});

test("all three write paths use the one assignee check", () => {
  const read = (...p: string[]) => codeOnly(readFileSync(join(__dirname, "..", "src", "app", "api", "integration", "v1", ...p), "utf8"));
  expect(read("lists", "[list]", "route.ts")).toContain("createListTask(");
  expect(read("services", "[service]", "route.ts")).toContain("createServiceTask(");
  const patch = read("lists", "[list]", "[item]", "route.ts");
  expect(patch).toContain("familyPersonId(");
  expect(patch).toContain("parseTaskExtras(");
  expect(patch).not.toContain(".from(\"people\")");
});

/**
 * Taking turns (#341) through the Integration API: the people who take turns
 * and whether done / not done is tracked, on POST /lists/tasks and PATCH
 * /lists/tasks/{id}. The task form's rules -- both need a repeating task, a
 * rotation with nobody in it is none -- become refusals, and every person is
 * checked against the family like an assignee.
 */
test.describe("taking turns: POST /lists/tasks", () => {
  test("stores the people in turn order and tracking, on a repeating task", async () => {
    const { db, tables } = fakeDb();
    const result = await createListTask(db, OURS, {
      summary: "Wash up", recurrence: "daily", rotation_person_ids: [NOAH, MIA], track_completion: true,
    });
    expect(result.status).toBe(201);
    expect(tables.todos).toEqual([{
      id: "todo-1", family_id: OURS, title: "Wash up", completed: false,
      recurrence: "daily", rotation_person_ids: [NOAH, MIA], track_completion: true,
    }]);
  });

  test("turns or tracking without a repetition are refused, and nothing is written", async () => {
    const { db, tables } = fakeDb();
    for (const body of [
      { rotation_person_ids: [MIA, NOAH] },
      { rotation_person_ids: [MIA, NOAH], recurrence: "once" },
      { track_completion: true },
      { track_completion: true, recurrence: "once" },
    ]) {
      const result = await createListTask(db, OURS, { summary: "Wash up", ...body });
      expect(result, JSON.stringify(body)).toEqual({ status: 400, response: {
        error: "taking turns (`rotation_person_ids`) and `track_completion` need a repeating task: send a recurrence other than once",
        code: "invalid_request",
      } });
    }
    // Switched off is fine on any task.
    expect((await createListTask(db, OURS, { summary: "A", track_completion: false })).status).toBe(201);
    expect((await createListTask(db, OURS, { summary: "B", rotation_person_ids: null })).status).toBe(201);
    expect(tables.todos.map((t) => t.title)).toEqual(["A", "B"]);
  });

  test("a rotation with nobody in it is refused", async () => {
    const { db, tables } = fakeDb();
    const result = await createListTask(db, OURS, { summary: "Wash up", recurrence: "daily", rotation_person_ids: [] });
    expect(result.status).toBe(400);
    expect(result.response.error).toContain("needs at least one person");
    expect(tables.todos).toEqual([]);
  });

  test("another family's person, a binned one or an unknown one cannot take turns", async () => {
    const { db, tables } = fakeDb();
    for (const stranger of [OTHER_CHILD, BINNED, NOWHERE]) {
      const result = await createListTask(db, OURS, { summary: "Wash up", recurrence: "daily", rotation_person_ids: [MIA, stranger] });
      expect(result, stranger).toEqual({ status: 400, response: { error: "`rotation_person_ids`: no such person in this family", code: "invalid_request" } });
    }
    expect(tables.todos).toEqual([]);
  });

  test("shape errors: not a list, not ids, someone twice, too many, an assignee as well, tracking not a boolean", async () => {
    const { db, tables } = fakeDb();
    for (const body of [
      { rotation_person_ids: MIA },
      { rotation_person_ids: ["mia"] },
      { rotation_person_ids: [MIA, NOAH, MIA] },
      { rotation_person_ids: Array.from({ length: 21 }, () => MIA) },
      { rotation_person_ids: [MIA, NOAH], person_id: MIA },
      { track_completion: "yes" },
    ]) {
      const result = await createListTask(db, OURS, { summary: "Wash up", recurrence: "daily", ...body });
      expect(result.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect(tables.todos).toEqual([]);
  });
});

test.describe("taking turns: PATCH /lists/tasks/{id}", () => {
  test("null or an empty list stops the rotation, without reading the task", async () => {
    const { db, reads } = fakeDb();
    expect(await taskTurnsPatch(db, OURS, WEEKLY, { rotation_person_ids: null }, undefined)).toEqual({ ok: true, value: { rotation_person_ids: null } });
    expect(await taskTurnsPatch(db, OURS, WEEKLY, { rotation_person_ids: [] }, undefined)).toEqual({ ok: true, value: { rotation_person_ids: null } });
    expect(await taskTurnsPatch(db, OURS, ONE_OFF, { track_completion: false }, undefined)).toEqual({ ok: true, value: { track_completion: false } });
    expect(reads).toEqual([]);
  });

  test("turns on a task that repeats are taken; on one that does not, refused", async () => {
    const { db } = fakeDb();
    expect(await taskTurnsPatch(db, OURS, WEEKLY, { rotation_person_ids: [MIA, NOAH] }, undefined))
      .toEqual({ ok: true, value: { rotation_person_ids: [MIA, NOAH] } });
    const refused = await taskTurnsPatch(db, OURS, ONE_OFF, { rotation_person_ids: [MIA, NOAH] }, undefined);
    expect(refused).toEqual({ ok: false, error: "taking turns (`rotation_person_ids`) and `track_completion` need a repeating task: send a recurrence other than once" });
    expect((await taskTurnsPatch(db, OURS, ONE_OFF, { track_completion: true }, undefined)).ok).toBe(false);
  });

  test("the repetition sent in the same patch is the one that counts", async () => {
    const { db, reads } = fakeDb();
    // A one-off task made weekly with turns in one go.
    expect(await taskTurnsPatch(db, OURS, ONE_OFF, { rotation_person_ids: [MIA] }, "weekly"))
      .toEqual({ ok: true, value: { rotation_person_ids: [MIA] } });
    expect(reads).toEqual(["people"]);
    // A weekly task made one-off while asking for turns.
    expect((await taskTurnsPatch(db, OURS, WEEKLY, { rotation_person_ids: [MIA] }, "once")).ok).toBe(false);
  });

  test("making a task one-off switches turns and tracking off, as the form does", async () => {
    const { db } = fakeDb();
    expect(await taskTurnsPatch(db, OURS, WEEKLY, {}, "once"))
      .toEqual({ ok: true, value: { rotation_person_ids: null, track_completion: false } });
  });

  test("another family's task is not found, and a stranger cannot be added", async () => {
    const { db } = fakeDb();
    expect(await taskTurnsPatch(db, OURS, FOREIGN_TASK, { rotation_person_ids: [MIA] }, undefined)).toEqual({ ok: false, notFound: true });
    expect(await taskTurnsPatch(db, OURS, WEEKLY, { rotation_person_ids: [MIA, OTHER_CHILD] }, undefined))
      .toEqual({ ok: false, error: "`rotation_person_ids`: no such person in this family" });
  });

  test("the route applies it to tasks, behind tasks:write, which family:read alone does not give", () => {
    const read = (...p: string[]) => codeOnly(readFileSync(join(__dirname, "..", "src", "app", "api", "integration", "v1", ...p), "utf8"));
    const patch = read("lists", "[list]", "[item]", "route.ts");
    expect(patch).toContain("taskTurnsPatch(supabase, context.familyId, item, body, extras.value.recurrence)");
    expect(patch).toContain("withIntegrationAuth(request, scope,");
    expect(LISTS.tasks.writeScope).toBe("tasks:write");
    expect(hasScope(["family:read"], "tasks:write")).toBe(false);
    // The shopping list refuses the turn fields like the other task fields.
    expect(patch).toContain("TASK_ONLY_FIELDS.find(");
  });
});

test.describe("taking turns: reading the list", () => {
  const at = { now: new Date("2026-10-07T08:00:00Z"), timeZone: "Europe/Berlin" };
  const row = {
    id: "t", title: "Wash up", completed: false, due_date: null, recurrence: "daily", person_id: MIA,
    rotation_person_ids: [MIA, NOAH], track_completion: false,
    schedule_start_day: "2026-10-05", schedule_anchor_day: "2026-10-05", rotation_offset: 0,
    last_completed_day: null, carry_day: null,
  };

  test("a task with turns says who takes them and whose turn it is today", () => {
    // 5 Oct Mia, 6 Oct Noah, 7 Oct Mia.
    expect(toListItem(LISTS.tasks, row, at)).toEqual({
      id: "t", summary: "Wash up", status: "needs_action", due: null,
      rotation_person_ids: [MIA, NOAH], today_person_id: MIA,
    });
    expect(toListItem(LISTS.tasks, row, { ...at, now: new Date("2026-10-06T08:00:00Z") }).today_person_id).toBe(NOAH);
  });

  test("tracking is said only when on; any other task keeps its shape", () => {
    expect(toListItem(LISTS.tasks, { ...row, rotation_person_ids: null, track_completion: true }, at)).toEqual({
      id: "t", summary: "Wash up", status: "needs_action", due: null, track_completion: true,
    });
    expect(toListItem(LISTS.tasks, { id: "b", title: "Müll", completed: true, due_date: "2026-08-09", person_id: MIA }))
      .toEqual({ id: "b", summary: "Müll", status: "completed", due: "2026-08-09" });
  });
});
