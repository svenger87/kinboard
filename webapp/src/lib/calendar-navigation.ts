import { addMonths, addWeeks } from "date-fns";

/** Move the visible period and its selected day together. date-fns clamps month ends. */
export function navigateCalendarDate(date: Date, view: "month" | "week", direction: -1 | 1): Date {
  return view === "month" ? addMonths(date, direction) : addWeeks(date, direction);
}
