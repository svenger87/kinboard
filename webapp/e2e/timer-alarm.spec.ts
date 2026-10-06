import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { RING_EVERY_MS, RING_FOR_MS, alarmRinging } from "../src/lib/timer-alarm";
import { msPastEnd } from "../src/lib/timer-math";
import type { Timer } from "../src/types/database";
import { codeOnly } from "./source-helpers";

/**
 * The timer alarm on a wall display: when it rings, for how long, and that it
 * rings on every page, unlocked by any touch. No stack;
 * timer-alarm-ui.spec.ts listens to a real kiosk page.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const START = Date.parse("2026-10-06T12:00:00Z");
const at = (secondsAfterStart: number) => new Date(START + secondsAfterStart * 1000);
const timer = (over: Partial<Timer> = {}): Timer =>
  ({
    id: "t1",
    family_id: "f1",
    label: null,
    duration_seconds: 60,
    started_at: new Date(START).toISOString(),
    finished_at: null,
    dismissed_at: null,
    created_at: new Date(START).toISOString(),
    updated_at: new Date(START).toISOString(),
    ...over,
  }) as Timer;

test("a timer rings from the moment it runs out until two minutes later, unless dismissed", () => {
  expect(RING_FOR_MS).toBe(120_000);
  expect(alarmRinging([timer()], at(59))).toBe(false);
  expect(alarmRinging([timer()], at(60))).toBe(true);
  expect(alarmRinging([timer()], at(60 + 119))).toBe(true);
  expect(alarmRinging([timer()], at(60 + 120))).toBe(false);
  expect(alarmRinging([timer({ dismissed_at: at(61).toISOString() })], at(62))).toBe(false);
  expect(alarmRinging([], at(62))).toBe(false);
});

test("one fresh alarm is enough, whatever else is on the board", () => {
  const old = timer({ id: "old", started_at: at(-3600).toISOString() });
  const running = timer({ id: "running", duration_seconds: 600 });
  const fresh = timer({ id: "fresh", duration_seconds: 30 });
  expect(alarmRinging([old, running], at(40))).toBe(false);
  expect(alarmRinging([old, running, fresh], at(40))).toBe(true);
});

test("how long ago a timer ran out", () => {
  expect(msPastEnd(timer(), at(30))).toBe(-30_000);
  expect(msPastEnd(timer(), at(90))).toBe(30_000);
});

test("the alarm sounds from the whole app, on a kiosk only, and any touch or key unlocks it", () => {
  const providers = codeOnly(read("src/app/providers.tsx"));
  expect(providers).toContain("<TimerAlarm />");
  const alarm = codeOnly(read("src/components/timer-alarm.tsx"));
  expect(alarm).toContain("const isKiosk = device?.is_kiosk ?? false;");
  // A finger's touch only counts once it lifts: pointerup, not pointerdown alone.
  expect(alarm).toContain('const events = ["pointerdown", "pointerup", "keydown"] as const;');
  expect(alarm).toContain("for (const event of events) document.addEventListener(event, unlockTone, options);");
  expect(alarm).toContain("const options = { capture: true, passive: true } as const;");
  expect(alarm).toContain("alarmRinging(current, applyOffset(new Date(), offset))");
  expect(alarm).toContain("Date.now() - lastRing >= RING_EVERY_MS && playTone()");
  expect(RING_EVERY_MS).toBe(3_000);
});

test("the widget no longer rings on its own, and says when the sound is off, in its header", () => {
  const widget = codeOnly(read("src/components/widgets/timer-widget.tsx"));
  expect(widget).not.toContain("playTone");
  expect(widget).not.toContain("unlockTone");
  expect(widget).toContain("const soundOff = (device?.is_kiosk ?? false) && !toneReady && visible.length > 0;");
  // In the header, which keeps its height: the touch that turns the sound on
  // hides it, and nothing may move under that finger, or its tap is lost.
  const header = widget.slice(widget.indexOf("headerRight={"), widget.indexOf("headerRight={") + 400);
  expect(header).toContain("soundOff ? (");
  expect(header).toContain('aria-label={t("soundOff")}');
  expect(widget).not.toContain('{soundOff && <p');
  const tone = codeOnly(read("src/lib/timer-tone.ts"));
  expect(tone).toContain('ctx.addEventListener("statechange", notify);');
  expect(tone).toContain('return ctx?.state === "running";');
});

test("the sound-off note exists in every language", () => {
  for (const locale of ["en", "de", "fr"]) {
    const strings = JSON.parse(read(`messages/${locale}.json`)).timers;
    for (const key of ["soundOff", "soundOffShort"]) {
      expect(typeof strings[key], `${locale}.${key}`).toBe("string");
      expect(strings[key].trim(), `${locale}.${key}`).not.toBe("");
    }
  }
});
