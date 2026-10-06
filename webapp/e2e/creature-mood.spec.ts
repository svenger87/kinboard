import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AWAKE_FROM_MINUTE,
  childDayTasks,
  creatureMood,
  isSleepyTime,
  SLEEPY_FROM_MINUTE,
  wallMinutes,
  type MoodTask,
} from "../src/lib/creature-mood";
import { CreatureAvatar } from "../src/components/pocket-money/creature-avatar";
import { currentMinute, MINUTE_MS, subscribeMinuteClock } from "../src/lib/minute-clock";

/**
 * A creature's mood (RFC-016 §2, lib/creature-mood.ts): sleepy from 20:00 to
 * 06:30 in the family's time zone, happy once the child's tasks for today are
 * all done (at least one), and otherwise normal -- never sad. Then the
 * drawing: what each mood looks like, and that the screens wear it.
 *
 * Pure functions and static markup, no browser and no stack.
 */

const KID = "00000000-0000-4000-8000-0000000000a1";
const SIB = "00000000-0000-4000-8000-0000000000a2";
const BERLIN = "Europe/Berlin";

/** 2026-10-06 (CEST, UTC+2) at hh:mm Berlin time. */
const berlin = (hh: number, mm = 0, day = 6) => new Date(Date.UTC(2026, 9, day, hh - 2, mm));
/** Noon in Berlin on 2026-10-06: awake. */
const NOON = berlin(12);
const TODAY = "2026-10-06";

const daily = (over: Partial<MoodTask> = {}): MoodTask => ({
  recurrence: "daily", person_id: KID, completed: false, last_completed: null, last_completed_day: null, created_at: "2026-09-01T08:00:00Z", ...over,
});
const once = (over: Partial<MoodTask> = {}): MoodTask => ({
  recurrence: "once", person_id: KID, completed: false, due_date: null, updated_at: "2026-09-01T08:00:00Z", ...over,
});
/** Ticked off at 08:00 Berlin today. */
const doneToday = { last_completed: "2026-10-06T06:00:00Z", last_completed_day: TODAY };
const mood = (tasks: MoodTask[], now = NOON, timeZone: string | null = BERLIN, personId = KID) =>
  creatureMood({ personId, tasks, now, timeZone });

test.describe("sleepy: 20:00 to 06:30 in the family's time zone", () => {
  test("the boundaries, to the minute", () => {
    expect(SLEEPY_FROM_MINUTE).toBe(20 * 60);
    expect(AWAKE_FROM_MINUTE).toBe(6 * 60 + 30);
    expect(isSleepyTime(berlin(19, 59), BERLIN)).toBe(false);
    expect(isSleepyTime(berlin(20, 0), BERLIN)).toBe(true);
    expect(isSleepyTime(berlin(23, 59), BERLIN)).toBe(true);
    expect(isSleepyTime(berlin(0, 0, 7), BERLIN)).toBe(true);
    expect(isSleepyTime(berlin(6, 29, 7), BERLIN)).toBe(true);
    expect(isSleepyTime(berlin(6, 30, 7), BERLIN)).toBe(false);
    expect(isSleepyTime(berlin(12), BERLIN)).toBe(false);
  });

  test("the family's zone decides, not the instant's UTC hour", () => {
    // 19:00 UTC: 21:00 in Berlin, 15:00 in New York, 04:00 next day in Tokyo.
    const t = new Date(Date.UTC(2026, 9, 6, 19, 0));
    expect(isSleepyTime(t, "Europe/Berlin")).toBe(true);
    expect(isSleepyTime(t, "America/New_York")).toBe(false);
    expect(isSleepyTime(t, "Asia/Tokyo")).toBe(true);
    expect(isSleepyTime(t, "UTC")).toBe(false);
    expect(wallMinutes(t, "Asia/Kolkata")).toBe(30); // 00:30, a half-hour zone
  });

  test("across a DST change the wall clock still decides", () => {
    // 2026-10-25, Berlin back to CET (UTC+1): 19:30 UTC is 20:30 there.
    expect(isSleepyTime(new Date(Date.UTC(2026, 9, 25, 19, 30)), BERLIN)).toBe(true);
    expect(isSleepyTime(new Date(Date.UTC(2026, 9, 25, 18, 30)), BERLIN)).toBe(false);
    // 2026-03-29, to CEST (UTC+2): 04:30 UTC is 06:30.
    expect(isSleepyTime(new Date(Date.UTC(2026, 2, 29, 4, 29)), BERLIN)).toBe(true);
    expect(isSleepyTime(new Date(Date.UTC(2026, 2, 29, 4, 30)), BERLIN)).toBe(false);
  });

  test("an unknown zone falls back to the runtime's own instead of throwing", () => {
    expect(() => isSleepyTime(NOON, "Not/AZone")).not.toThrow();
    expect(wallMinutes(NOON, "Not/AZone")).toBe(wallMinutes(NOON, null));
  });

  test("night wins over a finished day, and over an unfinished one", () => {
    expect(mood([daily(doneToday)], berlin(20, 15))).toBe("sleepy");
    expect(mood([daily()], berlin(21))).toBe("sleepy");
    expect(mood([], berlin(5))).toBe("sleepy");
  });
});

test.describe("happy: every one of today's tasks done", () => {
  test("no tasks is a normal day, not a happy one", () => {
    expect(mood([])).toBe("normal");
    expect(mood([daily({ person_id: SIB, ...doneToday })])).toBe("normal");
  });

  test("one repeating task: open is normal, done today is happy", () => {
    expect(mood([daily()])).toBe("normal");
    expect(mood([daily(doneToday)])).toBe("happy");
    // done yesterday: it has come round again
    expect(mood([daily({ last_completed: "2026-10-05T06:00:00Z", last_completed_day: "2026-10-05" })])).toBe("normal");
  });

  test("all of them, not some", () => {
    expect(mood([daily(doneToday), daily()])).toBe("normal");
    expect(mood([daily(doneToday), once()])).toBe("normal");
    expect(mood([daily(doneToday), once({ completed: true, updated_at: "2026-10-06T07:00:00Z" })])).toBe("happy");
  });

  test("only the child's own tasks count", () => {
    // a sibling's open task does not spoil it; a parent's neither
    expect(mood([daily(doneToday), daily({ person_id: SIB })])).toBe("happy");
    expect(mood([daily(doneToday), daily({ person_id: null })])).toBe("happy");
    // and the sibling is not made happy by this child's work
    expect(mood([daily(doneToday)], NOON, BERLIN, SIB)).toBe("normal");
  });

  test("one-offs: ticked today counts, ticked last week is not today's, a later due date is not today's", () => {
    expect(mood([once({ completed: true, updated_at: "2026-10-06T07:00:00Z" })])).toBe("happy");
    expect(mood([once({ completed: true, updated_at: "2026-09-29T07:00:00Z" })])).toBe("normal");
    expect(mood([once({ completed: true, due_date: TODAY, updated_at: "2026-10-05T07:00:00Z" })])).toBe("happy");
    expect(mood([daily(doneToday), once({ due_date: "2026-10-09" })])).toBe("happy");
    // no date, or overdue: still to do
    expect(mood([daily(doneToday), once({ due_date: null })])).toBe("normal");
    expect(mood([daily(doneToday), once({ due_date: "2026-10-01" })])).toBe("normal");
    expect(mood([daily(doneToday), once({ due_date: TODAY })])).toBe("normal");
  });

  test("a weekly task done days ago is neither open nor today's", () => {
    const weekly = daily({ recurrence: "weekly", last_completed: "2026-10-03T08:00:00Z", last_completed_day: "2026-10-03" });
    expect(childDayTasks(KID, [weekly], NOON, BERLIN)).toEqual({ open: 0, done: 0 });
    expect(mood([weekly])).toBe("normal");
    expect(mood([weekly, daily(doneToday)])).toBe("happy");
  });

  test("today is the family's: a tick at 00:30 Berlin is today there and yesterday in UTC", () => {
    // 2026-10-05T22:30Z is 00:30 on the 6th in Berlin.
    const late = daily({ last_completed: "2026-10-05T22:30:00Z", last_completed_day: null });
    expect(mood([late], NOON, BERLIN)).toBe("happy");
    expect(mood([late], new Date(Date.UTC(2026, 9, 6, 12)), "UTC")).toBe("normal");
  });

  test("a tick's day is read in the family's zone, not this device's", () => {
    // Whatever zone this runs in (Berlin here, UTC in CI), one of these two
    // ticks falls on a different day there than in the family's.
    // Los Angeles: 16:00 on the 6th is 23:00Z (01:00 on the 7th in Berlin).
    const la = daily({ last_completed: "2026-10-06T23:00:00Z", last_completed_day: null });
    expect(mood([la], new Date("2026-10-07T00:00:00Z"), "America/Los_Angeles")).toBe("happy");
    // Tokyo: 06:40 on the 7th is 21:40Z on the 6th (23:40 on the 6th in Berlin).
    const tokyo = daily({ last_completed: "2026-10-06T21:40:00Z", last_completed_day: null });
    expect(mood([tokyo], new Date("2026-10-07T03:00:00Z"), "Asia/Tokyo")).toBe("happy");
  });
});

test.describe("taking turns: only the child's turn counts", () => {
  // Daily, rotating KID, SIB, KID, ... from 2026-10-01: the 6th is day 5, SIB's;
  // the 7th is day 6, KID's.
  const turns = (over: Partial<MoodTask> = {}): MoodTask =>
    daily({ rotation_person_ids: [KID, SIB], schedule_start_day: "2026-10-01", rotation_offset: 0, person_id: KID, ...over });
  const day7 = new Date(Date.UTC(2026, 9, 7, 10)); // 12:00 Berlin on the 7th

  test("the sibling's turn today is not the child's task", () => {
    expect(childDayTasks(KID, [turns()], NOON, BERLIN)).toEqual({ open: 0, done: 0 });
    expect(childDayTasks(SIB, [turns()], NOON, BERLIN)).toEqual({ open: 1, done: 0 });
    expect(mood([turns(), daily(doneToday)])).toBe("happy");
    expect(mood([turns(), daily(doneToday)], NOON, BERLIN, SIB)).toBe("normal");
  });

  test("the child's turn: open is normal, done is happy", () => {
    expect(mood([turns()], day7)).toBe("normal");
    expect(mood([turns({ last_completed: "2026-10-07T06:00:00Z", last_completed_day: "2026-10-07" })], day7)).toBe("happy");
  });
});

test.describe("the minute clock", () => {
  test("one interval for every creature, ticking each minute, gone with the last", () => {
    const real = { set: globalThis.setInterval, clear: globalThis.clearInterval };
    const started: Array<{ fn: () => void; ms: number }> = [];
    let cleared = 0;
    globalThis.setInterval = ((fn: () => void, ms: number) => {
      started.push({ fn, ms });
      return started.length as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
    globalThis.clearInterval = (() => {
      cleared++;
    }) as typeof clearInterval;
    try {
      let a = 0;
      let b = 0;
      const offA = subscribeMinuteClock(() => a++);
      const offB = subscribeMinuteClock(() => b++);
      expect(started.length, "one timer for two creatures").toBe(1);
      expect(started[0].ms).toBe(MINUTE_MS);
      expect(MINUTE_MS, "the evening is noticed within a minute").toBe(60_000);
      started[0].fn();
      expect([a, b]).toEqual([1, 1]);
      offA();
      expect(cleared, "still one creature watching").toBe(0);
      started[0].fn();
      expect([a, b]).toEqual([1, 2]);
      offB();
      expect(cleared, "stopped with the last").toBe(1);
      // and starts again for the next one
      const offC = subscribeMinuteClock(() => {});
      expect(started.length).toBe(2);
      offC();
    } finally {
      globalThis.setInterval = real.set;
      globalThis.clearInterval = real.clear;
    }
    expect(currentMinute()).toBe(Math.floor(Date.now() / MINUTE_MS));
  });
});

test.describe("the drawing", () => {
  const render = (props: Parameters<typeof CreatureAvatar>[0]) => renderToStaticMarkup(createElement(CreatureAvatar, props));
  const SPARKLE = 'data-mood="happy" class="creature-happy-sparkle"';

  test("normal is the default: the child's own eyes, no sparkle, no z", () => {
    const html = render({ species: "cat", tier: 5, style: "gumdrop", look: { eyes: "sparkly" } });
    expect(html).toContain('data-mood="normal"');
    expect(html).toContain('data-eyes="sparkly"');
    expect(html).not.toContain(SPARKLE);
    expect(html).not.toContain("creature-zzz");
  });

  test("happy: smiling eyes whatever was chosen, and a sparkle that never moves", () => {
    for (const species of ["dragon", "cat", "rex", "princess", "robot", "axolotl"]) {
      const html = render({ species, tier: 5, style: "sticker", mood: "happy", look: { eyes: "sparkly" } });
      expect(html, species).toContain('data-eyes="happy"');
      expect(html, species).not.toContain('data-eyes="sparkly"');
      expect(html, species).toContain(SPARKLE);
      expect(html, species).not.toContain("creature-zzz");
    }
    // the sparkle carries no animation class, animated or not
    const sparkle = render({ species: "cat", tier: 5, style: "gumdrop", mood: "happy", animated: true }).match(/<g data-mood="happy"[^]*?<\/g>/)![0];
    expect(sparkle).not.toMatch(/creature-(breathe|blink|flap|wobble|zzz|sway|led|gill)/);
  });

  test("sleepy: closed eyes and z z, which move only on an animated creature", () => {
    const still = render({ species: "dragon", tier: 5, style: "storybook", mood: "sleepy", animated: false });
    expect(still).toContain('data-eyes="sleepy"');
    expect(still).toContain("creature-zzz");
    expect(still).not.toContain("creature-animated");
    expect(still).not.toContain(SPARKLE);
    const moving = render({ species: "dragon", tier: 5, style: "storybook", mood: "sleepy", animated: true });
    expect(moving).toContain("creature-animated");
    // and the stylesheet animates the z only inside .creature-animated
    const css = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");
    const zzzRules = css.split("\n").filter((l) => /\.creature-zzz\s*\{[^}]*animation/.test(l));
    expect(zzzRules.length).toBeGreaterThan(0);
    for (const rule of zzzRules) expect(rule.trim().startsWith(".creature-animated .creature-zzz")).toBe(true);
    expect(css).not.toMatch(/\.creature-happy-sparkle\s*\{[^}]*animation/);
  });

  test("the classic pictures have no moods", () => {
    const one = render({ species: "astronaut", tier: 4, style: "classic", mood: "normal" });
    for (const m of ["happy", "sleepy"] as const) expect(render({ species: "astronaut", tier: 4, style: "classic", mood: m })).toBe(one);
  });

  test("every screen that shows a child's creature wears the mood", () => {
    const src = (p: string) => readFileSync(join(__dirname, "../src", p), "utf8");
    // the widget, the profile and the page each ask for the mood and hand it to their creature
    const wiring: Array<[string, RegExp]> = [
      ["components/widgets/pocket-money-widget.tsx", /<ReactingCreature(?:(?!\/>)[\s\S])*mood=\{mood\}/],
      ["components/widgets/family-members.tsx", /<ReactingCreature(?:(?!\/>)[\s\S])*mood=\{petMood\}/],
      ["app/pocket-money/page.tsx", /<ReactingCreature(?:(?!\/>)[\s\S])*mood=\{mood\}/],
    ];
    for (const [p, re] of wiring) {
      expect(src(p), p).toMatch(/useCreatureMood\(/);
      expect(src(p), p).toMatch(re);
    }
    // the page shares one answer with the stages sheet, which gives it to the current stage only
    expect(src("app/pocket-money/page.tsx")).toMatch(/<StagesSheet(?:(?!\/>)[\s\S])*mood=\{mood\}/);
    expect(src("components/pocket-money/stages-sheet.tsx")).toMatch(/mood=\{isCurrent \? mood : "normal"\}/);
    // the settings thumbnail
    const settings = src("app/settings/pocket-money/page.tsx");
    expect(settings).toMatch(/<ChildCreature[\s\S]*?personId=\{acct\.person_id\}/);
    expect(settings).toMatch(/function ChildCreature[\s\S]*?useCreatureMood\(personId\)[\s\S]*?<CreatureAvatar \{\.\.\.avatar\} mood=\{mood\} \/>/);
    // and the mood rules know nothing of pocket money, so they can move with the creature
    expect(src("lib/creature-mood.ts")).not.toMatch(/from\s+["'][^"']*pocket-money/);
    expect(src("hooks/use-creature-mood.ts")).not.toMatch(/from\s+["'][^"']*pocket-money/);
  });
});
