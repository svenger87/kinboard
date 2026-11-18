import type { SignalSchoolBreak } from "@/lib/attention/types";
import { addDays } from "@/lib/local-date";
import { dayOfWeekOf, nextSchoolDay, schoolDayStatusOn } from "@/lib/school-day-rule";
import { packItemsForSubject, type PackItemConfig } from "@/lib/schedule-pack-items";

/**
 * The children's lessons on the screensaver (#282): which day, and for each
 * child with lessons that day, the subjects and what to bring. So a family
 * sees at a glance, from across the kitchen, that today is a PE day.
 *
 * The day follows the schedule widget: today when it is a school day, and
 * from the widget's "next school day from" time in the evening the next
 * school day any child has lessons on, past weekends and holidays. A day off
 * with no evening preview shows nothing; the screensaver has no room to say
 * "no school" for every child.
 */

interface PersonLike {
  id: string;
  name: string;
  is_child?: boolean | null;
  color?: string | null;
}

interface ScheduleLike {
  person_id: string;
  day_of_week: number;
  time_slots?: unknown;
}

export interface LessonRow {
  personId: string;
  name: string;
  color: string | null;
  /** Each subject once, in the order of the day. */
  subjects: string[];
  /** What the day's subjects need, each item once. */
  bring: string[];
}

export interface ScreensaverLessons {
  /** The day shown, `YYYY-MM-DD`. */
  day: string;
  when: "today" | "tomorrow" | "later";
  rows: LessonRow[];
}

function subjectsOf(slots: unknown): string[] {
  if (!Array.isArray(slots)) return [];
  const sorted = [...slots]
    .filter((s): s is { period?: number; subject: string } => !!s && typeof s.subject === "string" && s.subject.trim() !== "")
    .sort((a, b) => (a.period ?? 0) - (b.period ?? 0));
  return [...new Set(sorted.map((s) => s.subject.trim()))];
}

export function lessonsForScreensaver(args: {
  people: readonly PersonLike[];
  schedules: readonly ScheduleLike[];
  breaks: readonly SignalSchoolBreak[];
  packItems: PackItemConfig[];
  todayKey: string;
  /** "HH:MM" now, the device's wall clock. */
  nowTime: string;
  /** The schedule widget's setting: "off", or "HH:MM" from which the next school day shows. */
  tomorrowFrom: string;
}): ScreensaverLessons | null {
  const children = args.people.filter((p) => p.is_child);
  const lessonsOn = (personId: string, dow: number) =>
    subjectsOf(args.schedules.find((s) => s.person_id === personId && s.day_of_week === dow)?.time_slots);
  const anyLessons = (dow: number) => children.some((c) => lessonsOn(c.id, dow).length > 0);

  let day: string | null = null;
  let when: ScreensaverLessons["when"] = "today";
  const preview = args.tomorrowFrom !== "off" && args.nowTime >= args.tomorrowFrom;
  if (preview) {
    const next = nextSchoolDay(args.todayKey, args.breaks, { hasLessons: anyLessons });
    if (next) {
      day = next.date;
      when = next.date === addDays(args.todayKey, 1) ? "tomorrow" : "later";
    }
  } else if (schoolDayStatusOn(args.todayKey, args.breaks).school_day) {
    day = args.todayKey;
  }
  if (!day) return null;

  const dow = dayOfWeekOf(day);
  const rows: LessonRow[] = [];
  for (const child of children) {
    const subjects = lessonsOn(child.id, dow);
    if (subjects.length === 0) continue;
    const bring = [...new Set(subjects.flatMap((s) => packItemsForSubject(s, args.packItems)))];
    rows.push({ personId: child.id, name: child.name, color: child.color ?? null, subjects, bring });
  }
  return rows.length > 0 ? { day, when, rows } : null;
}
