import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The 12/24-hour switch has now been ignored twice.
 *
 * Issue #38: the setting existed and *nothing* read it — every clock formatted
 * with a hardcoded `HH:mm`. That was fixed by `useTimeFormat`.
 *
 * Issue #198: the switch worked, and three places still showed 24-hour time —
 * the screensaver called `useClock(60000)` without passing the setting, and the
 * calendar's day timeline and week gutter printed `${hour}:00` directly. None
 * of it failed a build, because a hardcoded time format is valid code.
 *
 * So this reads the source. A screen that draws a time has to get the format
 * from somewhere, and there are only two legitimate somewheres: `useTimeFormat`
 * (the household setting) or the browser locale via `toLocaleTimeString`.
 * Anything else is a decision made at author-time about somebody else's clock.
 */

const SRC = join(__dirname, "..", "src");

/**
 * Places where a fixed 24-hour format is correct, and why.
 *
 * Both of these compute rather than display. Neither reaches a screen, so the
 * household's preference has nothing to do with them — and forcing 12-hour on
 * either would be a bug, not a fix.
 */
const FIXED_BY_DESIGN: Record<string, string> = {
  "lib/ics-export.ts":
    "iCalendar is a machine format — RFC 5545 timestamps are 24-hour, always",
  "lib/attention/engine.ts":
    "localMinutes() parses an hour into minutes-since-midnight; hour12:false is the arithmetic, not a rendering choice",
};

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.isFile() && /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

/** Files that render UI, excluding API routes — a server route has no clock. */
function uiSources(): string[] {
  return walk(SRC).filter((f) => !f.includes(`${join("app", "api")}`));
}

test.describe("the 12/24-hour setting", () => {
  test("no UI file hardcodes a 24-hour pattern", () => {
    // `HH` in a date-fns pattern is 24-hour and cannot be anything else.
    const offenders: string[] = [];

    for (const file of uiSources()) {
      const source = readFileSync(file, "utf8");
      if (file.endsWith(join("hooks", "use-time-format.ts"))) continue; // defines both patterns
      const rel = file.replace(`${SRC}/`, "");
      if (FIXED_BY_DESIGN[rel]) continue;
      for (const [i, line] of source.split("\n").entries()) {
        if (/["'`]HH:mm/.test(line) || /hour12:\s*false/.test(line)) {
          offenders.push(`${file.replace(SRC, "src")}:${i + 1}  ${line.trim().slice(0, 70)}`);
        }
      }
    }

    expect(offenders, `Hardcoded 24-hour formatting:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  test("useClock is always given the setting", () => {
    // `useClock(interval)` silently defaults to 24-hour. That default is what
    // made the screensaver ignore the switch, and it reads as correct code.
    const offenders: string[] = [];

    for (const file of uiSources()) {
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/useClock\(([^)]*)\)/g)) {
        const args = m[1].trim();
        if (args === "" || !args.includes(",")) {
          offenders.push(`${file.replace(SRC, "src")}  useClock(${args})`);
        }
      }
    }

    expect(
      offenders,
      `useClock called without a use24Hour argument — it defaults to 24-hour:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  test("the calendar gutters ask the setting for their hour labels", () => {
    // Both printed `${hour}:00`, which is a 24-hour clock spelled by hand.
    const gutters = [
      join(SRC, "app", "calendar", "page.tsx"),
      join(SRC, "components", "calendar", "week-view.tsx"),
    ];

    for (const file of gutters) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} should use formatHourLabel`).toContain("formatHourLabel");
      expect(source, `${file} still prints a raw hour label`).not.toMatch(/\{hour\}:00/);
    }
  });

  test("the clock redraws when the setting arrives, not on the next minute", () => {
    // The setting resolves after first paint. Without an immediate tick the
    // clock kept its initial format until the minute rolled over — up to 60
    // seconds of the wrong clock on every cold start.
    const source = readFileSync(join(SRC, "hooks", "use-clock.ts"), "utf8");
    const effectBody = source.slice(source.indexOf("useEffect("));

    expect(effectBody).toMatch(/prevValues\.current = \{[^}]*\};\s*\n\s*tick\(\);/);
    expect(source).toContain("[updateInterval, use24Hour]");
  });
});

/**
 * The same class of defect as the clock, one category out: a convention chosen
 * at author-time that is right in Germany and wrong elsewhere. Each of these
 * was live until the fix that added this block.
 */
test.describe("locale conventions", () => {
  test("the week does not start on a hardcoded Monday", () => {
    const offenders: string[] = [];

    for (const file of uiSources()) {
      const rel = file.replace(`${SRC}/`, "");
      // The hook is where the choice legitimately resolves to a number.
      if (rel === "hooks/use-week-start.ts") continue;
      const source = readFileSync(file, "utf8");
      for (const [i, line] of source.split("\n").entries()) {
        if (/weekStartsOn:\s*[0-6]\b/.test(line) || /weekStartsOn\s*=\s*[0-6]\b/.test(line)) {
          offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 70)}`);
        }
      }
    }

    expect(
      offenders,
      `Hardcoded week start — use useWeekStart():\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  test("no UI file hardcodes German as a locale", () => {
    // `locale = de` on the date-picker meant every picker in the app showed
    // German weekday names, whatever language the household reads.
    const offenders: string[] = [];

    for (const file of uiSources()) {
      const rel = file.replace(`${SRC}/`, "");
      const source = readFileSync(file, "utf8");
      for (const [i, line] of source.split("\n").entries()) {
        if (/\blocale\s*[=:]\s*(de\b|"de(-DE)?")/.test(line) && !line.trim().startsWith("//")) {
          offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 70)}`);
        }
      }
    }

    expect(
      offenders,
      `German pinned as a locale default:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  test("server routes do not fall back to German", () => {
    // A missing `lang` parameter used to answer in German — for weather, the
    // forecast, image search and the Bring catalogue.
    const routes = walk(join(SRC, "app", "api"));
    const offenders: string[] = [];

    for (const file of routes) {
      const source = readFileSync(file, "utf8");
      for (const [i, line] of source.split("\n").entries()) {
        if (/(\|\||\?\?)\s*"de(-DE)?"/.test(line)) {
          offenders.push(`${file.replace(`${SRC}/`, "")}:${i + 1}  ${line.trim().slice(0, 70)}`);
        }
      }
    }

    expect(
      offenders,
      `Server route defaulting to German:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
