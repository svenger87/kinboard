import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asksWhoDidIt, doneByOrder } from "../src/lib/done-by";
import { detectTaskTick, type TickRow } from "../src/lib/pocket-money/creature-reactions";
import { codeOnly } from "./source-helpers";

/**
 * "Who did it?" (migration_zzzzzzzzzzzzz_todo_done_by.sql, lib/done-by.ts).
 * A task's points went to its assignee or whoever's turn it was, so Jonas
 * doing Mira's dishes earned Mira the points. A tick worth points now asks,
 * and the database pays whoever is picked. The trigger itself is exercised
 * against a real database in todo-done-by-db.spec.ts.
 */

const MIRA = "00000000-0000-4000-8000-0000000000a1";
const JONAS = "00000000-0000-4000-8000-0000000000a2";
const DAD = "00000000-0000-4000-8000-0000000000b1";
const people = [
  { id: DAD, name: "Dad", is_child: false },
  { id: JONAS, name: "Jonas", is_child: true },
  { id: MIRA, name: "Mira", is_child: true },
];

test.describe("when the picker asks", () => {
  test("only for a task worth points, in a family of more than one", () => {
    expect(asksWhoDidIt({ points: 5 }, people)).toBe(true);
    expect(asksWhoDidIt({ points: 0 }, people)).toBe(false);
    expect(asksWhoDidIt({ points: null }, people)).toBe(false);
    expect(asksWhoDidIt({ points: 5 }, [people[0]])).toBe(false);
  });

  test("whoever the task is for comes first, then the children, then the adults", () => {
    expect(doneByOrder(people, MIRA).map((p) => p.name)).toEqual(["Mira", "Jonas", "Dad"]);
    expect(doneByOrder(people, DAD).map((p) => p.name)).toEqual(["Dad", "Jonas", "Mira"]);
    expect(doneByOrder(people, null).map((p) => p.name)).toEqual(["Jonas", "Mira", "Dad"]);
  });

  test("un-ticking never asks", () => {
    const page = codeOnly(readFileSync(join(__dirname, "..", "src", "app", "todos", "page.tsx"), "utf8"));
    expect(page).toContain("if (!unticking && asksWhoDidIt(task, people ?? []))");
  });
});

test.describe("the creature that cheers", () => {
  const isChild = (id: string) => id === MIRA || id === JONAS;
  const once = (over: Partial<TickRow> = {}): TickRow => ({
    id: "t", recurrence: "once", person_id: MIRA, completed: false, points: 5, ...over,
  });

  test("is the one who did it", () => {
    expect(detectTaskTick(once(), once({ completed: true, last_completed_by: JONAS }), isChild))
      ?.toMatchObject({ personId: JONAS });
  });

  test("is the assignee's when the tick did not say", () => {
    expect(detectTaskTick(once(), once({ completed: true }), isChild))?.toMatchObject({ personId: MIRA });
  });

  test("is nobody's when a parent did it", () => {
    expect(detectTaskTick(once(), once({ completed: true, last_completed_by: DAD }), isChild)).toBeNull();
  });
});

test.describe("the migration", () => {
  const sql = codeOnly(
    readFileSync(join(__dirname, "..", "docker", "migration_zzzzzzzzzzzzz_todo_done_by.sql"), "utf8"),
    { sql: true },
  );

  test("done_by is an argument: read, then cleared on every update and insert", () => {
    expect(sql).toContain("NEW.done_by := NULL;");
    expect(sql).toMatch(/CREATE TRIGGER todos_zz_clear_done_by BEFORE INSERT ON public\.todos/);
  });

  test("runs after the schedule trigger, which decides whether a tick took", () => {
    // BEFORE triggers fire in name order.
    expect("todos_zz_done_by" > "todos_schedule_update").toBe(true);
    expect(sql).toMatch(/CREATE TRIGGER todos_zz_done_by BEFORE UPDATE ON public\.todos/);
  });

  test("only this family's people, not one in the recycle bin", () => {
    expect(sql).toContain("WHERE p.id = NEW.done_by AND p.family_id = NEW.family_id AND p.deleted_at IS NULL");
  });

  test("points go to who did it, else as before", () => {
    expect(sql).toContain("award_person UUID := coalesce(NEW.last_completed_by, NEW.person_id);");
    expect(sql).toContain("award_person := coalesce(occ.completed_by, occ.person_id);");
    // Children only, as before.
    expect(sql).toContain("WHERE id = award_person AND family_id = NEW.family_id AND is_child");
  });

  test("sorts after the turns migration whose function it replaces", () => {
    expect("migration_zzzzzzzzzzzzz_todo_done_by.sql" > "migration_zzzzzy_todo_turns.sql").toBe(true);
  });
});
