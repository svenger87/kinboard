"use client";

import { useMemo } from "react";
import { useTodos, useBirthdays } from "@/hooks/use-supabase-queries";
import { useToday } from "@/hooks/use-today";
import { parseBirthdayDate, getDaysUntilBirthday } from "@/lib/birthday";
import { usePendingWithdrawalCount } from "@/hooks/use-pocket-money-withdrawal-requests";
import { isTodoOpen } from "@/lib/todo-recurrence";

export type NavBadges = Record<string, number>;

export function useNavBadges(): NavBadges {
  const { data: todos } = useTodos();
  const { data: birthdays } = useBirthdays();
  // Re-render at midnight so the "birthdays today" badge clears without a reload.
  const today = useToday();
  // Spend requests waiting on a parent. Approval lives in settings,
  // which nobody opens routinely — without a badge a child's request
  // can sit unseen for days and read as being ignored.
  const pendingWithdrawals = usePendingWithdrawalCount();

  return useMemo(() => {
    const badges: NavBadges = {};

    // Pending todos count. Recurring chores are never marked completed, so
    // `!completed` alone would keep this badge lit permanently once a family
    // has a single daily task.
    // `today` is in the dep list, so this also re-runs at midnight when a
    // daily chore becomes due again.
    const pendingTodos = (todos || []).filter((t) => isTodoOpen(t)).length;
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

    if (pendingWithdrawals > 0) {
      badges["/pocket-money"] = pendingWithdrawals;
    }

    return badges;
  }, [todos, birthdays, today, pendingWithdrawals]);
}
