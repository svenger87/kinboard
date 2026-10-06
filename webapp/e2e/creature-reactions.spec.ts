import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import {
  detectTaskTick,
  enqueueReaction,
  REACTION_DEDUPE_MS,
  REACTION_QUEUE_MAX,
  seenRecently,
  stageUpFor,
  type CreatureReaction,
  type TickRow,
} from "../src/lib/pocket-money/creature-reactions";
import {
  publishCreatureReaction,
  reactToTaskChange,
  resetCreatureReactions,
  useCreatureReactions,
} from "../src/stores/creature-reactions";
import { ReactingCreature } from "../src/components/pocket-money/creature-reaction";

/**
 * Live creature reactions (RFC-016): which changes to a task make a child's
 * creature cheer, the stage a tick reaches, the queue, and the dedupe that
 * keeps the ticking screen from cheering twice. Pure functions and the store,
 * no browser; creature-reactions-live.spec.ts is the rendered half.
 */

const KID = "00000000-0000-4000-8000-0000000000a1";
const SIB = "00000000-0000-4000-8000-0000000000a2";
const PARENT = "00000000-0000-4000-8000-0000000000b1";
const isChild = (id: string) => id === KID || id === SIB;

const once = (over: Partial<TickRow> = {}): TickRow => ({
  id: "t-once", recurrence: "once", person_id: KID, completed: false, points: 5, ...over,
});
const daily = (over: Partial<TickRow> = {}): TickRow => ({
  id: "t-daily", recurrence: "daily", person_id: KID, completed: false, points: 3,
  last_completed: "2026-10-05T07:00:00Z", last_completed_day: "2026-10-05", ...over,
});
// Turns between the two children from 2026-10-01: day k is rotation[k % 2].
const turns = (over: Partial<TickRow> = {}): TickRow => ({
  id: "t-turns", recurrence: "daily", person_id: null, completed: false, points: 2,
  rotation_person_ids: [KID, SIB], rotation_offset: 0, schedule_start_day: "2026-10-01",
  last_completed: "2026-10-05T07:00:00Z", last_completed_day: "2026-10-05", ...over,
});

test.describe("what counts as a tick", () => {
  test("a one-off task ticked off: its child, key once, its points", () => {
    expect(detectTaskTick(once(), once({ completed: true }), isChild))
      .toEqual({ todoId: "t-once", personId: KID, completionKey: "once", points: 5 });
  });

  test("a repeating task done for a newer day", () => {
    expect(detectTaskTick(daily(), daily({ last_completed: "2026-10-06T08:00:00Z", last_completed_day: "2026-10-06" }), isChild))
      .toEqual({ todoId: "t-daily", personId: KID, completionKey: "2026-10-06", points: 3 });
    // Never done before.
    expect(detectTaskTick(daily({ last_completed: null, last_completed_day: null }), daily({ last_completed_day: "2026-10-06" }), isChild))
      ?.toMatchObject({ completionKey: "2026-10-06" });
    // An older row with only the timestamp.
    expect(detectTaskTick(daily({ last_completed_day: null }), daily({ last_completed_day: null, last_completed: "2026-10-06T08:00:00Z" }), isChild))
      ?.toMatchObject({ completionKey: "2026-10-06" });
  });

  test("a task taking turns: the child whose turn the ticked day was", () => {
    // 2026-10-06 is day 5 of the schedule: rotation[5 % 2], the sibling.
    expect(detectTaskTick(turns(), turns({ last_completed_day: "2026-10-06" }), isChild))
      .toEqual({ todoId: "t-turns", personId: SIB, completionKey: "2026-10-06", points: 2 });
    expect(detectTaskTick(turns({ last_completed_day: "2026-10-04" }), turns({ last_completed_day: "2026-10-05" }), isChild))
      ?.toMatchObject({ personId: KID });
  });

  test("a task worth nothing still cheers, with 0 points", () => {
    expect(detectTaskTick(once({ points: 0 }), once({ points: 0, completed: true }), isChild))?.toMatchObject({ points: 0 });
  });

  test("an un-tick never cheers", () => {
    expect(detectTaskTick(once({ completed: true }), once({ completed: false }), isChild)).toBeNull();
    // A turn taken back: the done day moves back to the previous one, or is cleared.
    expect(detectTaskTick(turns({ last_completed_day: "2026-10-06" }), turns({ last_completed_day: "2026-10-05" }), isChild)).toBeNull();
    expect(detectTaskTick(turns(), turns({ last_completed: null, last_completed_day: null }), isChild)).toBeNull();
  });

  test("an edit never cheers", () => {
    expect(detectTaskTick(once(), once({ title: "renamed", points: 50 } as Partial<TickRow>), isChild)).toBeNull();
    // A done one-off task edited: still done, not newly so.
    expect(detectTaskTick(once({ completed: true }), once({ completed: true, points: 9 }), isChild)).toBeNull();
    // A repeating task edited on a day it was already done, or ticked twice that day.
    expect(detectTaskTick(daily(), daily({ points: 7 }), isChild)).toBeNull();
    expect(detectTaskTick(daily(), daily({ last_completed: "2026-10-05T19:00:00Z" }), isChild)).toBeNull();
  });

  test("the initial load, a new task, a task the screen never had: no before, no cheer", () => {
    expect(detectTaskTick(undefined, once({ completed: true }), isChild)).toBeNull();
    expect(detectTaskTick(null, daily({ last_completed_day: "2026-10-06" }), isChild)).toBeNull();
    expect(detectTaskTick(once({ id: "other" }), once({ completed: true }), isChild)).toBeNull();
  });

  test("only a child's task: a parent's, or nobody's, does not cheer", () => {
    expect(detectTaskTick(once({ person_id: PARENT }), once({ person_id: PARENT, completed: true }), isChild)).toBeNull();
    expect(detectTaskTick(once({ person_id: null }), once({ person_id: null, completed: true }), isChild)).toBeNull();
    // Turns where the ticked day is the parent's.
    const withParent = { rotation_person_ids: [KID, PARENT] };
    expect(detectTaskTick(turns(withParent), turns({ ...withParent, last_completed_day: "2026-10-06" }), isChild)).toBeNull();
  });
});

test.describe("a stage reached by a tick", () => {
  const points = { mode: "points", storedBestTier: 1 };
  test("crossing a threshold in points mode", () => {
    expect(stageUpFor(points, 45, 5)).toEqual({ from: 1, to: 2 });
    expect(stageUpFor(points, 140, 20)).toEqual({ from: 2, to: 3 });
    // Two stages at once.
    expect(stageUpFor(points, 45, 260)).toEqual({ from: 1, to: 4 });
  });
  test("not crossing, money mode, unknown points, no points, or below best_tier", () => {
    expect(stageUpFor(points, 40, 5)).toBeNull();
    expect(stageUpFor(points, 50, 5)).toBeNull();
    expect(stageUpFor({ mode: "money", storedBestTier: 1 }, 45, 5)).toBeNull();
    expect(stageUpFor(points, null, 5)).toBeNull();
    expect(stageUpFor(null, 45, 5)).toBeNull();
    expect(stageUpFor(points, 45, 0)).toBeNull();
    // Stage 3 kept from money mode: 50 points shows stage 3 already.
    expect(stageUpFor({ mode: "points", storedBestTier: 3 }, 45, 5)).toBeNull();
  });
});

const reaction = (points: number, over: Partial<CreatureReaction> = {}): CreatureReaction => ({
  id: points, personId: KID, points, ticks: 1, earnedBefore: null, stage: null, stageUp: null, ...over,
});

test.describe("ticks in quick succession", () => {
  test("three wait in turn; the rest fold into one +total", () => {
    let q: CreatureReaction[] = [];
    for (const p of [1, 2, 3, 4, 5]) q = enqueueReaction(q, reaction(p));
    expect(q).toHaveLength(REACTION_QUEUE_MAX);
    expect(q.map((r) => r.points)).toEqual([1, 2, 3 + 4 + 5]);
    expect(q[2].ticks).toBe(3);
  });
  test("a folded reaction's stage-up is the one its points make together", () => {
    const stage = { mode: "points", storedBestTier: 1 };
    const q = enqueueReaction(
      [reaction(1), reaction(2), reaction(20, { earnedBefore: 30, stage })],
      reaction(20, { earnedBefore: 50, stage }),
    );
    expect(q[2].stageUp).toEqual({ from: 1, to: 2 });
  });
  test("the same tick within a few seconds is seen once", () => {
    const seen = new Map<string, number>();
    const tick = { todoId: "t", completionKey: "once" };
    expect(seenRecently(seen, tick, 1_000)).toBe(false);
    expect(seenRecently(seen, tick, 2_000)).toBe(true);
    expect(seenRecently(seen, { todoId: "t", completionKey: "2026-10-06" }, 2_000)).toBe(false);
    expect(seenRecently(seen, tick, 1_000 + REACTION_DEDUPE_MS + 1)).toBe(false);
  });
});

test.describe("the store", () => {
  const doc = { visibilityState: "visible", documentElement: { hasAttribute: (n: string) => n === "data-screensaver" && screensaver } };
  let screensaver = false;
  test.beforeEach(() => {
    (globalThis as { document?: unknown }).document = doc;
    doc.visibilityState = "visible";
    screensaver = false;
    resetCreatureReactions();
  });
  test.afterEach(() => {
    resetCreatureReactions();
    delete (globalThis as { document?: unknown }).document;
  });

  const familyId = "fam";
  function client() {
    const qc = new QueryClient();
    qc.setQueryData(["people", familyId], [{ id: KID, is_child: true }, { id: PARENT, is_child: false }]);
    qc.setQueryData(["todo-point-awards", familyId], [{ person_id: KID, points: 45 }, { person_id: SIB, points: 99 }]);
    qc.setQueryData(["pocket-money-accounts", familyId], [{ person_id: KID, reward_mode: "points", best_tier: 1 }]);
    return qc;
  }

  test("the ticking screen's own echo does not cheer again, in either order", () => {
    const qc = client();
    const before = once();
    const after = once({ completed: true });
    // Mutation success, then the realtime echo compared with a cache not yet refetched.
    expect(reactToTaskChange(qc, familyId, before, after)).toBe(true);
    expect(reactToTaskChange(qc, familyId, before, after)).toBe(false);
    // Echo first, then the mutation.
    const d1 = daily(), d2 = daily({ last_completed_day: "2026-10-06" });
    expect(reactToTaskChange(qc, familyId, d1, d2)).toBe(true);
    expect(reactToTaskChange(qc, familyId, d1, d2)).toBe(false);
  });

  test("a tick plays at once with its points and stage-up; the next one waits", () => {
    const qc = client();
    expect(reactToTaskChange(qc, familyId, once(), once({ completed: true }))).toBe(true);
    const playing = useCreatureReactions.getState().current[KID];
    expect(playing).toMatchObject({ points: 5, earnedBefore: 45, stageUp: { from: 1, to: 2 } });
    reactToTaskChange(qc, familyId, daily(), daily({ last_completed_day: "2026-10-06" }));
    // Started where the first left off (50), though the cache still says 45.
    expect(useCreatureReactions.getState().queues[KID]).toEqual([
      expect.objectContaining({ points: 3, earnedBefore: 50, stageUp: null }),
    ]);
  });

  test("an un-tick or an edit publishes nothing", () => {
    const qc = client();
    expect(reactToTaskChange(qc, familyId, once({ completed: true }), once())).toBe(false);
    expect(reactToTaskChange(qc, familyId, once(), once({ points: 9 }))).toBe(false);
    expect(useCreatureReactions.getState().current[KID]).toBeUndefined();
  });

  test("a hidden page, or the screensaver: nothing plays", () => {
    doc.visibilityState = "hidden";
    expect(publishCreatureReaction({ todoId: "a", personId: KID, completionKey: "once", points: 1, earnedBefore: null, stage: null })).toBe(false);
    doc.visibilityState = "visible";
    screensaver = true;
    expect(publishCreatureReaction({ todoId: "b", personId: KID, completionKey: "once", points: 1, earnedBefore: null, stage: null })).toBe(false);
    expect(useCreatureReactions.getState().current[KID]).toBeUndefined();
  });

  test("different children react independently", () => {
    publishCreatureReaction({ todoId: "a", personId: KID, completionKey: "once", points: 1, earnedBefore: null, stage: null });
    publishCreatureReaction({ todoId: "b", personId: SIB, completionKey: "once", points: 2, earnedBefore: null, stage: null });
    const { current, queues } = useCreatureReactions.getState();
    expect(current[KID]?.points).toBe(1);
    expect(current[SIB]?.points).toBe(2);
    expect(queues[KID] ?? []).toEqual([]);
  });
});

test.describe("the wall display stays idle", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

  test("the widget's creature is static outside a reaction", () => {
    const widget = read("src/components/widgets/pocket-money-widget.tsx");
    expect(widget).toContain("<ReactingCreature");
    expect(widget).toMatch(/<ReactingCreature[^>]*animated=\{false\}/);
    expect(widget).not.toMatch(/animated=\{true\}|animated\s*\n/);
    // Rendered with no reaction playing: no idle motion.
    const html = renderToStaticMarkup(
      createElement(ReactingCreature, { personId: KID, species: "dragon", tier: 4, style: "gumdrop", size: 56, animated: false, compactStageUp: true }),
    );
    expect(html).toContain('data-avatar-style="gumdrop"');
    expect(html).not.toContain("creature-animated");
    expect(html).not.toContain("creature-reaction-label");
    // The page's own avatar does breathe.
    const page = renderToStaticMarkup(createElement(ReactingCreature, { personId: KID, species: "dragon", tier: 4, style: "gumdrop" }));
    expect(page).toContain("creature-animated");
  });

  test("no endless animation outside .creature-animated", () => {
    const css = read("src/app/globals.css");
    const block = css.slice(css.indexOf("/* ── Drawn pocket-money avatars"), css.indexOf("/* Settings search"));
    const endless = block.split("\n").filter((line) => /\binfinite\b/.test(line));
    expect(endless.length).toBeGreaterThan(0);
    for (const line of endless) expect(line.trim(), line).toMatch(/^\.creature-animated /);
    // The label is a one-shot.
    expect(block).toMatch(/\.creature-reaction-label \{[^}]*forwards/);
  });
});
