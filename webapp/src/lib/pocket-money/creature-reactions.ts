/**
 * Live creature reactions (RFC-016, the "live reactions" follow-up): when a
 * child's task is ticked off on any screen, that child's creature cheers on
 * every screen showing it.
 *
 * This file is the rules, with no React and no store: which change to a task
 * row is a tick worth cheering for, whose creature cheers, whether the points
 * carry it into a new stage, and how a burst of ticks queues up. The store in
 * stores/creature-reactions.ts feeds it from the two places a tick is seen --
 * the realtime handler and the completion mutation -- and the avatars play
 * what it decides.
 *
 * How a tick is recognised: the screen compares the task as its cache last
 * showed it with the row that just arrived. Supabase realtime cannot tell us
 * the old row itself -- with RLS on, `payload.old` carries only the primary
 * key, whatever the table's REPLICA IDENTITY -- and the cache is in any case
 * the honest "before" for a screen: it is what that screen was showing. A
 * screen that never had the task (a fresh load, a task created elsewhere)
 * has no before, so it never cheers for it.
 *
 * The rules mirror the points trigger (record_todo_points in
 * docker/migration_zzzzzy_todo_turns.sql) so a creature cheers for exactly the
 * changes that would earn points, except that a task worth 0 points still
 * gets hearts.
 */

import { turnPerson, type TurnFields } from "@/lib/todo-turns";
import { avatarStage } from "./points";
import type { AvatarTier, RewardMode } from "./types";

/** The task fields a tick is read from. A `Todo` row is one. */
export interface TickRow extends TurnFields {
  id: string;
  completed?: boolean | null;
  last_completed?: string | null;
  points?: number | null;
}

export interface TaskTick {
  todoId: string;
  /** The child whose creature cheers. */
  personId: string;
  /** "once" for a one-off task, else the day it was ticked for. */
  completionKey: string;
  points: number;
}

/** The day a repeating task was last done: `last_completed_day`, or the day of `last_completed` on older rows. */
function doneDay(row: TickRow): string | null {
  if (row.last_completed_day) return row.last_completed_day.slice(0, 10);
  if (row.last_completed) return row.last_completed.slice(0, 10);
  return null;
}

/**
 * The tick, if `next` is `prev` changed from not done to done and the task
 * is a child's. Never for an un-tick, an edit, a new task, or a task the
 * screen had no earlier copy of.
 *
 * - One-off: `completed` goes from false to true.
 * - Repeating, rotating or tracked: the done day moves forward. An un-tick
 *   moves it back (or clears it), a second tick on a day already done leaves
 *   it where it was; neither is a tick. A rotating task's child is whoever's
 *   turn that day was.
 */
export function detectTaskTick(
  prev: TickRow | null | undefined,
  next: TickRow | null | undefined,
  isChild: (personId: string) => boolean,
): TaskTick | null {
  if (!prev || !next || prev.id !== next.id) return null;

  let completionKey: string | null = null;
  let personId = next.person_id ?? null;

  if ((next.recurrence ?? "once") === "once") {
    if (next.completed && !prev.completed) completionKey = "once";
  } else {
    const before = doneDay(prev);
    const after = doneDay(next);
    if (after && (!before || after > before)) {
      completionKey = after;
      if (next.schedule_start_day || next.carry_day) personId = turnPerson(next, after);
    }
  }

  if (!completionKey || !personId || !isChild(personId)) return null;
  return { todoId: next.id, personId, completionKey, points: Math.max(0, next.points ?? 0) };
}

/** What a stage-up needs to know about the child's account. */
export interface StageContext {
  mode: RewardMode | string | null | undefined;
  storedBestTier: number | null | undefined;
}

export interface StageUp {
  from: AvatarTier;
  to: AvatarTier;
}

/**
 * The stages a tick carries the creature between, or null. Only points mode
 * grows with tasks (money mode follows the balance), and the stage is the one
 * avatarStage shows: the earned points', never below best_tier.
 */
export function stageUpFor(stage: StageContext | null, earnedBefore: number | null, points: number): StageUp | null {
  if (!stage || stage.mode !== "points" || earnedBefore === null || points <= 0) return null;
  const at = (earnedPoints: number) =>
    avatarStage({ mode: "points", balanceCents: 0, earnedPoints, storedBestTier: stage.storedBestTier }).tier;
  const from = at(earnedBefore);
  const to = at(earnedBefore + points);
  return to > from ? { from, to } : null;
}

export interface CreatureReaction {
  /** Unique per reaction played, so an avatar knows a new one from the same one. */
  id: number;
  personId: string;
  /** Points to show; 0 shows hearts. A collapsed reaction carries the sum. */
  points: number;
  /** How many ticks this reaction stands for (more than one once collapsed). */
  ticks: number;
  /** The child's earned points before the first of them, when known. */
  earnedBefore: number | null;
  stage: StageContext | null;
  stageUp: StageUp | null;
}

/** At most this many wait behind the one playing; the rest fold into the last. */
export const REACTION_QUEUE_MAX = 3;

/** Two reactions as one "+total": the stage-up is the one their points make together. */
export function mergeReactions(a: CreatureReaction, b: CreatureReaction): CreatureReaction {
  const points = a.points + b.points;
  const earnedBefore = a.earnedBefore ?? b.earnedBefore;
  const stage = a.stage ?? b.stage;
  return { ...a, points, ticks: a.ticks + b.ticks, earnedBefore, stage, stageUp: stageUpFor(stage, earnedBefore, points) };
}

/** A new reaction behind the ones waiting: queued while there is room, else folded into the last. */
export function enqueueReaction(queue: readonly CreatureReaction[], reaction: CreatureReaction): CreatureReaction[] {
  if (queue.length < REACTION_QUEUE_MAX) return [...queue, reaction];
  return [...queue.slice(0, -1), mergeReactions(queue[queue.length - 1], reaction)];
}

/** How long a tick and its echo count as the same one. */
export const REACTION_DEDUPE_MS = 8_000;

/**
 * True when this task's tick for this completion was seen in the last few
 * seconds. The ticking screen reacts when its own mutation succeeds and then
 * gets the same change back over realtime -- in either order -- and a
 * trigger's follow-up update can echo it once more. Records the key, and
 * forgets old ones.
 */
export function seenRecently(seen: Map<string, number>, tick: Pick<TaskTick, "todoId" | "completionKey">, now: number): boolean {
  for (const [k, at] of seen) if (now - at > REACTION_DEDUPE_MS) seen.delete(k);
  const key = `${tick.todoId}:${tick.completionKey}`;
  if (seen.has(key)) return true;
  seen.set(key, now);
  return false;
}

/** How long one reaction plays: the hop and its label, or a stage-up's compact hatching. */
export function reactionDuration(reaction: Pick<CreatureReaction, "stageUp">): number {
  return reaction.stageUp ? 2_800 : 1_600;
}
