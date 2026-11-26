/**
 * ofelia's schedule syntax and its next-run times, in UTC (RFC-023 §4.5).
 *
 * ofelia schedules with robfig/cron v3 and a parser that takes six fields,
 * seconds first: `sec min hour day-of-month month day-of-week`, plus the
 * descriptors (`@hourly`, `@daily`, …) and `@every <duration>`. This module
 * reads the same syntax and answers the same question — when does it fire
 * next — so the internal scheduler fires at the times ofelia does:
 *
 * - Fixed times are matched against the UTC clock, never local time. ofelia's
 *   container sets no zone, so it has always been UTC (decided, §11.1b). A
 *   server whose TZ is Europe/Berlin still fires `0 0 8 * * *` at 08:00 UTC,
 *   and there is no DST gap or doubled hour, because UTC has none.
 * - `@every d` counts from the scheduler's start: robfig's ConstantDelay,
 *   `start + d`, `start + 2d`, … with d cut to whole seconds, at least 1 s.
 * - Day-of-month and day-of-week: when either is `*` (or `?`), both must
 *   match; when both are restricted, either may (robfig's rule, cron's too).
 */

export type Schedule =
  | { kind: "every"; seconds: number }
  | {
      kind: "cron";
      second: Set<number>;
      minute: Set<number>;
      hour: Set<number>;
      dom: Set<number>;
      month: Set<number>;
      dow: Set<number>;
      /** dom or dow was `*`/`?`: then both must match, not either. */
      dayStar: boolean;
    };

const DESCRIPTORS: Record<string, string> = {
  "@yearly": "0 0 0 1 1 *",
  "@annually": "0 0 0 1 1 *",
  "@monthly": "0 0 0 1 * *",
  "@weekly": "0 0 0 * * 0",
  "@daily": "0 0 0 * * *",
  "@midnight": "0 0 0 * * *",
  "@hourly": "0 0 * * * *",
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

interface Bounds {
  min: number;
  max: number;
  names?: Record<string, number>;
}

const FIELDS: Bounds[] = [
  { min: 0, max: 59 }, // second
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12, names: Object.fromEntries(MONTHS.map((m, i) => [m, i + 1])) },
  { min: 0, max: 6, names: Object.fromEntries(DAYS.map((d, i) => [d, i])) },
];

/** Go's time.ParseDuration units that a schedule could sensibly use. */
const UNIT_MS: Record<string, number> = { ns: 1e-6, us: 1e-3, "µs": 1e-3, ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

function parseDuration(text: string): number {
  const re = /(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/gy;
  let ms = 0;
  let end = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    ms += Number(match[1]) * UNIT_MS[match[2]];
    end = re.lastIndex;
  }
  if (end === 0 || end !== text.length) throw new Error(`not a duration: "${text}"`);
  // robfig's Every(): cut to whole seconds, at least one.
  return Math.max(1, Math.floor(ms / 1000));
}

function value(token: string, b: Bounds, spec: string): number {
  const named = b.names?.[token.toLowerCase()];
  if (named !== undefined) return named;
  if (!/^\d+$/.test(token)) throw new Error(`"${token}" is not a number in "${spec}"`);
  return Number(token);
}

/** One field: `*`, `?`, `a`, `a-b`, with `/step`, comma-separated. */
function parseField(field: string, b: Bounds, spec: string): { set: Set<number>; star: boolean } {
  const set = new Set<number>();
  let star = false;
  for (const part of field.split(",")) {
    const [range, stepText, extra] = part.split("/");
    if (extra !== undefined) throw new Error(`too many slashes in "${part}" of "${spec}"`);
    let lo: number;
    let hi: number;
    if (range === "*" || range === "?") {
      [lo, hi] = [b.min, b.max];
      if (stepText === undefined) star = true;
    } else {
      const [a, z, more] = range.split("-");
      if (more !== undefined) throw new Error(`too many hyphens in "${part}" of "${spec}"`);
      lo = value(a, b, spec);
      // robfig: `a/n` runs from a to the field's end.
      hi = z !== undefined ? value(z, b, spec) : stepText !== undefined ? b.max : lo;
    }
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad step in "${part}" of "${spec}"`);
    if (lo < b.min || hi > b.max || lo > hi) {
      throw new Error(`"${part}" is outside ${b.min}-${b.max} in "${spec}"`);
    }
    for (let v = lo; v <= hi; v += step) set.add(v);
  }
  return { set, star };
}

export function parseSchedule(spec: string): Schedule {
  const text = spec.trim().replace(/\s+/g, " ");
  if (text.startsWith("@every ")) return { kind: "every", seconds: parseDuration(text.slice(7).trim()) };
  const expanded = text.startsWith("@") ? DESCRIPTORS[text.toLowerCase()] : text;
  if (!expanded) throw new Error(`unknown descriptor "${text}"`);
  const parts = expanded.split(" ");
  if (parts.length !== 6) {
    throw new Error(`"${spec}" has ${parts.length} fields; ofelia's schedules have six, seconds first`);
  }
  const [second, minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, FIELDS[i], spec));
  return {
    kind: "cron",
    second: second.set,
    minute: minute.set,
    hour: hour.set,
    dom: dom.set,
    month: month.set,
    dow: dow.set,
    dayStar: dom.star || dow.star,
  };
}

/**
 * One canonical spelling per schedule, for comparing two of them:
 * `@every 15m` and `@every 900s` are both `@every 900s`; `0 0 08 * * *`,
 * `0 0 8 * * ?` and `@daily`-style descriptors expand to their value lists.
 */
export function normaliseSchedule(spec: string): string {
  const s = parseSchedule(spec);
  if (s.kind === "every") return `@every ${s.seconds}s`;
  const list = (set: Set<number>, b: Bounds) =>
    set.size === b.max - b.min + 1 ? "*" : [...set].sort((x, y) => x - y).join(",");
  const fields = [s.second, s.minute, s.hour, s.dom, s.month, s.dow].map((set, i) => list(set, FIELDS[i]));
  // A restricted dom/dow pair means "either"; mark it so it never equals "both".
  return s.dayStar ? fields.join(" ") : `${fields.join(" ")} (dom|dow)`;
}

const SECOND = 1000;

function dayMatches(s: Extract<Schedule, { kind: "cron" }>, d: Date): boolean {
  const dom = s.dom.has(d.getUTCDate());
  const dow = s.dow.has(d.getUTCDay());
  return s.dayStar ? dom && dow : dom || dow;
}

/**
 * The first time strictly after `after` (ms since the epoch) that a fixed
 * schedule fires, in UTC, to the second. Throws when nothing matches within
 * five years (`0 0 0 30 2 *`), as robfig gives up then too.
 */
export function nextCronTime(s: Extract<Schedule, { kind: "cron" }>, after: number): number {
  let t = Math.floor(after / SECOND) * SECOND + SECOND;
  const limit = after + 5 * 366 * 86_400_000;
  while (t <= limit) {
    const d = new Date(t);
    if (!s.month.has(d.getUTCMonth() + 1)) {
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    } else if (!dayMatches(s, d)) {
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    } else if (!s.hour.has(d.getUTCHours())) {
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours() + 1);
    } else if (!s.minute.has(d.getUTCMinutes())) {
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes() + 1);
    } else if (!s.second.has(d.getUTCSeconds())) {
      t += SECOND;
    } else {
      return t;
    }
  }
  throw new Error("the schedule never fires within five years");
}

/**
 * When a job fires next.
 *
 * `planned` is the time it was due last (or the scheduler's start, for the
 * first run) and `now` the clock. A fixed schedule's next time is after both.
 * An interval keeps its cadence from the start, `planned + d`; when the
 * process was asleep past one or more of its slots, the missed ones are
 * skipped and it resumes on the cadence, as robfig does: one late run on
 * waking (the timer that was due), never a burst of catch-up runs.
 */
export function nextRun(s: Schedule, planned: number, now: number): number {
  if (s.kind === "cron") return nextCronTime(s, Math.max(planned, now));
  const step = s.seconds * SECOND;
  let next = planned + step;
  if (next <= now) next += Math.ceil((now - next + 1) / step) * step;
  return next;
}
