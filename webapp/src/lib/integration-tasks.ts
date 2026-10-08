/**
 * Creating and editing tasks through the Integration API with everything the
 * task form offers: assignee, repetition, priority, icon and points.
 *
 * Shared by the three routes that write tasks — POST and PATCH on
 * /lists/tasks, and RFC-001's services/create_task — so the assignee check in
 * particular exists once. services/create_task used to pass any string
 * `person_id` straight into the insert, which let a token of one family
 * assign its task to a person of another; the column's foreign key only
 * checks that the person exists somewhere.
 */

import type { createAdminClient } from "@/lib/supabase/server";
import { parseRecurrence } from "@/lib/todo-recurrence";
import { todoIcon } from "@/lib/todo-icons";
import { itemDue, itemSummary } from "@/lib/integration-lists";

export type TaskDb = ReturnType<typeof createAdminClient>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_RE.test(value);

export const TASK_PRIORITIES = ["high", "medium", "low"] as const;
export const MAX_TASK_POINTS = 10_000;

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

/** What a refused field looks like on the wire, so every route words it the same. */
export function invalidRequest(error: string) {
  return { status: 400 as const, response: { error, code: "invalid_request" as const } };
}

/**
 * An assignee, checked against the family: a uuid naming a person of this
 * family who is not in the recycle bin, or null for nobody. Anything else is
 * refused with the same two messages the PATCH route has always given — a
 * caller cannot tell a person of another family from one that never existed.
 *
 * Throws on a database error.
 */
export async function familyPersonId(
  db: TaskDb,
  familyId: string,
  value: unknown,
): Promise<{ ok: true; value: string | null } | { ok: false; error: string }> {
  if (value === null) return { ok: true, value: null };
  if (!isUuid(value)) {
    return { ok: false, error: "`person_id` must be a uuid or null" };
  }
  const { data, error } = await (db as any)
    .from("people")
    .select("id")
    .eq("id", value)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: "no such person in this family" };
  return { ok: true, value };
}

export interface TaskExtras {
  recurrence?: string;
  priority?: (typeof TASK_PRIORITIES)[number];
  icon?: string | null;
  points?: number;
}

/**
 * The optional fields beyond title, date and assignee, from a request body.
 * Only keys present in the body appear in the result, so the same parse
 * serves a create (absent = the column's default) and a patch (absent =
 * leave it alone).
 *
 * recurrence: see parseRecurrence. priority: high, medium or low. icon: one
 * emoji (lib/todo-icons.ts), or null / "" for none. points: a whole number 0..10000 —
 * the column's own check — accepted whoever the task is for, though the
 * database only ever awards them to a child.
 */
export function parseTaskExtras(body: Record<string, unknown>): Outcome<TaskExtras> {
  const out: TaskExtras = {};
  const bad = (error: string) => ({ ok: false as const, error });

  if ("recurrence" in body) {
    const recurrence = parseRecurrence(body.recurrence);
    if (!recurrence) {
      return bad("`recurrence` must be once, daily, weekly, biweekly, monthly or days: with weekday codes, e.g. days:MO,WE,FR");
    }
    out.recurrence = recurrence;
  }
  if ("priority" in body) {
    const priority = body.priority;
    if (typeof priority !== "string" || !(TASK_PRIORITIES as readonly string[]).includes(priority)) {
      return bad("`priority` must be high, medium or low");
    }
    out.priority = priority as TaskExtras["priority"];
  }
  if ("icon" in body) {
    const icon = body.icon;
    if (icon === null || icon === "") out.icon = null;
    else if (todoIcon(icon)) out.icon = todoIcon(icon);
    else return bad("`icon` must be a single emoji (flags excepted), or null");
  }
  if ("points" in body) {
    const points = body.points;
    if (typeof points !== "number" || !Number.isInteger(points) || points < 0 || points > MAX_TASK_POINTS) {
      return bad(`\`points\` must be a whole number from 0 to ${MAX_TASK_POINTS}`);
    }
    out.points = points;
  }
  return { ok: true, value: out };
}

/** The body fields only a task has; a shopping item refuses them. */
export const TASK_ONLY_FIELDS = ["person_id", "recurrence", "priority", "icon", "points", "rotation_person_ids", "track_completion"] as const;

/** More people than any household has; past this the list is a mistake. */
export const MAX_ROTATION_PEOPLE = 20;

/** Taking turns and tracking (#341), as the task form stores them. */
export interface TaskTurns {
  rotation_person_ids?: string[] | null;
  track_completion?: boolean;
}

/**
 * The people who take turns, and whether done / not done is tracked, from a
 * request body: the task form's `turnFields` (app/todos/page.tsx), with its
 * two rules made refusals rather than silent corrections, because an
 * assistant that asked for turns must hear when it gets none:
 *
 *   - both only mean anything on a repeating task, so asking for either on a
 *     task that does not repeat is refused (`turnsNeedRepetition`);
 *   - a rotation with nobody in it is no rotation, so a create that sends an
 *     empty one is refused. On an edit, an empty list or null stops the
 *     rotation, as clearing every person in the form does.
 *
 * Each id must be a person of this family who is not in the recycle bin,
 * checked with `familyPersonId` like any assignee. The database would drop
 * a stranger silently (`todo_clean_rotation`); refusing says so. Nobody may
 * appear twice: the database keeps only the first, which is not what was
 * asked for. Only keys present in the body appear in the result.
 * Throws on a database error.
 */
export async function parseTaskTurns(
  db: TaskDb,
  familyId: string,
  body: Record<string, unknown>,
  mode: "create" | "update",
): Promise<Outcome<TaskTurns>> {
  const out: TaskTurns = {};
  const bad = (error: string) => ({ ok: false as const, error });

  if ("rotation_person_ids" in body) {
    const ids = body.rotation_person_ids;
    if (ids === null || (mode === "update" && Array.isArray(ids) && ids.length === 0)) {
      out.rotation_person_ids = null;
    } else if (!Array.isArray(ids)) {
      return bad("`rotation_person_ids` must be a list of person ids, or null");
    } else if (ids.length === 0) {
      return bad("`rotation_person_ids` needs at least one person; leave it out for a task nobody takes turns on");
    } else if (ids.length > MAX_ROTATION_PEOPLE) {
      return bad(`\`rotation_person_ids\` takes at most ${MAX_ROTATION_PEOPLE} people`);
    } else if (new Set(ids).size !== ids.length) {
      return bad("`rotation_person_ids` names someone twice; each person takes one turn in the round");
    } else {
      // On a task that takes turns, whose turn it is decides who it is for:
      // the database sets the assignee from the rotation and would quietly
      // overwrite one sent alongside it.
      if (body.person_id !== undefined && body.person_id !== null) {
        return bad("send `person_id` or `rotation_person_ids`, not both: on a task that takes turns, whose turn it is decides who it is for");
      }
      for (const id of ids) {
        if (!isUuid(id)) return bad("`rotation_person_ids` must be a list of person ids, or null");
        const person = await familyPersonId(db, familyId, id);
        if (!person.ok) return bad(`\`rotation_person_ids\`: ${person.error}`);
      }
      out.rotation_person_ids = ids as string[];
    }
  }
  if ("track_completion" in body) {
    if (typeof body.track_completion !== "boolean") return bad("`track_completion` must be true or false");
    out.track_completion = body.track_completion;
  }
  return { ok: true, value: out };
}

/** True when the turns ask for a schedule: someone takes turns, or done / not done is tracked. */
export function turnsWanted(turns: TaskTurns): boolean {
  return (turns.rotation_person_ids?.length ?? 0) > 0 || turns.track_completion === true;
}

/**
 * The form's other rule: taking turns and tracking need a repeating task.
 * `recurrence` is the one the task will have once written. Null when fine.
 */
export function turnsNeedRepetition(recurrence: string | null | undefined, turns: TaskTurns): string | null {
  if (!turnsWanted(turns) || (recurrence ?? "once") !== "once") return null;
  return "taking turns (`rotation_person_ids`) and `track_completion` need a repeating task: send a recurrence other than once";
}

/**
 * The turns part of PATCH /lists/tasks/{id}: what to write, or why not.
 *
 * Whether the task repeats is the repetition it will have after the patch --
 * the one sent, or else the stored one, read only when needed. Setting the
 * repetition to once also switches turns and tracking off, as the form does
 * (the database drops the rotation then anyway, `todo_schedule_update`).
 * `not_found` when the task had to be read and is not this family's.
 * Throws on a database error.
 */
export async function taskTurnsPatch(
  db: TaskDb,
  familyId: string,
  taskId: string,
  body: Record<string, unknown>,
  recurrence: string | undefined,
): Promise<{ ok: true; value: TaskTurns } | { ok: false; error: string } | { ok: false; notFound: true }> {
  const turns = await parseTaskTurns(db, familyId, body, "update");
  if (!turns.ok) return turns;
  if (recurrence === "once") {
    const unrepeated = turnsNeedRepetition(recurrence, turns.value);
    if (unrepeated) return { ok: false, error: unrepeated };
    return { ok: true, value: { rotation_person_ids: null, track_completion: false } };
  }
  if (recurrence === undefined && turnsWanted(turns.value)) {
    const { data, error } = await (db as any)
      .from("todos")
      .select("recurrence")
      .eq("id", taskId)
      .eq("family_id", familyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, notFound: true };
    const unrepeated = turnsNeedRepetition(data.recurrence, turns.value);
    if (unrepeated) return { ok: false, error: unrepeated };
  }
  return turns;
}

type Created = { status: number; response: Record<string, unknown> };

/** A task ready to insert, or why not. */
type Prepared =
  | { ok: true; row: Record<string, unknown>; summary: string; due: string | null }
  | { ok: false; error: string };

/**
 * Everything POST /lists/tasks checks, without writing: the row to insert,
 * or the first refusal. Shared by the single create and the batch, so the
 * two cannot accept different tasks. Throws on a database error.
 */
export async function prepareListTask(db: TaskDb, familyId: string, body: Record<string, unknown>): Promise<Prepared> {
  const summary = itemSummary(body.summary);
  if (!summary) return { ok: false, error: "`summary` is required" };
  const due = itemDue(body.due);
  if (!due.ok) return { ok: false, error: "`due` must start with YYYY-MM-DD" };

  const extras = parseTaskExtras(body);
  if (!extras.ok) return extras;
  const turns = await parseTaskTurns(db, familyId, body, "create");
  if (!turns.ok) return turns;
  const unrepeated = turnsNeedRepetition(extras.value.recurrence, turns.value);
  if (unrepeated) return { ok: false, error: unrepeated };

  const row: Record<string, unknown> = { family_id: familyId, title: summary, completed: false, ...extras.value, ...turns.value };
  if (due.value) row.due_date = due.value;

  if (body.person_id !== undefined) {
    const person = await familyPersonId(db, familyId, body.person_id);
    if (!person.ok) return person;
    if (person.value) row.person_id = person.value;
  }
  return { ok: true, row, summary, due: due.value };
}

/**
 * POST /lists/tasks once the key and idempotency are dealt with: validate
 * everything, then insert. Nothing is written when any field is refused.
 * Throws on a database error.
 */
export async function createListTask(db: TaskDb, familyId: string, body: Record<string, unknown>): Promise<Created> {
  const prepared = await prepareListTask(db, familyId, body);
  if (!prepared.ok) return invalidRequest(prepared.error);
  const { data, error } = await (db as any).from("todos").insert(prepared.row).select("id").single();
  if (error) throw error;
  return { status: 201, response: { id: String(data.id), summary: prepared.summary, status: "needs_action", due: prepared.due } };
}

/** The most tasks one batch creates: a routine, not an import. */
export const MAX_BATCH_TASKS = 15;

/**
 * POST /tasks/batch once the key and idempotency are dealt with: several
 * tasks, all or none. Every task is checked first, exactly as a single
 * create checks it (prepareListTask); the first refusal is a 400 naming the
 * task by its position (1-based) and title, and nothing is written. Then all
 * rows go to the database in ONE insert, a single statement: if any row
 * fails there (a trigger, a constraint), none is kept. Ids come back in the
 * order sent. Throws on a database error; one the insert answered with
 * wrote nothing.
 */
export async function createListTasks(
  db: TaskDb, familyId: string, body: Record<string, unknown>,
  /** Called right before the insert: everything until then wrote nothing. */
  beforeWrite: () => void = () => {},
): Promise<Created> {
  const tasks = body.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) return invalidRequest("`tasks` must be a list of 1 to 15 tasks");
  if (tasks.length > MAX_BATCH_TASKS) return invalidRequest(`\`tasks\` takes at most ${MAX_BATCH_TASKS} tasks at once`);

  const prepared: Extract<Prepared, { ok: true }>[] = [];
  for (const [i, task] of tasks.entries()) {
    const item = task && typeof task === "object" && !Array.isArray(task) ? (task as Record<string, unknown>) : null;
    const title = item ? itemSummary(item.summary) : null;
    const which = `task ${i + 1}${title ? ` ("${title}")` : ""}`;
    const refuse = (error: string) => {
      const refused = invalidRequest(`${which}: ${error}. Nothing was created.`);
      return { status: refused.status, response: { ...refused.response, index: i } };
    };
    if (!item) return refuse("must be an object");
    const one = await prepareListTask(db, familyId, item);
    if (!one.ok) return refuse(one.error);
    prepared.push(one);
  }

  beforeWrite();
  // defaultToNull: false, or PostgREST sends the union of every row's keys
  // and writes NULL where a row has none, instead of the column's default:
  // a task without track_completion then breaks its NOT NULL, and one
  // without priority loses "medium". With it, each row is what a single
  // create writes.
  const { data, error } = await (db as any).from("todos")
    .insert(prepared.map((p) => p.row), { defaultToNull: false })
    .select("id");
  if (error) throw error;
  const ids = ((data ?? []) as { id: unknown }[]).map((r) => String(r.id));
  if (ids.length !== prepared.length) throw new Error(`batch insert returned ${ids.length} rows for ${prepared.length} tasks`);
  return {
    status: 201,
    response: {
      created: prepared.map((p, i) => ({ id: ids[i], summary: p.summary, status: "needs_action", due: p.due })),
    },
  };
}

/**
 * RFC-001's services/create_task. Its arguments are a frozen contract with
 * the Home Assistant integration, so only the assignee check is added here,
 * not the new fields: Home Assistant already sends `priority` as a number
 * from 0 to 100, which the high/medium/low column cannot take, and refusing
 * it would break automations that work today. A non-string person_id is
 * still ignored, as it always was; a string one must now name a person of
 * this family. Throws on a database error.
 */
export async function createServiceTask(db: TaskDb, familyId: string, body: Record<string, unknown>): Promise<Created> {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length === 0 || title.length > 300) return invalidRequest("`title` is required");

  // due_at in the contract is a date for a to-do; the column is a date. A
  // due_at that is not a string, is blank or is over 40 characters has
  // always been ignored rather than refused, and still is.
  const due = typeof body.due_at === "string" ? body.due_at.trim() : "";
  const usableDue = due.length > 0 && due.length <= 40 ? due : null;
  if (usableDue && !/^\d{4}-\d{2}-\d{2}/.test(usableDue)) {
    return invalidRequest("`due_at` must start with YYYY-MM-DD");
  }
  const dueDate = usableDue ? usableDue.slice(0, 10) : null;

  let personId: string | null = null;
  if (typeof body.person_id === "string") {
    const person = await familyPersonId(db, familyId, body.person_id);
    if (!person.ok) return invalidRequest(person.error);
    personId = person.value;
  }

  const { data, error } = await (db as any)
    .from("todos")
    .insert({
      family_id: familyId,
      title,
      completed: false,
      ...(dueDate ? { due_date: dueDate } : {}),
      ...(personId ? { person_id: personId } : {}),
    })
    .select("id")
    .single();
  if (error) throw error;
  return { status: 201, response: { id: data.id, title } };
}
