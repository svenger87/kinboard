"use client";

import { useMemo } from "react";
import { useTodos, useBirthdays } from "@/hooks/use-supabase-queries";
import { useToday } from "@/hooks/use-today";
import { parseBirthdayDate, getDaysUntilBirthday } from "@/lib/birthday";

export type NavBadges = Record<string, number>;

export function useNavBadges(): NavBadges {
  const { data: todos } = useTodos();
  const { data: birthdays } = useBirthdays();
  // Re-render at midnight so the "birthdays today" badge clears without a reload.
  const today = useToday();

  return useMemo(() => {
    const badges: NavBadges = {};

    // Pending todos count
    const pendingTodos = (todos || []).filter((t) => !t.completed).length;
    if (pendingTodos > 0) {
      badges["/todos"] = pendingTodos;
    }

    // Birthdays today
    const birthdaysToday = (birthdays || []).filter(
      (b) => b.date && getDaysUntilBirthday(parseBirthdayDate(b.date), new Date(today)) === 0
    ).length;
    if (birthdaysToday > 0) {
      badges["/birthdays"] = birthdaysToday;
    }

    return badges;
  }, [todos, birthdays, today]);
}
