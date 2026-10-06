import { create } from "zustand";
import type { QueryClient } from "@tanstack/react-query";
import {
  detectTaskTick,
  enqueueReaction,
  reactionDuration,
  seenRecently,
  stageUpFor,
  type CreatureReaction,
  type StageContext,
  type TickRow,
} from "@/lib/pocket-money/creature-reactions";

/**
 * The one place live creature reactions go through (RFC-016, live reactions).
 *
 * Two sources publish: the realtime handler (a tick on any other screen) and
 * the completion mutation (a tick on this one, which reacts straight away and
 * not again when its own echo arrives). Avatars subscribe by the child's
 * person id with useCreatureReaction. The rules -- what is a tick, the
 * stage-up, the queue -- are lib/pocket-money/creature-reactions.ts.
 *
 * Each child has one reaction playing and up to three waiting; the store
 * plays them in turn on its own clock, so two avatars of the same child (the
 * page and the profile dialog) play the same reaction rather than each
 * consuming the queue.
 */

interface CreatureReactionsState {
  /** The reaction playing for each child, by person id. */
  current: Record<string, CreatureReaction | undefined>;
  /** Those waiting behind it. */
  queues: Record<string, CreatureReaction[] | undefined>;
}

export const useCreatureReactions = create<CreatureReactionsState>(() => ({
  current: {},
  queues: {},
}));

const seen = new Map<string, number>();
/** The earned points a child's last reaction left them at, for ticks faster than the refetch. */
const running = new Map<string, { earned: number; at: number }>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let nextId = 1;

/**
 * Nothing plays on a hidden page (it would all be waiting when the tab comes
 * back) or under the screensaver, which a reaction must neither wake nor be
 * shown on. providers.tsx marks the screensaver on <html>.
 */
function quiet(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "hidden" || document.documentElement.hasAttribute("data-screensaver");
}

function play(personId: string, reaction: CreatureReaction | undefined) {
  clearTimeout(timers.get(personId));
  timers.delete(personId);
  useCreatureReactions.setState((s) => ({ current: { ...s.current, [personId]: reaction } }));
  if (!reaction) return;
  timers.set(
    personId,
    setTimeout(() => {
      // The page went hidden or the screensaver came on meanwhile: the rest
      // is dropped, not saved up for later.
      const [next, ...rest] = quiet() ? [] : useCreatureReactions.getState().queues[personId] ?? [];
      useCreatureReactions.setState((s) => ({ queues: { ...s.queues, [personId]: rest } }));
      play(personId, next);
    }, reactionDuration(reaction)),
  );
}

export interface PublishInput {
  todoId: string;
  personId: string;
  completionKey: string;
  points: number;
  /** The child's earned points before this tick, from the screen's cache; null when not loaded. */
  earnedBefore: number | null;
  stage: StageContext | null;
}

/**
 * A tick for a child's creature. False when it was not played: the same tick
 * seen moments ago, or a page nobody is looking at.
 */
export function publishCreatureReaction(input: PublishInput, now = Date.now()): boolean {
  if (seenRecently(seen, input, now)) return false;
  if (quiet()) return false;

  // Two ticks faster than the points refetch both read the same cached total;
  // the second starts where the first left off.
  const last = running.get(input.personId);
  let earnedBefore = input.earnedBefore;
  if (last && now - last.at < 15_000) earnedBefore = Math.max(earnedBefore ?? 0, last.earned);
  if (earnedBefore !== null) running.set(input.personId, { earned: earnedBefore + input.points, at: now });

  const reaction: CreatureReaction = {
    id: nextId++,
    personId: input.personId,
    points: input.points,
    ticks: 1,
    earnedBefore,
    stage: input.stage,
    stageUp: stageUpFor(input.stage, earnedBefore, input.points),
  };
  const state = useCreatureReactions.getState();
  if (!state.current[input.personId]) {
    play(input.personId, reaction);
  } else {
    useCreatureReactions.setState((s) => ({
      queues: { ...s.queues, [input.personId]: enqueueReaction(s.queues[input.personId] ?? [], reaction) },
    }));
  }
  return true;
}

// The query keys of the caches read below. Spelled out rather than imported:
// use-supabase-queries imports this file (the completion mutation), so
// importing its queryKeys back would make a cycle.
const PEOPLE_KEY = (familyId: string) => ["people", familyId];
const AWARDS_KEY = (familyId: string) => ["todo-point-awards", familyId];
const ACCOUNTS_KEY = (familyId: string) => ["pocket-money-accounts", familyId];

interface PersonLike { id: string; is_child?: boolean | null }
interface AwardLike { person_id: string; points: number }
interface AccountLike { person_id: string; reward_mode?: string | null; best_tier?: number | null }

/**
 * Compare the task as this screen had it with the row that just arrived, and
 * cheer if it is a child's tick. Read before the caches are invalidated, so
 * the points are still the ones from before the tick.
 */
export function reactToTaskChange(
  queryClient: QueryClient,
  familyId: string,
  prev: TickRow | null | undefined,
  next: TickRow | null | undefined,
): boolean {
  const people = queryClient.getQueryData<PersonLike[]>(PEOPLE_KEY(familyId));
  if (!people) return false;
  const tick = detectTaskTick(prev, next, (id) => people.some((p) => p.id === id && p.is_child));
  if (!tick) return false;

  const awards = queryClient.getQueryData<AwardLike[]>(AWARDS_KEY(familyId));
  const earnedBefore = awards
    ? awards.reduce((sum, a) => (a.person_id === tick.personId ? sum + a.points : sum), 0)
    : null;
  const account = queryClient
    .getQueryData<AccountLike[]>(ACCOUNTS_KEY(familyId))
    ?.find((a) => a.person_id === tick.personId);
  const stage = account ? { mode: account.reward_mode, storedBestTier: account.best_tier } : null;
  return publishCreatureReaction({ ...tick, earnedBefore, stage });
}

/** The reaction playing for this child, if any. */
export function useCreatureReaction(personId: string | null | undefined): CreatureReaction | undefined {
  return useCreatureReactions((s) => (personId ? s.current[personId] : undefined));
}

/** For tests: forget every reaction, key and timer. */
export function resetCreatureReactions() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  seen.clear();
  running.clear();
  useCreatureReactions.setState({ current: {}, queues: {} });
}
