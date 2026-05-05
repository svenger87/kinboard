"use client";

import { useMemo } from "react";
import { useTodos, useBirthdays } from "@/hooks/use-supabase-queries";
import { parseISO, startOfDay, setYear, differenceInDays, addYears } from "date-fns";

function getDaysUntilBirthday(dateStr: string): number {
  const date = parseISO(dateStr + "T12:00:00");
  const today = startOfDay(new Date());
  const thisYear = startOfDay(setYear(date, today.getFullYear()));
  const diff = differenceInDays(thisYear, today);
  if (diff < 0) return differenceInDays(addYears(thisYear, 1), today);
  return diff;
}

export type NavBadges = Record<string, number>;

export function useNavBadges(): NavBadges {
  const { data: todos } = useTodos();
  const { data: birthdays } = useBirthdays();

  return useMemo(() => {
    const badges: NavBadges = {};

    // Pending todos count
    const pendingTodos = (todos || []).filter((t) => !t.completed).length;
    if (pendingTodos > 0) {
      badges["/todos"] = pendingTodos;
    }

    // Birthdays today
    const birthdaysToday = (birthdays || []).filter(
      (b) => b.date && getDaysUntilBirthday(b.date) === 0
    ).length;
    if (birthdaysToday > 0) {
      badges["/birthdays"] = birthdaysToday;
    }

    return badges;
  }, [todos, birthdays]);
}
