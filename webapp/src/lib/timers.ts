/**
 * Kitchen timers, shared between the session routes (`/api/timers`, the
 * panel and phones) and the Integration API (`/api/integration/v1/timers`,
 * an assistant calling `start_timer` / `stop_timer`). RFC-004 §2, RFC-012.
 *
 * Starting a timer is two writes: the row, and the `scheduled_notifications`
 * push that announces its end. Stopping one is also two: the push is
 * cancelled, then the row is stamped `dismissed_at`. Both callers must do
 * exactly the same, so it lives here once.
 *
 * The admin client carries the service role and bypasses RLS: every
 * statement here is scoped by `family_id` itself. The client is a parameter
 * so all of this is tested without a stack (e2e/integration-timers.spec.ts).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { remainingSeconds, timerState } from "@/lib/timer-math";
import type { Timer } from "@/types/database";

/** The slice of the Supabase client used here; a test passes a fake. */
export type TimerDb = ReturnType<typeof createAdminClient>;

/** 24 hours: RFC-012's bound for an assistant's timer. */
export const MAX_TIMER_SECONDS = 86_400;
export const MAX_TIMER_LABEL = 60;
/** Not dismissed (running or ringing) timers a family may have before an assistant is refused another. */
export const MAX_ACTIVE_TIMERS = 10;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Timers not yet dismissed — running or ringing — newest first. */
export async function listActiveTimers(db: TimerDb, familyId: string) {
  return db
    .from("timers")
    .select("*")
    .eq("family_id", familyId)
    .is("dismissed_at", null)
    .order("started_at", { ascending: false });
}

/** How many of the family's timers are not dismissed. Throws on a database error. */
export async function countActiveTimers(db: TimerDb, familyId: string): Promise<number> {
  const { count, error } = await db
    .from("timers")
    .select("id", { count: "exact", head: true })
    .eq("family_id", familyId)
    .is("dismissed_at", null);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Start a timer, and queue the push that announces its end.
 *
 * The push is a `scheduled_notifications` row rather than anything new: the
 * existing processor runs every 30 seconds and sends whatever is due. It is
 * tagged with `related_entity_type: "timer"` and the timer's id so that
 * cancelling can find and delete it — see `cancelScheduledPush`.
 *
 * Returns the insert's own `{ data, error }`; the push failing never fails
 * the timer.
 */
export async function startTimer(
  db: TimerDb,
  familyId: string,
  label: string | null,
  durationSeconds: number,
) {
  const { data: timer, error } = await db
    .from("timers")
    .insert({ family_id: familyId, label, duration_seconds: durationSeconds })
    .select()
    .single();

  if (error || !timer) return { timer: null, error };

  // Queue the announcement. A failure here must not fail the timer itself —
  // the panel still counts down and still rings; only the phone push is lost.
  //
  // `title` is written in English because `scheduled_notifications.title` is
  // `NOT NULL` and nothing has resolved the recipient's locale yet at insert
  // time — it's a sensible fallback if it's ever read directly, not what
  // gets sent. The send side (process-notifications' `case "timer"`) renders
  // the real, locale-aware push through `getPushTranslator`, and needs the
  // label on its own rather than baked into a sentence, so it goes in `data`.
  const dueAt = new Date(Date.parse(timer.started_at) + timer.duration_seconds * 1000);
  const { error: notifyError } = await db.from("scheduled_notifications").insert({
    family_id: familyId,
    notification_type: "timer",
    scheduled_for: dueAt.toISOString(),
    title: timer.label ? `${timer.label} is ready` : "Timer finished",
    body: null,
    data: timer.label ? { label: timer.label } : null,
    related_entity_type: "timer",
    related_entity_id: timer.id,
  });
  if (notifyError) {
    console.error("[timers] could not schedule the push:", notifyError);
  }

  return { timer, error: null };
}

/**
 * Cancel the queued push for a timer.
 *
 * Without this, stopping a timer early leaves its notification queued and the
 * phone buzzes for something that no longer exists. `related_entity_type` and
 * `related_entity_id` are exactly the handle for it.
 */
export async function cancelScheduledPush(db: TimerDb, familyId: string, timerId: string) {
  const { error } = await db
    .from("scheduled_notifications")
    .delete()
    .eq("family_id", familyId)
    .eq("related_entity_type", "timer")
    .eq("related_entity_id", timerId);
  if (error) console.error("[timers] could not cancel the push:", error);
}

/**
 * Dismiss: the timer stops being shown, but the row stays. The caller has
 * already checked the timer belongs to `familyId`; the update is scoped by
 * family anyway.
 */
export async function dismissTimer(db: TimerDb, familyId: string, id: string) {
  await cancelScheduledPush(db, familyId, id);
  return db
    .from("timers")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("family_id", familyId)
    .select()
    .single();
}

/** Remove the row outright (the session route's DELETE). */
export async function deleteTimer(db: TimerDb, familyId: string, id: string) {
  await cancelScheduledPush(db, familyId, id);
  return db.from("timers").delete().eq("id", id).eq("family_id", familyId);
}

// ---------------------------------------------------------------------------
// The Integration API's side: input rules and the shape an assistant reads.
// ---------------------------------------------------------------------------

export interface TimerInput {
  label: string | null;
  duration_seconds: number;
}

/**
 * `duration_seconds` a whole number from 1 to 86400; `label` optional, at
 * most 60 characters once trimmed, empty meaning none. Stricter than the
 * session route, which rounds any positive number: an assistant sending
 * 90.5 seconds or a week has misunderstood something, and saying so beats
 * guessing.
 */
export function parseTimerInput(body: Record<string, unknown>): Result<TimerInput> {
  const duration = body.duration_seconds;
  if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 1 || duration > MAX_TIMER_SECONDS) {
    return { ok: false, error: `\`duration_seconds\` must be a whole number from 1 to ${MAX_TIMER_SECONDS}` };
  }
  let label: string | null = null;
  if (body.label !== undefined && body.label !== null) {
    if (typeof body.label !== "string") {
      return { ok: false, error: "`label` must be a string" };
    }
    label = body.label.trim() || null;
    if (label && label.length > MAX_TIMER_LABEL) {
      return { ok: false, error: `\`label\` may be at most ${MAX_TIMER_LABEL} characters` };
    }
  }
  return { ok: true, value: { label, duration_seconds: duration } };
}

export interface TimerView {
  id: string;
  label: string | null;
  duration_seconds: number;
  started_at: string;
  ends_at: string;
  remaining_seconds: number;
  /** `ringing`: the time is up and nobody has dismissed it yet. */
  state: "running" | "ringing";
}

type TimerRow = Pick<Timer, "id" | "label" | "duration_seconds" | "started_at" | "dismissed_at">;

export function timerView(row: TimerRow, now: Date): TimerView {
  const timer = row as Timer;
  return {
    id: row.id,
    label: row.label,
    duration_seconds: row.duration_seconds,
    started_at: row.started_at,
    ends_at: new Date(Date.parse(row.started_at) + row.duration_seconds * 1000).toISOString(),
    remaining_seconds: remainingSeconds(timer, now),
    state: timerState(timer, now) === "running" ? "running" : "ringing",
  };
}

/** The family's running and ringing timers, the one due soonest first. Throws on a database error. */
export async function readActiveTimers(familyId: string, now = new Date(), db: TimerDb = createAdminClient()): Promise<TimerView[]> {
  const { data, error } = await listActiveTimers(db, familyId);
  if (error) throw error;
  return ((data ?? []) as TimerRow[])
    .map((row) => timerView(row, now))
    .sort((a, b) => a.ends_at.localeCompare(b.ends_at));
}

export type StartOutcome =
  | { status: "started"; timer: TimerView }
  | { status: "too_many"; active: number };

/**
 * Start a timer for an assistant: refused once the family already has
 * MAX_ACTIVE_TIMERS not dismissed. Counted before the insert, so two calls
 * racing at 9 can both get through — a soft cap, which is all it needs to
 * be: it stops a runaway loop, not a determined caller. Throws on a
 * database error.
 */
export async function startTimerForAssistant(
  familyId: string,
  input: TimerInput,
  db: TimerDb = createAdminClient(),
): Promise<StartOutcome> {
  const active = await countActiveTimers(db, familyId);
  if (active >= MAX_ACTIVE_TIMERS) return { status: "too_many", active };
  const { timer, error } = await startTimer(db, familyId, input.label, input.duration_seconds);
  if (error || !timer) throw error ?? new Error("could not start the timer");
  return { status: "started", timer: timerView(timer, new Date()) };
}

/**
 * Stop a timer for an assistant — the same dismiss as the panel's ✕.
 * `false` when there is no such timer in this family, or it is already
 * dismissed (it is no longer on any screen, so there is nothing to stop).
 * Throws on a database error.
 */
export async function stopTimerForAssistant(
  familyId: string,
  id: string,
  db: TimerDb = createAdminClient(),
): Promise<boolean> {
  const { data: existing, error: selectError } = await db
    .from("timers")
    .select("id")
    .eq("id", id)
    .eq("family_id", familyId)
    .is("dismissed_at", null)
    .maybeSingle();
  if (selectError) throw selectError;
  if (!existing) return false;
  const { error } = await dismissTimer(db, familyId, id);
  if (error) throw error;
  return true;
}
