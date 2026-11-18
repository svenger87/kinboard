import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createTranslator } from "next-intl";
import { nextEventLine, type NextEventCandidate } from "../src/lib/next-event-line";
import { DEFAULT_SCREENSAVER_SETTINGS } from "../src/types/screensaver";

/**
 * RFC-021 §3.2: in the hour before an event that starts at a time, one line
 * under the idle screen's clock. A child's event in a child's words, anyone
 * else's (and no one's, §8.1) short.
 */

const NOW = new Date("2026-11-10T16:55:00Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const people = [
  { id: "mira", is_child: true },
  { id: "dad", is_child: false },
];
const ev = (title: string, minutes: number, extra: Partial<NextEventCandidate> = {}): NextEventCandidate => ({
  title,
  start: at(minutes),
  allDay: false,
  personId: null,
  ...extra,
});

test("only in the hour before, and gone at the start", () => {
  expect(nextEventLine([ev("Football", 61)], NOW, people)).toBeNull();
  expect(nextEventLine([ev("Football", 60)], NOW, people)).toMatchObject({ minutes: 60 });
  expect(nextEventLine([ev("Football", 35)], NOW, people)).toMatchObject({ title: "Football", minutes: 35 });
  expect(nextEventLine([ev("Football", 0.5)], NOW, people)).toMatchObject({ minutes: 1 });
  expect(nextEventLine([ev("Football", 0)], NOW, people)).toBeNull();
  expect(nextEventLine([ev("Football", -5)], NOW, people)).toBeNull();
});

test("minutes round up, so the line never says less than is left", () => {
  expect(nextEventLine([ev("Football", 34 + 10 / 60)], NOW, people)?.minutes).toBe(35);
});

test("all-day events never count, and the earliest timed one wins", () => {
  expect(nextEventLine([ev("Holiday", 30, { allDay: true })], NOW, people)).toBeNull();
  const line = nextEventLine([ev("Dentist", 50), ev("Holiday", 5, { allDay: true }), ev("Football", 20)], NOW, people);
  expect(line?.title).toBe("Football");
});

test("a child's event speaks to the child; a grown-up's and no one's stay short", () => {
  expect(nextEventLine([ev("Football", 35, { personId: "mira" })], NOW, people)?.child).toBe(true);
  expect(nextEventLine([ev("Dentist", 35, { personId: "dad" })], NOW, people)?.child).toBe(false);
  expect(nextEventLine([ev("Grandma comes", 35)], NOW, people)?.child).toBe(false);
  expect(nextEventLine([ev("Football", 35, { personId: "gone" })], NOW, people)?.child).toBe(false);
});

test("the words, in every language", () => {
  const say = (locale: string, key: string, minutes: number, title: string) => {
    const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
    return createTranslator({ locale, messages, namespace: "components.screensaver" })(key as never, { title, minutes } as never);
  };
  expect(say("de", "nextEventChild", 35, "Fußball")).toBe("Fußball – noch 35 Minuten!");
  expect(say("de", "nextEventChild", 1, "Fußball")).toBe("Fußball – noch 1 Minute!");
  expect(say("de", "nextEventAdult", 35, "Zahnarzt")).toBe("Zahnarzt in 35 Min.");
  expect(say("en", "nextEventChild", 35, "Football")).toBe("Football in 35 minutes!");
  expect(say("en", "nextEventAdult", 35, "Dentist")).toBe("Dentist in 35 min.");
  expect(say("fr", "nextEventChild", 35, "Football")).toBe("Football dans 35 minutes !");
  expect(say("fr", "nextEventAdult", 35, "Dentiste")).toBe("Dentiste dans 35 min");
});

test("on unless switched off, and wired under the clock", () => {
  expect(DEFAULT_SCREENSAVER_SETTINGS.showNextEvent).toBe(true);
  const saver = readFileSync("src/components/screensaver.tsx", "utf8");
  expect(saver).toContain("const showNextEvent = screensaverSettings.showNextEvent ?? true;");
  expect(saver).toContain("personId: e.person_id || e.calendar?.person_id || null,");
  expect(saver).toContain('data-testid="screensaver-next-event"');
  // Under the date, inside the clock block that drifts against burn-in.
  const clock = saver.indexOf('data-festival-anchor="screensaver-clock"');
  const line = saver.indexOf('data-testid="screensaver-next-event"');
  const events = saver.indexOf("{/* Right side - Events and Birthdays");
  expect(clock).toBeGreaterThan(0);
  expect(line).toBeGreaterThan(clock);
  expect(line).toBeLessThan(events);
  const settings = readFileSync("src/app/settings/screensaver/page.tsx", "utf8");
  expect(settings).toContain('updateDisplayOption("showNextEvent", value)');
});

test("the news list stops above the clock and the events, and fades when cut short", () => {
  const saver = readFileSync("src/components/screensaver.tsx", "utf8");
  expect(saver).toContain("ref={newsListRef}");
  expect(saver).toContain("ref={clockBlockRef}");
  expect(saver).toContain("ref={eventsBlockRef}");
  // Only blocks in the news list's own column count.
  expect(saver).toContain("if (r.height === 0 || r.right <= box.left || r.left >= box.right) continue;");
  expect(saver).toContain("maxHeight: `min(60vh, ${newsRoom}px)`");
  expect(saver).toContain('maskImage: "linear-gradient(to bottom, black calc(100% - 3rem), transparent)"');
});
