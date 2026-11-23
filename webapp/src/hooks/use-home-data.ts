"use client";

import { useMemo } from "react";
import { useBirthdays, useEvents, usePeople, useTodos } from "./use-supabase-queries";
import { useToday } from "./use-today";
import { homeEventWindow, type HomeDataNeeds } from "@/lib/home-data";

/**
 * Home's events: today and the next fourteen days, one request under one
 * query key for every widget that reads it (RFC-022 step 2). A widget that
 * shows fewer days cuts them with `eventsOverlapping` instead of asking for
 * its own window -- a window of its own is a second request on load and a
 * second refetch on every change to any event, which on the Pi is the cost
 * that matters.
 *
 * The window follows the local day (`useToday`), so a kiosk left on for a
 * week is not still asking for the fortnight it started in.
 */
export function useHomeEvents(options?: { enabled?: boolean }) {
  const today = useToday();
  const { startDate, endDate } = useMemo(() => homeEventWindow(today), [today]);
  const query = useEvents(startDate, endDate, options);
  return { today, startDate, endDate, ...query };
}

/**
 * Everything Home's widgets read in common, from one call: the events window,
 * the tasks, the people and the birthdays. Each is the same query the widgets
 * already use, under the same key, so a widget that still calls its own hook
 * and a widget reading this share one request -- this adds none.
 *
 * `needs` (see `homeDataNeeds`) switches off what no widget on screen reads;
 * left out, everything is loaded. Meant to be called once per Home, by
 * whoever renders it, and handed to the widgets in their boxes through
 * `HomeDataProvider` -- the counterpart of `useScreensaverData`.
 *
 * The result is memoised: it changes only when one of its fields does.
 */
export function useHomeData(needs?: Partial<HomeDataNeeds>) {
  const want = (key: keyof HomeDataNeeds) => needs?.[key] ?? true;
  const events = useHomeEvents({ enabled: want("events") });
  const todos = useTodos({ enabled: want("todos") });
  const people = usePeople({ enabled: want("people") });
  const birthdays = useBirthdays({ enabled: want("birthdays") });

  const { today, startDate, endDate } = events;
  const { data: eventRows, isLoading: eventsLoading, isError: eventsError } = events;
  const { data: todoRows, isLoading: todosLoading, isError: todosError } = todos;
  const { data: peopleRows, isLoading: peopleLoading, isError: peopleError } = people;
  const { data: birthdayRows, isLoading: birthdaysLoading, isError: birthdaysError } = birthdays;

  return useMemo(
    () => ({
      /** Start of the local day (ms), as `useToday` gives it. */
      today,
      eventWindow: { startDate, endDate },
      events: eventRows,
      eventsLoading,
      eventsError,
      todos: todoRows,
      todosLoading,
      todosError,
      people: peopleRows,
      peopleLoading,
      peopleError,
      birthdays: birthdayRows,
      birthdaysLoading,
      birthdaysError,
    }),
    [
      today, startDate, endDate,
      eventRows, eventsLoading, eventsError,
      todoRows, todosLoading, todosError,
      peopleRows, peopleLoading, peopleError,
      birthdayRows, birthdaysLoading, birthdaysError,
    ],
  );
}

export type HomeData = ReturnType<typeof useHomeData>;
