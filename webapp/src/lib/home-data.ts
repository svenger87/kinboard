/**
 * What Home reads, worked out without React (RFC-022 step 2): the one window
 * of events Home asks the server for, how a widget that shows fewer days cuts
 * its own days from it, and which shared queries a set of Home widgets needs.
 * `hooks/use-home-data.ts` runs the queries; this file decides them.
 */
import { addDays, endOfDay } from "date-fns";

/**
 * Days after today that Home's events cover: the Events widget's fortnight,
 * which is the longest look ahead of any Home widget. Every shorter view --
 * the bins, the week overview, and later today's strip and the family
 * members' week -- is a slice of it, not a request of its own.
 */
export const HOME_EVENT_DAYS = 14;

export interface HomeEventWindow {
  /** Start of the local day, as an ISO instant. */
  startDate: string;
  /** End of the local day HOME_EVENT_DAYS later, as an ISO instant. */
  endDate: string;
}

/**
 * The events window for a local day, `today` being any moment of it (a
 * `useToday()` value is its start). The strings are the query key: every Home
 * widget that asks for this window shares one request and one refetch per
 * change, so the strings must come out identical for the whole day.
 */
export function homeEventWindow(today: number | Date): HomeEventWindow {
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  return {
    startDate: start.toISOString(),
    endDate: endOfDay(addDays(start, HOME_EVENT_DAYS)).toISOString(),
  };
}

interface Timed {
  start_at: string;
  end_at?: string | null;
}

/**
 * The events that overlap `[from, to]`, by the rule the events query applies
 * on the server (starts no later than `to`, ends no earlier than `from`), so a
 * widget cutting a shorter window from Home's fortnight gets exactly the rows
 * its own request would have returned. Order is kept.
 */
export function eventsOverlapping<T extends Timed>(events: readonly T[] | null | undefined, from: Date, to: Date): T[] {
  if (!events) return [];
  const lo = from.getTime();
  const hi = to.getTime();
  return events.filter((event) => {
    const start = new Date(event.start_at).getTime();
    const end = new Date(event.end_at ?? event.start_at).getTime();
    return start <= hi && end >= lo;
  });
}

/** The queries Home's widgets share: each is one request however many widgets read it. */
export interface HomeDataNeeds {
  events: boolean;
  todos: boolean;
  people: boolean;
  birthdays: boolean;
}

export const NO_HOME_DATA: HomeDataNeeds = { events: false, todos: false, people: false, birthdays: false };

/**
 * Which shared queries each Home widget reads. Widgets not listed read none
 * of them: what they show (weather, shopping, notes, meal plan, timers…) is
 * theirs alone and fetched once whoever renders it. The clock block's parts
 * are here too, under the names RFC-022 §3.2 gives them, because a designed
 * Home places them like any other widget.
 */
const WIDGET_NEEDS: Record<string, Partial<HomeDataNeeds>> = {
  upcomingEvents: { events: true, todos: true, people: true },
  wasteCollection: { events: true },
  weekOverview: { events: true, todos: true, birthdays: true },
  birthday: { birthdays: true, people: true },
  tasks: { todos: true, people: true },
  schedule: { people: true },
  pocketMoney: { people: true },
  creatures: { people: true },
  todayStrip: { events: true, people: true },
  familyMembers: { events: true, todos: true, people: true },
};

/**
 * What a Home showing these widgets has to load. A query no widget on screen
 * reads stays off, so a family that hides the birthdays and the week overview
 * does not fetch birthdays for Home -- the same requests as today, no more.
 */
export function homeDataNeeds(widgets: Iterable<string>): HomeDataNeeds {
  const needs = { ...NO_HOME_DATA };
  for (const widget of widgets) {
    const own = WIDGET_NEEDS[widget];
    if (!own) continue;
    for (const key of Object.keys(own) as (keyof HomeDataNeeds)[]) {
      if (own[key]) needs[key] = true;
    }
  }
  return needs;
}
