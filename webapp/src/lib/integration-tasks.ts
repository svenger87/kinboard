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
export const TASK_ONLY_FIELDS = ["person_id", "recurrence", "priority", "icon", "points"] as const;

type Created = { status: number; response: Record<string, unknown> };

/**
 * POST /lists/tasks once the key and idempotency are dealt with: validate
 * everything, then insert. Nothing is written when any field is refused.
 * Throws on a database error.
 */
export async function createListTask(db: TaskDb, familyId: string, body: Record<string, unknown>): Promise<Created> {
  const summary = itemSummary(body.summary);
  if (!summary) return invalidRequest("`summary` is required");
  const due = itemDue(body.due);
  if (!due.ok) return invalidRequest("`due` must start with YYYY-MM-DD");

  const extras = parseTaskExtras(body);
  if (!extras.ok) return invalidRequest(extras.error);

  const row: Record<string, unknown> = { family_id: familyId, title: summary, completed: false, ...extras.value };
  if (due.value) row.due_date = due.value;

  if (body.person_id !== undefined) {
    const person = await familyPersonId(db, familyId, body.person_id);
    if (!person.ok) return invalidRequest(person.error);
    if (person.value) row.person_id = person.value;
  }

  const { data, error } = await (db as any).from("todos").insert(row).select("id").single();
  if (error) throw error;
  return { status: 201, response: { id: String(data.id), summary, status: "needs_action", due: due.value } };
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
