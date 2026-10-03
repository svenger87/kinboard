import type { TaskDot } from "@/lib/calendar-markers";

/**
 * One person's task dot on a calendar day. Filled while something is due, and
 * filled for a tracked day that was done; a ring when a tracked day was not
 * done (#341), so a past week reads "missed, done, done, missed" at a glance.
 */
export function TaskDotMark({ dot, className }: { dot: TaskDot; className: string }) {
  return dot.status === "missed" ? (
    <span className={`${className} rounded-full border-[1.5px] bg-transparent`} style={{ borderColor: dot.color }} />
  ) : (
    <span className={`${className} rounded-full`} style={{ backgroundColor: dot.color }} />
  );
}
