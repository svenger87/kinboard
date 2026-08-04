"use client";

import { todayKey } from "@/lib/local-date";
import { useMemo } from "react";
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
import { useTodos, useUpdateTodo, usePeople } from "@/hooks";
import { toast } from "sonner";
import type { Todo } from "@/types/database";
import { WidgetCard } from "@/components/widget-card";
import { ChecklistItem } from "@/components/checklist-item";
import { comparePriority } from "@/lib/todo-priority";
import { isTodoOpen } from "@/lib/todo-recurrence";
import { PersonAvatar } from "@/components/person-avatar";

interface TasksWidgetProps {
  maxItems?: number;
  className?: string;
}

function TasksWidgetSkeleton() {
  const t = useTranslations("tasksWidget");
  return (
    <Card aria-label={t("loadingAria")} aria-busy="true">
      <CardContent className="flex flex-col gap-2 p-[18px]">
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

function isOverdue(todo: Todo): boolean {
  if (!todo.due_date || todo.completed) return false;
  const today = todayKey();
  return todo.due_date < today;
}

function isDueToday(todo: Todo): boolean {
  if (!todo.due_date || todo.completed) return false;
  const today = todayKey();
  return todo.due_date === today;
}

export function TasksWidget({
  maxItems = 5,
  className = "",
}: TasksWidgetProps) {
  const t = useTranslations("tasksWidget");
  const { data: todos, isLoading, isError } = useTodos();
  const { data: people } = usePeople();
  const updateTodo = useUpdateTodo();

  // Sort: overdue first, then due today, then by priority, then by date
  const openTodos = useMemo(() => {
    if (!todos) return [];
    return todos
      // A recurring chore ticked off today is not outstanding, even though
      // its row stays `completed: false` so it can come round again.
      .filter((t) => isTodoOpen(t))
      .sort((a, b) => {
        // Overdue first
        const aOverdue = isOverdue(a);
        const bOverdue = isOverdue(b);
        if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;

        // Due today next
        const aToday = isDueToday(a);
        const bToday = isDueToday(b);
        if (aToday !== bToday) return aToday ? -1 : 1;

        // Higher priority first
        const byPriority = comparePriority(a, b);
        if (byPriority !== 0) return byPriority;

        // Oldest first
        return a.created_at.localeCompare(b.created_at);
      });
  }, [todos]);

  const displayTodos = openTodos.slice(0, maxItems);
  const totalOpen = openTodos.length;

  const handleToggle = async (todo: Todo) => {
    try {
      if (todo.recurrence && todo.recurrence !== "once") {
        await updateTodo.mutateAsync({
          id: todo.id,
          last_completed: new Date().toISOString(),
        });
        toast.success(t("toastDoneRecurring"));
      } else {
        await updateTodo.mutateAsync({
          id: todo.id,
          completed: true,
        });
        toast.success(t("toastDoneOneTime"));
      }
    } catch {
      toast.error(t("toastUpdateFailed"));
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
        <CardContent className="p-[18px]">
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
        <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-2">
          {displayTodos.map((todo) => {
            const person = getPersonName(todo.person_id);
            const overdue = isOverdue(todo);
            const dueToday = isDueToday(todo);
            return (
              <ChecklistItem
                key={todo.id}
                checked={false}
                onCheckedChange={() => handleToggle(todo)}
                color={person?.color}
                label={
                  <span className="flex flex-col">
                    <span className="truncate leading-tight">{todo.title}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-[11px]">
                      {overdue && <span className="text-destructive">{t("overdue")}</span>}
                      {dueToday && !overdue && <span className="text-warning">{t("today")}</span>}
                    </span>
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
            );
          })}
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
