import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { pillsThatFit } from "../src/components/layouts/home-widgets/pills-fit";

/**
 * RFC-022 step 4, the first group: the clock block's five widgets, the
 * upcoming events and the weather, each in a box of any size from its
 * minimum up. Source guard plus the today strip's arithmetic; the drawn
 * result is checked by eye at the minimum and a large box (see the PR).
 */

const DIR = "src/components/layouts/home-widgets";
const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const FILES: Record<string, string> = {
  clock: "clock",
  date: "date",
  greeting: "greeting",
  familyMembers: "family-members",
  todayStrip: "today-strip",
  upcomingEvents: "upcoming-events",
  weather: "weather",
};

test("the group's registry has the seven keys, one file each", () => {
  const reg = read(`${DIR}/clock-block.ts`);
  const body = reg.slice(reg.indexOf("CLOCKBLOCK_WIDGETS"));
  const keys = [...body.matchAll(/^\s+(\w+): Home\w+Widget,$/gm)].map((m) => m[1]);
  expect(keys.sort()).toEqual(Object.keys(FILES).sort());
  for (const file of Object.values(FILES)) expect(existsSync(`${DIR}/${file}.tsx`), file).toBe(true);
});

test("the clock and the weather grow with their box; the date, greeting and members are drawn at their text size and only shrink to fit; lists end in a '+n' that links to the calendar", () => {
  for (const key of ["clock", "weather"]) {
    expect(code(`${DIR}/${FILES[key]}.tsx`), key).toMatch(/import \{[^}]*\buseFitToBox\b[^}]*\} from "@\/hooks\/use-fit-to-box"/);
  }
  // At their text size (frame.tsx's HOME_VALUE_EM), smaller only in too small a box.
  for (const key of ["date", "greeting"]) expect(code(`${DIR}/${FILES[key]}.tsx`), key).toContain("useCappedFit(frame, ref, box, HOME_VALUE_EM.");
  expect(code(`${DIR}/family-members.tsx`)).toContain("Math.min(fit, cap)");
  const events = code(`${DIR}/upcoming-events.tsx`);
  expect(events).toMatch(/import \{ ListBox \} from "@\/components\/layouts\/list-box"/);
  expect(events).toMatch(/renderMore=\{renderMore\}/);
  expect(events).toContain('href="/calendar"');
  // An event opens on the calendar, its detail over the page.
  expect(events).toContain("href={`/calendar?event=${encodeURIComponent(r.id)}`}");
  const strip = code(`${DIR}/today-strip.tsx`);
  expect(strip).toContain('<Link href="/calendar" data-testid="list-more"');
});

test("touch targets stay at least 48px", () => {
  expect(code(`${DIR}/frame.tsx`)).toContain('export const HOME_TARGET_H = "min-h-[48px]";');
  expect(code(`${DIR}/today-strip.tsx`)).toContain('const MORE = "inline-flex min-h-[48px]');
  expect(code(`${DIR}/weather.tsx`)).toContain("${HOME_TARGET_H}");
  expect(code("src/components/widgets/date-week.tsx")).toContain('scaled && target ? " inline-flex min-h-[48px] min-w-[48px]');
  expect(code(`${DIR}/weather.tsx`)).toContain("min-h-[48px]");
  const members = code("src/components/widgets/family-members.tsx");
  expect(members).toContain('size={variant === "box" ? "max(48px, 3.5em)" : 64}');
  expect(members).toContain("min-h-[48px] min-w-[48px]");
});

test("the clock box carries the timer role, not a live region", () => {
  const clock = code(`${DIR}/clock.tsx`);
  expect(clock).toContain('role="timer"');
  expect(clock).toContain('aria-live="off"');
});

test("the group reads Home's shared data: no events request and no timer of its own", () => {
  for (const file of Object.values(FILES)) {
    const src = code(`${DIR}/${file}.tsx`);
    expect(src, file).not.toMatch(/\buseEvents\(|\buseHomeEvents\(|setInterval|setTimeout|refetchInterval/);
  }
  for (const key of ["familyMembers", "todayStrip", "upcomingEvents"]) {
    expect(code(`${DIR}/${FILES[key]}.tsx`), key).toContain("useHomeDataContext()");
  }
  // Handed its week, the members widget does not ask for one.
  const members = code("src/components/widgets/family-members.tsx");
  expect(members).toContain("{ enabled: givenEvents === undefined }");
  expect(code(`${DIR}/family-members.tsx`)).toContain("<FamilyMembers variant=\"box\" stacked={stacked} labels={!bare} events={week} />");
});

test("the built-in block still draws its widgets at their fixed sizes", () => {
  const block = code("src/components/widgets/home-clock-block.tsx");
  expect(block).toContain('<ClockTime size={compact ? "lg" : "xl"} showSeconds={showSeconds} />');
  expect(block).toContain('<DateAndWeek className="mt-4" />');
  expect(block).toContain('<Greeting className="mt-2" />');
  expect(block).toContain('<FamilyMembers className={compact ? "flex-wrap" : ""} />');
  expect(block).toContain("<TodayStrip />");
  expect(block).not.toMatch(/scaled|variant=|size="box"/);
});

test("the today strip shows whole pills, wrapping like flex-wrap, and keeps room for '+n'", () => {
  // Everything fits on one row: no "+n".
  expect(pillsThatFit([100, 100, 100], 60, 400, 1, 10)).toBe(3);
  // Four don't: three leave room for a 60px chip ("+1")...
  expect(pillsThatFit([100, 100, 100, 100], 60, 400, 1, 10)).toBe(3);
  // ...but not for a 90px one, so two and "+2".
  expect(pillsThatFit([100, 100, 100, 100], 90, 400, 1, 10)).toBe(2);
  // A second row takes the rest.
  expect(pillsThatFit([100, 100, 100, 100], 60, 400, 2, 10)).toBe(4);
  // A pill wider than the box is capped at the box: one per row.
  expect(pillsThatFit([900, 900], 60, 400, 2, 10)).toBe(2);
  expect(pillsThatFit([900], 60, 400, 1, 10)).toBe(1);
  // Nothing fits beside the chip: only "+n".
  expect(pillsThatFit([380, 380], 60, 400, 1, 10)).toBe(0);
  expect(pillsThatFit([], 60, 400, 1, 10)).toBe(0);
});
