"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  Circle,
  Plus,
  Trash2,
  X,
  Calendar as CalendarIcon,
  User,
  Filter,
  Repeat,
  Repeat1,
  Repeat2,
  CalendarClock,
  Loader2,
  AlertTriangle,
  Clock,
  ListChecks,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useTranslations, useLocale } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamilyStore } from "@/stores/family-store";
import { showUndoToast } from "@/lib/undo-toast";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/error-state";
import { FAB } from "@/components/fab";
import {
  useTodos,
  useCreateTodo,
  useUpdateTodo,
  useDeleteTodo,
  usePeople,
  useKeyboardShortcuts,
  useSwipeNavigation,
  queryKeys,
} from "@/hooks";
import { comparePriority } from "@/lib/todo-priority";
import { isRecurringTaskDue } from "@/lib/todo-recurrence";
import type { Todo } from "@/types/database";

// Priority types and config
type Priority = "low" | "medium" | "high";
type RecurrenceType = "once" | "daily" | "weekly" | "biweekly" | "monthly";

const PRIORITY_COLORS: Record<Priority, string> = {
  low: "bg-priority-low",
  medium: "bg-priority-medium",
  high: "bg-priority-high",
};

const RECURRENCE_ICON_MAP: Record<RecurrenceType, LucideIcon | null> = {
  once: null,
  daily: Repeat,
  weekly: Repeat1,
  biweekly: Repeat2,
  monthly: CalendarClock,
};

function TodosSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3 p-4 rounded-xl bg-white/5">
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="size-2 rounded-full" />
          <div className="flex-1 flex flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TodosPage() {
  // Enable keyboard shortcuts and swipe navigation
  useKeyboardShortcuts();
  useSwipeNavigation();

  const t = useTranslations("todos");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);
  const RECURRENCE_LABELS: Record<RecurrenceType, string> = {
    once: t("recurrence.once"),
    daily: t("recurrence.daily"),
    weekly: t("recurrence.weekly"),
    biweekly: t("recurrence.biweekly"),
    monthly: t("recurrence.monthly"),
  };

  const [quickAddTitle, setQuickAddTitle] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPerson, setNewTaskPerson] = useState<string>("");
  const [newTaskDueDate, setNewTaskDueDate] = useState<Date | undefined>();
  const [newTaskPriority, setNewTaskPriority] = useState<Priority>("medium");
  const [newTaskRecurrence, setNewTaskRecurrence] = useState<RecurrenceType>("once");
  const [filterPerson, setFilterPerson] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "completed">("all");
  const [filterRecurrence, setFilterRecurrence] = useState<"all" | "recurring" | "once">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPerson, setEditPerson] = useState<string>("");
  const [editDueDate, setEditDueDate] = useState<Date | undefined>();
  const [editPriority, setEditPriority] = useState<Priority>("medium");
  const [editRecurrence, setEditRecurrence] = useState<RecurrenceType>("once");

  // Fetch data from Supabase
  const { data: todos, isLoading: loadingTodos, error: todosError, refetch: refetchTodos } = useTodos();
  const { data: people, isLoading: loadingPeople, error: peopleError, refetch: refetchPeople } = usePeople();
  const createTodo = useCreateTodo();
  const updateTodo = useUpdateTodo();
  const deleteTodo = useDeleteTodo();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  const isLoading = loadingTodos || loadingPeople;
  const error = todosError || peopleError;

  const handleRetry = () => {
    if (todosError) refetchTodos();
    if (peopleError) refetchPeople();
  };

  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return;

    try {
      const title = newTaskTitle.trim();
      await createTodo.mutateAsync({
        title,
        person_id: newTaskPerson || null,
        due_date: newTaskDueDate ? format(newTaskDueDate, "yyyy-MM-dd") : null,
        priority: newTaskPriority,
        recurrence: newTaskRecurrence,
      });

      setNewTaskTitle("");
      setNewTaskPerson("");
      setNewTaskDueDate(undefined);
      setNewTaskPriority("medium");
      setNewTaskRecurrence("once");
      setDialogOpen(false);
    } catch {
      toast.error(t("createFailed"));
    }
  };

  const handleQuickAdd = async () => {
    if (!quickAddTitle.trim()) return;
    try {
      await createTodo.mutateAsync({
        title: quickAddTitle.trim(),
        person_id: null,
        due_date: null,
        priority: "medium",
        recurrence: "once",
      });
      setQuickAddTitle("");
    } catch {
      toast.error(t("createFailed"));
    }
  };

  const openEditDialog = (todo: Todo) => {
    setEditingTodo(todo);
    setEditTitle(todo.title);
    setEditPerson(todo.person_id || "");
    setEditDueDate(todo.due_date ? new Date(todo.due_date) : undefined);
    setEditPriority((todo.priority as Priority) || "medium");
    setEditRecurrence((todo.recurrence as RecurrenceType) || "once");
    setEditDialogOpen(true);
  };

  const handleEditTask = async () => {
    if (!editingTodo || !editTitle.trim()) return;

    try {
      await updateTodo.mutateAsync({
        id: editingTodo.id,
        title: editTitle.trim(),
        person_id: editPerson || null,
        due_date: editDueDate ? format(editDueDate, "yyyy-MM-dd") : null,
        priority: editPriority,
        recurrence: editRecurrence,
      });

      setEditDialogOpen(false);
      setEditingTodo(null);
    } catch {
      toast.error(t("updateFailed"));
    }
  };

  const handleToggleTask = async (id: string, completed: boolean, recurrence?: string) => {
    try {
      // For recurring tasks, update last_completed instead of marking as completed
      if (recurrence && recurrence !== "once") {
        await updateTodo.mutateAsync({
          id,
          last_completed: new Date().toISOString(),
          completed: false,
        });
      } else {
        await updateTodo.mutateAsync({
          id,
          completed: !completed,
        });
      }
    } catch {
      toast.error(t("toggleFailed"));
    }
  };

  const handleDeleteTask = async (id: string) => {
    const taskSnapshot = (todos || []).find((task) => task.id === id);
    try {
      await deleteTodo.mutateAsync(id);
      if (taskSnapshot) {
        showUndoToast({
          message: t("todoDeleted"),
          undoLabel: tCommon("undo"),
          errorMessage: tCommon("undoFailed"),
          onUndo: async () => {
            const supabase = createClient();

            const { error } = await (supabase as any).from("todos").insert(taskSnapshot);
            if (error) throw error;
            if (family?.id) {
              queryClient.invalidateQueries({ queryKey: queryKeys.todos(family.id) });
            }
          },
        });
      }
    } catch {
      toast.error(t("deleteFailed"));
    }
  };

  const handleDeleteCompleted = async () => {
    const completedTodos = (todos || []).filter((t) => t.completed);
    if (completedTodos.length === 0) return;
    try {
      await Promise.all(completedTodos.map((t) => deleteTodo.mutateAsync(t.id)));
      toast.success(t("deleteCompletedToast", { count: completedTodos.length }));
    } catch {
      toast.error(t("deleteCompletedFailed"));
    }
  };

  const getPersonById = (id: string | null) =>
    people?.find((p) => p.id === id);


  // Get effective due date considering recurrence
  const getEffectiveDueDate = (todo: { recurrence?: string | null; last_completed?: string | null; due_date?: string | null }): Date | null => {
    if (!todo.recurrence || todo.recurrence === "once") {
      return todo.due_date ? new Date(todo.due_date) : null;
    }

    if (!todo.last_completed) {
      return todo.due_date ? new Date(todo.due_date) : new Date();
    }

    const lastCompleted = new Date(todo.last_completed);
    switch (todo.recurrence) {
      case "daily":
        return new Date(lastCompleted.getTime() + 1 * 24 * 60 * 60 * 1000);
      case "weekly":
        return new Date(lastCompleted.getTime() + 7 * 24 * 60 * 60 * 1000);
      case "biweekly":
        return new Date(lastCompleted.getTime() + 14 * 24 * 60 * 60 * 1000);
      case "monthly":
        return new Date(lastCompleted.getTime() + 30 * 24 * 60 * 60 * 1000);
      default:
        return null;
    }
  };

  // Filter tasks (memoized)
  const filteredTasks = useMemo(() => (todos || []).filter((task) => {
    if (filterPerson !== "all" && task.person_id !== filterPerson) return false;
    if (filterStatus === "active" && task.completed) return false;
    if (filterStatus === "completed" && !task.completed) return false;
    if (filterRecurrence === "recurring" && (!task.recurrence || task.recurrence === "once")) return false;
    if (filterRecurrence === "once" && task.recurrence && task.recurrence !== "once") return false;
    return true;
  }), [todos, filterPerson, filterStatus, filterRecurrence]);

  // Sort: incomplete first, then by priority, then by due date (memoized)
  const sortedTasks = useMemo(() => [...filteredTasks].sort((a, b) => {
    // Completed one-time tasks go to the bottom
    if (a.completed !== b.completed) return a.completed ? 1 : -1;

    // Due recurring tasks come first
    const aRecurringDue = isRecurringTaskDue(a);
    const bRecurringDue = isRecurringTaskDue(b);
    if (aRecurringDue !== bRecurringDue) return aRecurringDue ? -1 : 1;

    const byPriority = comparePriority(a, b);
    if (byPriority !== 0) return byPriority;

    const aEffectiveDue = getEffectiveDueDate(a);
    const bEffectiveDue = getEffectiveDueDate(b);
    if (aEffectiveDue && bEffectiveDue) {
      return aEffectiveDue.getTime() - bEffectiveDue.getTime();
    }
    return aEffectiveDue ? -1 : 1;
  }), [filteredTasks]);

  const { totalCount, completedCount, activeCount, recurringCount } = useMemo(() => {
    const all = todos || [];
    return {
      totalCount: all.length,
      completedCount: all.filter((t) => t.completed).length,
      activeCount: all.filter((t) => !t.completed).length,
      recurringCount: all.filter((t) => t.recurrence && t.recurrence !== "once").length,
    };
  }, [todos]);

  return (
    <TooltipProvider>
      <main id="main-content" className="min-h-screen relative overflow-hidden">
        {/* Background */}
        <div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none" />

        <div className="relative z-10 p-4 md:p-8 max-w-6xl mx-auto safe-area-inset overflow-x-hidden">
          <PageHeader
            title={t("title")}
            subtitle={t("subtitle", { active: activeCount, recurring: recurringCount, completed: completedCount })}
            backHref="/"
            className="mb-8"
            iconSlot={
              <div
                className="relative size-11 shrink-0"
                role="img"
                aria-label={t("progressAria", { percent: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0, completed: completedCount, total: totalCount })}
              >
                <svg viewBox="0 0 44 44" className="size-11 -rotate-90" aria-hidden="true">
                  <circle
                    cx="22" cy="22" r="18"
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity="0.1"
                    strokeWidth="3"
                  />
                  <circle
                    cx="22" cy="22" r="18"
                    fill="none"
                    stroke="hsl(var(--month-primary))"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 18}`}
                    strokeDashoffset={`${2 * Math.PI * 18 * (1 - (totalCount > 0 ? completedCount / totalCount : 0))}`}
                    className="transition-all duration-700"
                  />
                </svg>
                <span
                  className="absolute inset-0 flex items-center justify-center text-xs font-bold text-month-primary tabular-nums"
                  aria-hidden="true"
                >
                  {totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0}%
                </span>
              </div>
            }
            actions={
              <>
              {/* Clear filters button */}
              {(filterPerson !== "all" || filterStatus !== "all" || filterRecurrence !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-month-primary hover:text-month-primary"
                  onClick={() => {
                    setFilterPerson("all");
                    setFilterStatus("all");
                    setFilterRecurrence("all");
                  }}
                >
                  <X className="size-3.5" />
                  {t("filterClear")}
                </Button>
              )}

              {/* Filter by Person */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant={filterPerson !== "all" ? "default" : "outline"} size="sm" className="gap-2">
                    <User className="size-4" />
                    {filterPerson === "all"
                      ? t("filterAll")
                      : getPersonById(filterPerson)?.name || t("filterAll")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{t("filterByPerson")}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setFilterPerson("all")}>
                    {t("filterAll")}
                  </DropdownMenuItem>
                  {(people || []).map((person) => (
                    <DropdownMenuItem
                      key={person.id}
                      onClick={() => setFilterPerson(person.id)}
                    >
                      <div
                        className="size-3 rounded-full mr-2"
                        style={{ backgroundColor: person.color }}
                      />
                      {person.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Filter by Status */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant={filterStatus !== "all" ? "default" : "outline"} size="sm" className="gap-2">
                    <Filter className="size-4" />
                    {filterStatus === "all"
                      ? t("filterAll")
                      : filterStatus === "active"
                      ? t("filterStatusOpen")
                      : t("filterStatusDone")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{t("filterStatus")}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setFilterStatus("all")}>
                    {t("filterAll")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFilterStatus("active")}>
                    {t("filterStatusOpen")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFilterStatus("completed")}>
                    {t("filterStatusDone")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Filter by Recurrence */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant={filterRecurrence !== "all" ? "default" : "outline"} size="sm" className="gap-2">
                    <Repeat className="size-4" />
                    {filterRecurrence === "all"
                      ? t("filterAll")
                      : filterRecurrence === "recurring"
                      ? t("filterRecurring")
                      : t("filterOnce")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{t("filterRecurrence")}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setFilterRecurrence("all")}>
                    {t("filterAll")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFilterRecurrence("recurring")}>
                    {t("filterRecurring")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFilterRecurrence("once")}>
                    {t("filterOnce")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Delete Completed Button */}
              {completedCount > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 text-destructive hover:text-destructive"
                      disabled={deleteTodo.isPending}
                    >
                      <Trash2 className="size-4" />
                      {t("deleteCompletedButton", { count: completedCount })}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("deleteCompletedTitle")}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("deleteCompletedMessage", { count: completedCount })}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDeleteCompleted}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {tCommon("delete")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}

              {/* Add Task Button */}
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="hidden sm:inline-flex gap-2">
                    <Plus className="size-4" />
                    {t("newButton")}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t("createDialogTitle")}</DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-col gap-4 pt-4">
                    <div className="flex flex-col gap-2">
                      <Label>{t("fieldTitle")}</Label>
                      <Input
                        placeholder={t("titlePlaceholder")}
                        value={newTaskTitle}
                        onChange={(e) => setNewTaskTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAddTask();
                        }}
                        autoFocus
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="flex flex-col gap-2">
                        <Label>{t("fieldAssignTo")}</Label>
                        <Select value={newTaskPerson} onValueChange={setNewTaskPerson}>
                          <SelectTrigger>
                            <SelectValue placeholder={t("fieldOptional")} />
                          </SelectTrigger>
                          <SelectContent>
                            {(people || []).map((person) => (
                              <SelectItem key={person.id} value={person.id}>
                                <div className="flex items-center gap-2">
                                  <div
                                    className="size-3 rounded-full"
                                    style={{ backgroundColor: person.color }}
                                  />
                                  {person.name}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex flex-col gap-2">
                        <Label>{t("fieldPriority")}</Label>
                        <Select
                          value={newTaskPriority}
                          onValueChange={(v) =>
                            setNewTaskPriority(v as Priority)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">
                              <div className="flex items-center gap-2">
                                <div className="size-2 rounded-full bg-priority-low" />
                                {t("priority.low")}
                              </div>
                            </SelectItem>
                            <SelectItem value="medium">
                              <div className="flex items-center gap-2">
                                <div className="size-2 rounded-full bg-priority-medium" />
                                {t("priority.medium")}
                              </div>
                            </SelectItem>
                            <SelectItem value="high">
                              <div className="flex items-center gap-2">
                                <div className="size-2 rounded-full bg-priority-high" />
                                {t("priority.high")}
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="flex flex-col gap-2">
                        <Label>{t("fieldRecurrence")}</Label>
                        <Select
                          value={newTaskRecurrence || "once"}
                          onValueChange={(v) => setNewTaskRecurrence(v as RecurrenceType)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="once">
                              <div className="flex items-center gap-2">{t("recurrence.once")}</div>
                            </SelectItem>
                            <SelectItem value="daily">
                              <div className="flex items-center gap-2">
                                <Repeat className="size-4 text-muted-foreground" /> {t("recurrence.daily")}
                              </div>
                            </SelectItem>
                            <SelectItem value="weekly">
                              <div className="flex items-center gap-2">
                                <Repeat1 className="size-4 text-muted-foreground" /> {t("recurrence.weekly")}
                              </div>
                            </SelectItem>
                            <SelectItem value="biweekly">
                              <div className="flex items-center gap-2">
                                <Repeat2 className="size-4 text-muted-foreground" /> {t("recurrence.biweekly")}
                              </div>
                            </SelectItem>
                            <SelectItem value="monthly">
                              <div className="flex items-center gap-2">
                                <CalendarClock className="size-4 text-muted-foreground" /> {t("recurrence.monthly")}
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex flex-col gap-2">
                        <Label>{t("fieldDueDate")}</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className="w-full justify-start text-left font-normal"
                            >
                              <CalendarIcon className="mr-2 size-4" />
                              {newTaskDueDate
                                ? format(newTaskDueDate, "PPP", { locale: dateLocale })
                                : t("fieldOptional")}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={newTaskDueDate}
                              onSelect={setNewTaskDueDate}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>

                    <Button
                      className="w-full"
                      onClick={handleAddTask}
                      disabled={!newTaskTitle.trim() || createTodo.isPending}
                    >
                      {createTodo.isPending ? (
                        <>
                          <Loader2 className="size-4 mr-2 animate-spin" />
                          {t("creating")}
                        </>
                      ) : (
                        t("createAction")
                      )}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
              </>
            }
          />

          {/* Overview Stat Cards */}
          {!isLoading && !error && (todos || []).length > 0 && (() => {
            const now = new Date();
            const todayStr = now.toDateString();
            const allTodos = todos || [];
            const overdueCount = allTodos.filter((t) => {
              const ed = getEffectiveDueDate(t);
              return ed && !t.completed && ed < now && ed.toDateString() !== todayStr;
            }).length;
            const dueTodayCount = allTodos.filter((t) => {
              const ed = getEffectiveDueDate(t);
              if (!ed || t.completed) return false;
              return ed.toDateString() === todayStr;
            }).length;
            const recurringDueCount = allTodos.filter((t) => isRecurringTaskDue(t)).length;
            const completionPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

            const statCards = [
              { label: t("statOpen"), value: activeCount, icon: ListChecks, color: "text-month-primary", bg: "bg-month-primary/10", border: "border-month-primary/20" },
              { label: t("statOverdue"), value: overdueCount, icon: AlertTriangle, color: overdueCount > 0 ? "text-destructive" : "text-muted-foreground", bg: overdueCount > 0 ? "bg-destructive/10" : "bg-white/5", border: overdueCount > 0 ? "border-destructive/20" : "border-border/20" },
              { label: t("statToday"), value: dueTodayCount, icon: Clock, color: dueTodayCount > 0 ? "text-amber-400" : "text-muted-foreground", bg: dueTodayCount > 0 ? "bg-amber-400/10" : "bg-white/5", border: dueTodayCount > 0 ? "border-amber-400/20" : "border-border/20" },
              { label: t("statRecurring"), value: recurringDueCount, icon: Repeat, color: recurringDueCount > 0 ? "text-blue-400" : "text-muted-foreground", bg: recurringDueCount > 0 ? "bg-blue-400/10" : "bg-white/5", border: recurringDueCount > 0 ? "border-blue-400/20" : "border-border/20" },
            ];

            return (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="mb-6 space-y-3"
              >
                {/* Progress bar */}
                <div className="flex items-center gap-3 px-1">
                  <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${completionPercent}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                      className="h-full rounded-full bg-gradient-to-r from-month-primary/80 to-month-primary"
                    />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                    {t("progressDoneCount", { completed: completedCount, total: totalCount })}
                  </span>
                </div>

                {/* Stat cards grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                  {statCards.map((stat, i) => (
                    <motion.div
                      key={stat.label}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.08 + i * 0.04 }}
                      className={`rounded-xl ${stat.bg} border ${stat.border} p-3 flex items-center gap-3`}
                    >
                      <stat.icon className={`size-5 ${stat.color} shrink-0`} />
                      <div className="min-w-0">
                        <p className={`text-kiosk-primary ${stat.color}`}>{stat.value}</p>
                        <p className="text-kiosk-label mt-1 truncate">{stat.label}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            );
          })()}

          {/* Quick Add Input */}
          {!isLoading && !error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
              className="mb-4"
            >
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-border/30 focus-within:border-month-primary/50 focus-within:ring-1 focus-within:ring-month-primary/20 transition-all">
                <Plus className="size-4 text-muted-foreground shrink-0" />
                <input
                  type="text"
                  placeholder={t("quickAddPlaceholder")}
                  value={quickAddTitle}
                  onChange={(e) => setQuickAddTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleQuickAdd();
                  }}
                  className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground/60"
                  aria-label={t("quickAddAria")}
                />
                {quickAddTitle.trim() && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-month-primary hover:text-month-primary"
                    onClick={handleQuickAdd}
                    disabled={createTodo.isPending}
                  >
                    {createTodo.isPending ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      t("quickAddSubmit")
                    )}
                  </Button>
                )}
              </div>
            </motion.div>
          )}

          {/* Tasks List */}
          {error ? (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <Card className="p-2">
                <ErrorState
                  onRetry={handleRetry}
                  message={t("errorMessage")}
                />
              </Card>
            </motion.div>
          ) : isLoading ? (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <Card className="p-2">
                <TodosSkeleton />
              </Card>
            </motion.div>
          ) : sortedTasks.length === 0 ? (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <Card className="p-8">
                {filterPerson !== "all" || filterStatus !== "all" || filterRecurrence !== "all" ? (
                  <EmptyState
                    icon={Filter}
                    title={t("emptyFilteredTitle")}
                    description={t("emptyFilteredDescription")}
                    action={{
                      label: t("filterClear"),
                      onClick: () => {
                        setFilterPerson("all");
                        setFilterStatus("all");
                        setFilterRecurrence("all");
                      },
                    }}
                  />
                ) : (
                  <EmptyState
                    icon={CheckCircle2}
                    title={t("emptyAllDoneTitle")}
                    description={t("emptyAllDoneDescription")}
                  />
                )}
              </Card>
            </motion.div>
          ) : (
            <AnimatePresence mode="popLayout">
              {/* Group tasks into sections */}
              {(() => {
                const now = new Date();
                const todayStr = now.toDateString();

                const overdueTasks = sortedTasks.filter((t) => {
                  if (t.completed) return false;
                  const ed = getEffectiveDueDate(t);
                  return ed && ed < now && ed.toDateString() !== todayStr;
                });

                const recurringDueTasks = sortedTasks.filter((t) => {
                  if (t.completed) return false;
                  if (overdueTasks.includes(t)) return false;
                  return isRecurringTaskDue(t);
                });

                const dueTodayTasks = sortedTasks.filter((t) => {
                  if (t.completed) return false;
                  if (overdueTasks.includes(t)) return false;
                  if (recurringDueTasks.includes(t)) return false;
                  const ed = getEffectiveDueDate(t);
                  return ed && ed.toDateString() === todayStr;
                });

                const upcomingTasks = sortedTasks.filter((t) => {
                  if (t.completed) return false;
                  if (overdueTasks.includes(t)) return false;
                  if (recurringDueTasks.includes(t)) return false;
                  if (dueTodayTasks.includes(t)) return false;
                  return true;
                });

                const completedTasks = sortedTasks.filter((t) => t.completed);

                type TaskSection = {
                  key: string;
                  label: string;
                  icon: LucideIcon;
                  tasks: typeof sortedTasks;
                  accentClass: string;
                  borderClass: string;
                };

                const sections: TaskSection[] = [
                  { key: "overdue", label: t("sectionOverdue"), icon: CalendarIcon, tasks: overdueTasks, accentClass: "text-destructive", borderClass: "border-l-destructive" },
                  { key: "recurring", label: t("sectionRecurringDue"), icon: Repeat, tasks: recurringDueTasks, accentClass: "text-blue-400", borderClass: "border-l-blue-400" },
                  { key: "today", label: t("sectionToday"), icon: CalendarIcon, tasks: dueTodayTasks, accentClass: "text-month-primary", borderClass: "border-l-month-primary" },
                  { key: "upcoming", label: t("sectionUpcoming"), icon: Circle, tasks: upcomingTasks, accentClass: "text-muted-foreground", borderClass: "border-l-muted-foreground/30" },
                  { key: "completed", label: t("sectionCompleted"), icon: CheckCircle2, tasks: completedTasks, accentClass: "text-success", borderClass: "border-l-success/30" },
                ].filter((s) => s.tasks.length > 0);

                let globalIndex = 0;

                return (
                  <div className="flex flex-col gap-4">
                    {sections.map((section, sIndex) => (
                      <motion.div
                        key={section.key}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 + sIndex * 0.05 }}
                      >
                        {/* Section header */}
                        <div className={`flex items-center gap-2 mb-2 px-1 ${section.accentClass}`}>
                          <section.icon className="size-4" />
                          <span className="text-kiosk-label">{section.label}</span>
                          <span className="text-xs opacity-60">({section.tasks.length})</span>
                        </div>

                        <Card className={`p-1.5 border-l-2 ${section.borderClass}`}>
                          <div className="flex flex-col gap-0.5">
                            {section.tasks.map((task) => {
                              const person = getPersonById(task.person_id);
                              const effectiveDue = getEffectiveDueDate(task);
                              const isOverdue = effectiveDue && !task.completed && effectiveDue < now;
                              const isRecurring = task.recurrence && task.recurrence !== "once";
                              const isDue = isRecurringTaskDue(task);
                              const priority = (task.priority as Priority) || "medium";
                              const itemIndex = globalIndex++;

                              return (
                                <motion.div
                                  key={task.id}
                                  layout
                                  initial={{ opacity: 0, x: -20 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  exit={{ opacity: 0, x: 20, scale: 0.95 }}
                                  transition={{ delay: itemIndex * 0.02 }}
                                  className={`group flex items-center gap-3 p-3.5 sm:p-4 rounded-xl transition-all hover:bg-white/5 overflow-hidden border-l-2 ${
                                    task.completed ? "opacity-50 border-l-success/30" :
                                    priority === "high" ? "border-l-priority-high" :
                                    priority === "medium" ? "border-l-priority-medium" :
                                    "border-l-priority-low"
                                  } ${isRecurring && isDue ? "ring-1 ring-month-primary/30 bg-month-primary/5" : ""}`}
                                >
                                  {/* Checkbox / Complete button */}
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        onClick={() => handleToggleTask(task.id, task.completed, task.recurrence || undefined)}
                                        className="shrink-0 -m-2.5 p-2.5 rounded-full"
                                        disabled={updateTodo.isPending}
                                        aria-label={task.completed ? t("toggleAriaIncomplete", { title: task.title }) : t("toggleAriaComplete", { title: task.title })}
                                      >
                                        {task.completed ? (
                                          <CheckCircle2 className="size-6 text-success" />
                                        ) : isRecurring ? (
                                          <Repeat className={`size-6 ${isDue ? "text-month-primary" : "text-muted-foreground"} hover:text-foreground transition-colors`} />
                                        ) : (
                                          <Circle className="size-6 text-muted-foreground hover:text-foreground transition-colors" />
                                        )}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {isRecurring ? t("toggleTooltipRecurring") : t("toggleTooltip")}
                                    </TooltipContent>
                                  </Tooltip>

                                  {/* Priority indicator - visible on mobile since border-l may be subtle */}
                                  {priority === "high" && !task.completed && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className="size-2 rounded-full shrink-0 bg-priority-high animate-pulse" />
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {t("highPriorityTooltip")}
                                      </TooltipContent>
                                    </Tooltip>
                                  )}

                                  {/* Content - clickable for editing */}
                                  <div
                                    className="flex-1 min-w-0 cursor-pointer"
                                    onClick={() => openEditDialog(task)}
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <p
                                        className={`font-medium truncate ${
                                          task.completed
                                            ? "line-through text-muted-foreground"
                                            : ""
                                        }`}
                                      >
                                        {task.title}
                                      </p>
                                      {isRecurring && task.recurrence && (() => {
                                        const RecurrenceIcon = RECURRENCE_ICON_MAP[task.recurrence as RecurrenceType];
                                        if (!RecurrenceIcon) return null;
                                        return (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <span className="shrink-0">
                                                <RecurrenceIcon className="size-3.5 text-muted-foreground" />
                                              </span>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              {RECURRENCE_LABELS[task.recurrence as RecurrenceType]}
                                            </TooltipContent>
                                          </Tooltip>
                                        );
                                      })()}
                                    </div>
                                    <div className="flex items-center gap-2 mt-1 flex-wrap min-w-0">
                                      {person && (
                                        <Badge
                                          variant="outline"
                                          className="text-xs"
                                          style={{
                                            borderColor: person.color,
                                            color: person.color,
                                          }}
                                        >
                                          {person.name}
                                        </Badge>
                                      )}
                                      {effectiveDue && (() => {
                                        const today = new Date();
                                        const dueDate = new Date(effectiveDue);
                                        const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                                        const isToday = dueDate.toDateString() === today.toDateString();
                                        const isTomorrow = diffDays === 1 || (diffDays === 0 && dueDate.getDate() !== today.getDate());

                                        let label: string;
                                        let colorClass: string;
                                        if (isOverdue) {
                                          const overdueDays = Math.abs(diffDays);
                                          label = t("overdueByDays", { count: overdueDays });
                                          colorClass = "text-destructive";
                                        } else if (isToday) {
                                          label = t("dueToday");
                                          colorClass = "text-month-primary";
                                        } else if (isTomorrow) {
                                          label = t("dueTomorrow");
                                          colorClass = "text-month-primary";
                                        } else if (diffDays <= 7) {
                                          label = t("dueInDays", { count: diffDays });
                                          colorClass = "text-muted-foreground";
                                        } else {
                                          label = format(effectiveDue, "d. MMM", { locale: dateLocale });
                                          colorClass = "text-muted-foreground";
                                        }

                                        return (
                                          <span className={`text-xs flex items-center gap-1 ${colorClass}`}>
                                            <CalendarIcon className="size-3" />
                                            {label}
                                          </span>
                                        );
                                      })()}
                                      {isRecurring && task.last_completed && (
                                        <span className="text-xs text-muted-foreground">
                                          {t("lastDone", { date: format(new Date(task.last_completed), "d. MMM", { locale: dateLocale }) })}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Delete button */}
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-destructive hover:text-destructive shrink-0"
                                    onClick={() => handleDeleteTask(task.id)}
                                    disabled={deleteTodo.isPending}
                                    aria-label={t("deleteAria", { title: task.title })}
                                  >
                                    <Trash2 className="size-4" />
                                  </Button>
                                </motion.div>
                              );
                            })}
                          </div>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                );
              })()}
            </AnimatePresence>
          )}

        </div>

        {/* Edit Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("editDialogTitle")}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 pt-4">
              <div className="flex flex-col gap-2">
                <Label>{t("fieldTitle")}</Label>
                <Input
                  placeholder={t("titlePlaceholder")}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleEditTask();
                  }}
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label>{t("fieldAssignTo")}</Label>
                  <Select value={editPerson} onValueChange={setEditPerson}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("fieldOptional")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(people || []).map((person) => (
                        <SelectItem key={person.id} value={person.id}>
                          <div className="flex items-center gap-2">
                            <div
                              className="size-3 rounded-full"
                              style={{ backgroundColor: person.color }}
                            />
                            {person.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>{t("fieldPriority")}</Label>
                  <Select
                    value={editPriority}
                    onValueChange={(v) => setEditPriority(v as Priority)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">
                        <div className="flex items-center gap-2">
                          <div className="size-2 rounded-full bg-priority-low" />
                          {t("priority.low")}
                        </div>
                      </SelectItem>
                      <SelectItem value="medium">
                        <div className="flex items-center gap-2">
                          <div className="size-2 rounded-full bg-priority-medium" />
                          {t("priority.medium")}
                        </div>
                      </SelectItem>
                      <SelectItem value="high">
                        <div className="flex items-center gap-2">
                          <div className="size-2 rounded-full bg-priority-high" />
                          {t("priority.high")}
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label>{t("fieldRecurrence")}</Label>
                  <Select
                    value={editRecurrence || "once"}
                    onValueChange={(v) => setEditRecurrence(v as RecurrenceType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="once">
                        <div className="flex items-center gap-2">{t("recurrence.once")}</div>
                      </SelectItem>
                      <SelectItem value="daily">
                        <div className="flex items-center gap-2">
                          <Repeat className="size-4 text-muted-foreground" /> {t("recurrence.daily")}
                        </div>
                      </SelectItem>
                      <SelectItem value="weekly">
                        <div className="flex items-center gap-2">
                          <Repeat1 className="size-4 text-muted-foreground" /> {t("recurrence.weekly")}
                        </div>
                      </SelectItem>
                      <SelectItem value="biweekly">
                        <div className="flex items-center gap-2">
                          <Repeat2 className="size-4 text-muted-foreground" /> {t("recurrence.biweekly")}
                        </div>
                      </SelectItem>
                      <SelectItem value="monthly">
                        <div className="flex items-center gap-2">
                          <CalendarClock className="size-4 text-muted-foreground" /> {t("recurrence.monthly")}
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>{t("fieldDueDate")}</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start text-left font-normal"
                      >
                        <CalendarIcon className="mr-2 size-4" />
                        {editDueDate
                          ? format(editDueDate, "PPP", { locale: dateLocale })
                          : t("fieldOptional")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={editDueDate}
                        onSelect={setEditDueDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <Button
                className="w-full"
                onClick={handleEditTask}
                disabled={!editTitle.trim() || updateTodo.isPending}
              >
                {updateTodo.isPending ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    {t("saving")}
                  </>
                ) : (
                  tCommon("save")
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Mobile add FAB — desktop uses the header button */}
        <FAB
          icon={Plus}
          onClick={() => setDialogOpen(true)}
          ariaLabel={t("newButton")}
          className="sm:hidden"
        />
      </main>
    </TooltipProvider>
  );
}
