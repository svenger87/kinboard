"use client";

import { toLocalDateKey } from "@/lib/local-date";
import { Fragment, useMemo } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  CheckSquare,
  CheckCircle2,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { useTodos, useUpdateTodo, usePeople, useSetting, useToday } from "@/hooks";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { useTodoPoints } from "@/hooks/use-todo-points";
import { usePointTotals } from "@/hooks/use-point-rewards";
import { toast } from "sonner";
import type { Todo } from "@/types/database";
import { WidgetCard } from "@/components/widget-card";
import { ChecklistItem } from "@/components/checklist-item";
import { isTodoOpen } from "@/lib/todo-recurrence";
import { isOverdue, widgetTasks } from "@/lib/tasks-widget-groups";
import { todayPerson } from "@/lib/todo-turns";
import { PersonAvatar } from "@/components/person-avatar";

interface TasksWidgetProps {
  maxItems?: number;
  className?: string;
}

function TasksWidgetSkeleton() {
  const t = useTranslations("tasksWidget");
  return (
    <Card aria-label={t("loadingAria")} aria-busy="true">
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded" />
          <Skeleton className="h-5 w-24" />
        </div>
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-3/4 rounded-lg" />
      </CardContent>
    </Card>
  );
}

export function TasksWidget({
  maxItems = 5,
  className = "",
}: TasksWidgetProps) {
  const t = useTranslations("tasksWidget");
  const { data: todos, isLoading, isError } = useTodos();
  const { data: people } = usePeople();
  const { data: pointAwards = [] } = useTodoPoints();
  // What each child can still spend, as on the tasks page (discussion #349).
  const { totalsFor: pointTotalsFor } = usePointTotals();
  const updateTodo = useUpdateTodo();
  const { data: taskDisplay } = useSetting<{ large: boolean }>(SETTINGS_KEYS.taskDisplay, { large: false });
  // The day rolls over on a kiosk that stays on: what is "today", and which
  // repeating tasks have come round again, follow it.
  const today = useToday();
  const todayStr = toLocalDateKey(new Date(today));

  // Today's tasks first, then the upcoming ones (lib/tasks-widget-groups.ts).
  const openTodos = useMemo(() => {
    if (!todos) return [];
    // A recurring chore ticked off today is not outstanding, even though
    // its row stays `completed: false` so it can come round again.
    return widgetTasks(todos.filter((t) => isTodoOpen(t)), todayStr);
    // isTodoOpen reads the clock, so the day is a dependency: at midnight the
    // repeating tasks done yesterday are open again.
  }, [todos, todayStr]);

  const displayTodos = openTodos.slice(0, maxItems);
  const totalOpen = openTodos.length;

  const handleToggle = async (todo: Todo) => {
    try {
      if (todo.recurrence && todo.recurrence !== "once") {
        await updateTodo.mutateAsync({
          id: todo.id,
          last_completed: new Date().toISOString(),
          last_completed_day: toLocalDateKey(),
        });
        toast.success(t("toastDoneRecurring"));
      } else {
        await updateTodo.mutateAsync({
          id: todo.id,
          completed: true,
        });
        toast.success(t("toastDoneOneTime"));
      }
    } catch (err) {
      // A task taking turns cannot be ticked before its first day.
      toast.error((err as { hint?: string })?.hint === "no_open_turn" ? t("toastNoTurnOpen") : t("toastUpdateFailed"));
    }
  };

  const getPersonName = (personId: string | null) => {
    if (!personId || !people) return null;
    return people.find((p) => p.id === personId);
  };

  if (isLoading) {
    return <TasksWidgetSkeleton />;
  }

  if (isError) {
    return (
      <Card className={`accent-border-top h-full ${className}`}>
        <CardContent className="p-4">
          <p className="font-display text-lg font-semibold leading-tight mb-4">{t("title")}</p>
          <div className="flex flex-col items-center justify-center py-4 text-muted-foreground">
            <AlertCircle className="size-8 mb-2 text-destructive/40" />
            <p className="text-sm">{t("errorMessage")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.05 },
    },
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.55 }}
    >
      <WidgetCard
        icon={CheckSquare}
        title={t("title")}
        headerRight={
          totalOpen > 0 ? (
            <Badge variant="neutral" className="tabular-nums">
              {t("openCount", { count: totalOpen })}
            </Badge>
          ) : undefined
        }
        className={`h-full ${className}`}
      >
        {(pointAwards.length > 0 || todos?.some((todo) => todo.points > 0)) && (
          <div className="flex flex-wrap gap-2">
            {people?.filter((person) => person.is_child).map((person) => (
              <span key={person.id} className="rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">
                {person.name} · ⭐ {pointTotalsFor(person.id).balance}
              </span>
            ))}
          </div>
        )}
        <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-1.5">
          {(() => {
            let lastSection = "";
            return displayTodos.map(({ section, todo }) => {
              // A rotating task is today's person's.
              const person = getPersonName(todayPerson(todo, todayStr));
              const overdue = isOverdue(todo, todayStr);
              const large = taskDisplay?.large ?? false;
              const showSection = section !== lastSection;
              lastSection = section;
              return (
                <Fragment key={todo.id}>
                  {/* The Events widget's day label, for Today and Upcoming. */}
                  {showSection && (
                    <div className="mb-0.5 mt-2 flex items-center gap-2 first:mt-0">
                      <span className="text-kiosk-label text-2xs">{section === "today" ? t("today") : t("upcoming")}</span>
                      <div className="h-px flex-1 bg-border/40" />
                    </div>
                  )}
                  <ChecklistItem
                    checked={false}
                    onCheckedChange={() => handleToggle(todo)}
                    // "Show larger tasks on Home" keeps its big rows; every
                    // other family gets the compact row.
                    compact={!large}
                    className={large ? "min-h-[72px] [&_label]:text-lg [&_.peer]:scale-125" : undefined}
                    color={person?.color}
                    label={
                      // The whole title, wrapped: a narrow card used to cut it
                      // off with an ellipsis.
                      <span className="flex min-w-0 flex-col">
                        <span className="break-words leading-snug">
                          {todo.icon && <span className={large ? "mr-2 text-xl" : "mr-1.5 text-base"} aria-hidden="true">{todo.icon}</span>}
                          {todo.title}
                          {todo.points > 0 && <span className="ml-2 text-xs text-primary">⭐ {todo.points}</span>}
                        </span>
                        {overdue && <span className="text-2xs text-destructive">{t("overdue")}</span>}
                      </span>
                    }
                    meta={
                      person ? (
                        <PersonAvatar
                          name={person.name}
                          color={person.color}
                          avatarUrl={person.avatar_url}
                          size={24}
                        />
                      ) : undefined
                    }
                  />
                </Fragment>
              );
            });
          })()}
          {displayTodos.length === 0 && (
            <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
              <CheckCircle2 className="mb-2 size-8 text-success/40" strokeWidth={1.75} />
              <p className="text-sm">{t("emptyState")}</p>
            </div>
          )}
        </motion.div>
        {totalOpen > maxItems && (
          <Link
            href="/todos"
            className="mt-3 flex w-full items-center justify-center gap-1 border-t border-border/40 pt-3 text-sm text-primary/70 transition-colors hover:text-primary"
          >
            <span>{t("moreCount", { count: totalOpen - maxItems })}</span>
            <ChevronRight className="size-3" />
          </Link>
        )}
      </WidgetCard>
    </motion.div>
  );
}

export { TasksWidgetSkeleton };
