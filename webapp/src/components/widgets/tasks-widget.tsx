"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useTranslations, useLocale } from "next-intl";
import { getIntlLocale } from "@/i18n/intl-locale";
import {
  CheckSquare,
  Circle,
  CheckCircle2,
  ChevronRight,
  AlertCircle,
  Repeat,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { useTodos, useUpdateTodo, usePeople } from "@/hooks";
import { toast } from "sonner";
import type { Todo } from "@/types/database";
import { useState } from "react";

interface TasksWidgetProps {
  maxItems?: number;
  className?: string;
}

function TasksWidgetSkeleton() {
  const t = useTranslations("tasksWidget");
  return (
    <Card aria-label={t("loadingAria")} aria-busy="true">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded" />
          <Skeleton className="h-5 w-24" />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-3/4 rounded-lg" />
      </CardContent>
    </Card>
  );
}

function getPriorityColor(priority: string): string {
  switch (priority) {
    case "high":
    case "3":
      return "text-red-400";
    case "medium":
    case "2":
      return "text-amber-400";
    default:
      return "text-muted-foreground";
  }
}

function isOverdue(todo: Todo): boolean {
  if (!todo.due_date || todo.completed) return false;
  const today = new Date().toISOString().split("T")[0];
  return todo.due_date < today;
}

function isDueToday(todo: Todo): boolean {
  if (!todo.due_date || todo.completed) return false;
  const today = new Date().toISOString().split("T")[0];
  return todo.due_date === today;
}

export function TasksWidget({
  maxItems = 5,
  className = "",
}: TasksWidgetProps) {
  const t = useTranslations("tasksWidget");
  const locale = useLocale();
  const intlLocale = getIntlLocale(locale);
  const { data: todos, isLoading, isError } = useTodos();
  const { data: people } = usePeople();
  const updateTodo = useUpdateTodo();
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Sort: overdue first, then due today, then by priority, then by date
  const openTodos = useMemo(() => {
    if (!todos) return [];
    return todos
      .filter((t) => !t.completed)
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
        const aPri = parseInt(a.priority) || 0;
        const bPri = parseInt(b.priority) || 0;
        if (aPri !== bPri) return bPri - aPri;

        // Oldest first
        return a.created_at.localeCompare(b.created_at);
      });
  }, [todos]);

  const displayTodos = openTodos.slice(0, maxItems);
  const totalOpen = openTodos.length;

  const handleToggle = async (todo: Todo) => {
    setTogglingId(todo.id);
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
    } finally {
      setTogglingId(null);
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
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-xl font-medium">
            <span className="p-1.5 rounded-lg bg-month-primary/10">
              <CheckSquare className="size-5 text-month-primary" strokeWidth={1.5} />
            </span>
            {t("title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
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

  const item = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0 },
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.55 }}
    >
      <Card className={`accent-border-top h-full ${className}`}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-xl font-medium">
              <span className="p-1.5 rounded-lg bg-month-primary/10">
                <CheckSquare className="size-5 text-month-primary" strokeWidth={1.5} />
              </span>
              {t("title")}
            </CardTitle>
            {totalOpen > 0 && (
              <Badge
                variant="secondary"
                className="text-xs tabular-nums"
              >
                {t("openCount", { count: totalOpen })}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="flex flex-col gap-1.5"
          >
            {displayTodos.map((todo) => {
              const person = getPersonName(todo.person_id);
              const overdue = isOverdue(todo);
              const dueToday = isDueToday(todo);
              const isRecurring = todo.recurrence && todo.recurrence !== "once";
              const priorityColor = getPriorityColor(todo.priority);

              return (
                <motion.div
                  key={todo.id}
                  variants={item}
                  className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 -mx-1 transition-colors hover:bg-accent/50"
                >
                  <button
                    onClick={() => handleToggle(todo)}
                    disabled={updateTodo.isPending}
                    className={`shrink-0 transition-colors ${priorityColor} hover:text-month-primary`}
                    aria-label={t("toggleAria", { title: todo.title })}
                  >
                    {updateTodo.isPending ? (
                      <Loader2 className="size-4.5 animate-spin" />
                    ) : (
                      <Circle className="size-4.5" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-tight truncate">{todo.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {overdue && (
                        <span className="flex items-center gap-0.5 text-[10px] text-red-400">
                          <AlertCircle className="size-2.5" />
                          {t("overdue")}
                        </span>
                      )}
                      {dueToday && !overdue && (
                        <span className="text-[10px] text-amber-400">{t("today")}</span>
                      )}
                      {todo.due_date && !overdue && !dueToday && (
                        <span className="text-[10px] text-muted-foreground/60">
                          {new Date(todo.due_date).toLocaleDateString(intlLocale, {
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                      )}
                      {isRecurring && (
                        <Repeat className="size-2.5 text-muted-foreground/50" />
                      )}
                      {person && (
                        <span
                          className="text-[10px] px-1 rounded"
                          style={{
                            color: person.color,
                            backgroundColor: `${person.color}15`,
                          }}
                        >
                          {person.name}
                        </span>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}

            {displayTodos.length === 0 && (
              <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                <CheckCircle2 className="size-8 mb-2 text-emerald-500/30" />
                <p className="text-sm">{t("emptyState")}</p>
              </div>
            )}
          </motion.div>

          {totalOpen > maxItems && (
            <Link
              href="/todos"
              className="flex items-center justify-center gap-1 mt-3 pt-3 border-t border-border/30 text-sm text-month-primary/60 hover:text-month-primary transition-colors w-full"
            >
              <span>{t("moreCount", { count: totalOpen - maxItems })}</span>
              <ChevronRight className="size-3" />
            </Link>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

export { TasksWidgetSkeleton };
