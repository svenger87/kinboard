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
  CalendarDays,
  Loader2,
  AlertTriangle,
  Clock,
  ListChecks,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { toLocalDateKey } from "@/lib/local-date";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useTranslations, useLocale } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamilyStore } from "@/stores/family-store";
import { useTodoPoints } from "@/hooks/use-todo-points";
import { pointsTotal } from "@/lib/todo-points";
import { ReactingCreature } from "@/components/pocket-money/creature-reaction";
import { useCreatures, activeCreatureOf } from "@/hooks/use-creatures";
import { usePocketMoneyAccounts } from "@/hooks/use-pocket-money-accounts";
import { useCreatureMood } from "@/hooks/use-creature-mood";
import { creatureStage } from "@/lib/creatures/stage";
import { readLook } from "@/lib/pocket-money/creatures/look";
import type { Creature, Person } from "@/types/database";
import { TodoDecorationFields } from "@/components/todo-decoration-fields";
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
import {
  formatRecurrenceDays,
  isRecurringTaskDue,
  nextWeekdayDueDate,
  recurrenceWeekdays,
} from "@/lib/todo-recurrence";
import { matchesStatus, todoCounts } from "@/lib/todo-counts";
import { WeekdayPicker, useWeekdaysLabel } from "@/components/weekday-picker";
import { TodoTurnFields, TurnStrip } from "@/components/todo-turn-fields";
import { useTodoHistory } from "@/hooks/use-todo-history";
import {
  currentDay,
  dayKeyOf,
  dayNumber,
  isScheduled,
  isTurnOpen,
  keepsSchedule,
  nextTurnDay,
  recentDays,
  todayPerson,
} from "@/lib/todo-turns";
import type { Todo } from "@/types/database";

// Priority types and config
type Priority = "low" | "medium" | "high";
// "custom" is the form's name for picked weekdays; it is stored as "days:MO,TU,...".
type RecurrenceType = "once" | "daily" | "weekly" | "biweekly" | "monthly" | "custom";

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
  custom: CalendarDays,
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

/**
 * A child in the tasks page's points row: their creature small beside the
 * name (RFC-017 §4) -- static, it moves only to cheer when one of their tasks
 * is ticked off, here or on any other screen -- and their points.
 */
function ChildChip({
  person,
  creature,
  earned,
  showPoints,
  pointsUnit,
  creatureAria,
}: {
  person: Person;
  creature: Creature | undefined;
  earned: number;
  showPoints: boolean;
  pointsUnit: string;
  creatureAria: string;
}) {
  const { data: accounts } = usePocketMoneyAccounts();
  const mood = useCreatureMood(creature ? person.id : null);
  const stage = creature
    ? creatureStage({ creature, account: accounts?.find((a) => a.person_id === person.id), earnedPoints: earned })
    : null;
  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card py-1.5 pl-2 pr-4 text-sm"
      data-testid="todo-child"
      data-person={person.id}
    >
      {creature && stage ? (
        <ReactingCreature
          personId={person.id}
          compactStageUp
          species={creature.species}
          tier={stage.tier}
          style={creature.style}
          look={readLook(creature.look)}
          mood={mood}
          size={36}
          animated={false}
          label={creatureAria}
          className="shrink-0"
        />
      ) : (
        <span className="w-2" aria-hidden="true" />
      )}
      <span className="min-w-0 truncate font-medium">{person.name}</span>
      {showPoints && (
        <span className="shrink-0 text-primary tabular-nums">⭐ {earned} {pointsUnit}</span>
      )}
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
    custom: t("recurrence.custom"),
  };

  const [quickAddTitle, setQuickAddTitle] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPerson, setNewTaskPerson] = useState<string>("");
  const [newTaskDueDate, setNewTaskDueDate] = useState<Date | undefined>();
  const [newTaskPriority, setNewTaskPriority] = useState<Priority>("medium");
  const [newTaskRecurrence, setNewTaskRecurrence] = useState<RecurrenceType>("once");
  const [newTaskDays, setNewTaskDays] = useState<number[]>([]);
  const [newTaskIcon, setNewTaskIcon] = useState("");
  const [newTaskPoints, setNewTaskPoints] = useState(0);
  // Taking turns and tracking (#341): the rotation, or null when off.
  const [newTaskTurns, setNewTaskTurns] = useState<string[] | null>(null);
  const [newTaskTrack, setNewTaskTrack] = useState(false);
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
  const [editDays, setEditDays] = useState<number[]>([]);
  const weekdaysLabel = useWeekdaysLabel();
  // The form's choice as stored: picked days become "days:MO,TU,..." -- or
  // "daily" when all seven are picked.
  const storedRecurrence = (type: RecurrenceType, days: number[]) =>
    type === "custom" ? formatRecurrenceDays(days) ?? "once" : type;
  const [editIcon, setEditIcon] = useState("");
  const [editPoints, setEditPoints] = useState(0);
  const [editTurns, setEditTurns] = useState<string[] | null>(null);
  const [editTrack, setEditTrack] = useState(false);
  // The two options only mean anything on a repeating task; a rotation with
  // nobody in it is no rotation.
  const turnFields = (type: RecurrenceType, turns: string[] | null, track: boolean) =>
    type === "once"
      ? { rotation_person_ids: null, track_completion: false }
      : { rotation_person_ids: turns && turns.length > 0 ? turns : null, track_completion: track };

  // Fetch data from Supabase
  const { data: todos, isLoading: loadingTodos, error: todosError, refetch: refetchTodos } = useTodos();
  const { data: people, isLoading: loadingPeople, error: peopleError, refetch: refetchPeople } = usePeople();
  const { data: pointAwards = [] } = useTodoPoints();
  // Each child's creature, beside their name in the points row (RFC-017 §4),
  // cheering on their own ticks (stores/creature-reactions.ts).
  const { data: creatures } = useCreatures();
  const todayKey = toLocalDateKey();
  const { data: todoHistory } = useTodoHistory(
    dayKeyOf(dayNumber(todayKey) - 7 * 31),
    todayKey,
    { enabled: (todos ?? []).some((task) => task.track_completion) },
  );
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
        recurrence: storedRecurrence(newTaskRecurrence, newTaskDays),
        icon: newTaskIcon || null,
        points: newTaskPoints,
        ...turnFields(newTaskRecurrence, newTaskTurns, newTaskTrack),
      });

      setNewTaskTitle("");
      setNewTaskPerson("");
      setNewTaskDueDate(undefined);
      setNewTaskPriority("medium");
      setNewTaskRecurrence("once");
      setNewTaskDays([]);
      setNewTaskIcon("");
      setNewTaskPoints(0);
      setNewTaskTurns(null);
      setNewTaskTrack(false);
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
    const pickedDays = recurrenceWeekdays(todo.recurrence);
    setEditRecurrence(pickedDays ? "custom" : (todo.recurrence as RecurrenceType) || "once");
    setEditDays(pickedDays ?? []);
    setEditIcon(todo.icon || "");
    setEditPoints(todo.points || 0);
    setEditTurns(todo.rotation_person_ids?.length ? todo.rotation_person_ids : null);
    setEditTrack(Boolean(todo.track_completion));
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
        recurrence: storedRecurrence(editRecurrence, editDays),
        icon: editIcon || null,
        points: editPoints,
        ...turnFields(editRecurrence, editTurns, editTrack),
      });

      setEditDialogOpen(false);
      setEditingTodo(null);
    } catch {
      toast.error(t("updateFailed"));
    }
  };

  const handleToggleTask = async (task: Todo) => {
    const { id, completed, recurrence } = task;
    try {
      if (isScheduled(task)) {
        // Taking turns or tracked: a tick marks the open day done, and a
        // second one takes it back while the day is open. The database
        // decides which day that is; our own day goes with it.
        const done = currentDay(task, todayKey) !== null && !isTurnOpen(task, todayKey);
        await updateTodo.mutateAsync({
          id,
          last_completed: done ? null : new Date().toISOString(),
          last_completed_day: todayKey,
          completed: false,
        });
        return;
      }
      // For recurring tasks, update last_completed instead of marking as completed
      if (recurrence && recurrence !== "once") {
        await updateTodo.mutateAsync({
          id,
          last_completed: new Date().toISOString(),
          last_completed_day: toLocalDateKey(),
          completed: false,
        });
      } else {
        await updateTodo.mutateAsync({
          id,
          completed: !completed,
        });
      }
    } catch (err) {
      toast.error((err as { hint?: string })?.hint === "no_open_turn" ? t("noTurnOpen") : t("toggleFailed"));
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
  // A rotating task is today's person's.
  const personOf = (task: Todo) => todayPerson(task, todayKey);


  // Get effective due date considering recurrence
  const getEffectiveDueDate = (todo: Todo): Date | null => {
    if (!todo.recurrence || todo.recurrence === "once") {
      return todo.due_date ? new Date(todo.due_date) : null;
    }

    // Taking turns or tracked: the open day while it is not done, else the next.
    if (isScheduled(todo)) {
      const day = nextTurnDay(todo, todayKey);
      if (!day) return null;
      const [y, m, d] = day.split("-").map(Number);
      return new Date(y, m - 1, d);
    }

    // Picked weekdays: the first picked day since it was last done or made.
    const pickedDays = recurrenceWeekdays(todo.recurrence);
    if (pickedDays) return nextWeekdayDueDate(todo, pickedDays);

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
    if (filterPerson !== "all" && personOf(task) !== filterPerson) return false;
    // Open and done as the counts above the list say (lib/todo-counts.ts).
    if (!matchesStatus(task, filterStatus)) return false;
    if (filterRecurrence === "recurring" && (!task.recurrence || task.recurrence === "once")) return false;
    if (filterRecurrence === "once" && task.recurrence && task.recurrence !== "once") return false;
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- personOf reads todayKey, which is today
  }), [todos, filterPerson, filterStatus, filterRecurrence, todayKey]);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- getEffectiveDueDate reads todayKey, which is today
  }), [filteredTasks, todayKey]);

  // Open and done as the Home widget counts them: a recurring task done until
  // it comes round again is done, not open (lib/todo-counts.ts). Only
  // "Delete completed" counts ticked-off rows, which is what it removes.
  const { totalCount, doneCount, completedCount, activeCount, recurringCount } = useMemo(() => {
    const counts = todoCounts(todos || []);
    return {
      totalCount: counts.total,
      doneCount: counts.done,
      completedCount: counts.completed,
      activeCount: counts.open,
      recurringCount: counts.recurring,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- isTodoOpen reads the clock; todayKey moves the counts on with the day
  }, [todos, todayKey]);

  return (
    <TooltipProvider>
      <main id="main-content" className="min-h-page relative overflow-hidden">
        {/* Background */}
        <div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none" />

        <div className="relative z-10 p-4 md:p-8 max-w-6xl mx-auto safe-area-inset overflow-x-hidden">
          <PageHeader
            title={t("title")}
            subtitle={t("subtitle", { active: activeCount, recurring: recurringCount, completed: doneCount })}
            backHref="/"
            className="mb-8"
            iconSlot={
              <div
                className="relative size-11 shrink-0"
                role="img"
                aria-label={t("progressAria", { percent: totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0, completed: doneCount, total: totalCount })}
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
                    strokeDashoffset={`${2 * Math.PI * 18 * (1 - (totalCount > 0 ? doneCount / totalCount : 0))}`}
                    className="transition-all duration-700"
                  />
                </svg>
                <span
                  className="absolute inset-0 flex items-center justify-center text-xs font-bold text-month-primary tabular-nums"
                  aria-hidden="true"
                >
                  {totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0}%
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
                        {newTaskTurns !== null && newTaskRecurrence !== "once" ? (
                          <p className="text-sm text-muted-foreground py-2">{t("assignTurnsNote")}</p>
                        ) : (
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
                        )}
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
                      <div className={`flex flex-col gap-2 ${newTaskRecurrence === "custom" ? "sm:col-span-2" : ""}`}>
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
                            <SelectItem value="custom">
                              <div className="flex items-center gap-2">
                                <CalendarDays className="size-4 text-muted-foreground" /> {t("recurrence.custom")}
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        {newTaskRecurrence === "custom" && (
                          <WeekdayPicker value={newTaskDays} onChange={setNewTaskDays} />
                        )}
                      </div>

                      <div className="flex flex-col gap-2">
                        <Label>{keepsSchedule({ recurrence: newTaskRecurrence === "custom" ? "days:MO" : newTaskRecurrence, rotation_person_ids: newTaskTurns, track_completion: newTaskTrack }) ? t("fieldStart") : t("fieldDueDate")}</Label>
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

                    {newTaskRecurrence !== "once" && (
                      <TodoTurnFields people={people ?? []} turns={newTaskTurns} onTurnsChange={setNewTaskTurns} track={newTaskTrack} onTrackChange={setNewTaskTrack} />
                    )}

                    <TodoDecorationFields icon={newTaskIcon} points={newTaskPoints} onIconChange={setNewTaskIcon} onPointsChange={setNewTaskPoints} />

                    <Button
                      className="w-full"
                      onClick={handleAddTask}
                      // Take turns ticked with nobody picked would quietly save a plain task.
                      disabled={!newTaskTitle.trim() || createTodo.isPending || (newTaskRecurrence === "custom" && newTaskDays.length === 0) || (newTaskRecurrence !== "once" && newTaskTurns?.length === 0)}
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

          {(() => {
            // One chip per child: their points, once the family uses points,
            // and their creature beside the name when one is switched on. A
            // family with creatures but no points yet still sees the
            // creatures; the children without one are left out then.
            const showPoints = pointAwards.length > 0 || Boolean(todos?.some((task) => task.points > 0));
            const chips = (people ?? []).filter(
              (person) => person.is_child && (showPoints || activeCreatureOf(creatures, person.id)),
            );
            if (chips.length === 0) return null;
            return (
              <div className="mb-6 flex flex-wrap gap-2" aria-label={t("pointsHeading")} data-testid="todo-children">
                {chips.map((person) => (
                  <ChildChip
                    key={person.id}
                    person={person}
                    creature={activeCreatureOf(creatures, person.id)}
                    earned={pointsTotal(pointAwards, person.id)}
                    showPoints={showPoints}
                    pointsUnit={t("pointsUnit")}
                    creatureAria={t("creatureAria", { name: person.name })}
                  />
                ))}
              </div>
            );
          })()}

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
            const completionPercent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

            const statCards = [
              { label: t("statOpen"), value: activeCount, icon: ListChecks, color: "text-month-primary", bg: "bg-month-primary/10", border: "border-month-primary/20" },
              { label: t("statOverdue"), value: overdueCount, icon: AlertTriangle, color: overdueCount > 0 ? "text-destructive" : "text-muted-foreground", bg: overdueCount > 0 ? "bg-destructive/10" : "bg-muted/40", border: overdueCount > 0 ? "border-destructive/20" : "border-border/20" },
              { label: t("statToday"), value: dueTodayCount, icon: Clock, color: dueTodayCount > 0 ? "text-warning-strong" : "text-muted-foreground", bg: dueTodayCount > 0 ? "bg-warning/10" : "bg-muted/40", border: dueTodayCount > 0 ? "border-warning/30" : "border-border/20" },
              { label: t("statRecurring"), value: recurringDueCount, icon: Repeat, color: recurringDueCount > 0 ? "text-info-strong" : "text-muted-foreground", bg: recurringDueCount > 0 ? "bg-info/10" : "bg-muted/40", border: recurringDueCount > 0 ? "border-info/30" : "border-border/20" },
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
                    {t("progressDoneCount", { completed: doneCount, total: totalCount })}
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
                  { key: "recurring", label: t("sectionRecurringDue"), icon: Repeat, tasks: recurringDueTasks, accentClass: "text-info-strong", borderClass: "border-l-info" },
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
                              const person = getPersonById(personOf(task));
                              const strip = recentDays(task, todayKey, todoHistory?.get(task.id));
                              const turnDone = isScheduled(task) && currentDay(task, todayKey) !== null && !isTurnOpen(task, todayKey);
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
                                        onClick={() => handleToggleTask(task)}
                                        className="shrink-0 -m-2.5 p-2.5 rounded-full"
                                        disabled={updateTodo.isPending}
                                        aria-label={task.completed || turnDone ? t("toggleAriaIncomplete", { title: task.title }) : t("toggleAriaComplete", { title: task.title })}
                                      >
                                        {task.completed || turnDone ? (
                                          <CheckCircle2 className="size-6 text-success" />
                                        ) : isRecurring ? (
                                          <Repeat className={`size-6 ${isDue ? "text-month-primary" : "text-muted-foreground"} hover:text-foreground transition-colors`} />
                                        ) : (
                                          <Circle className="size-6 text-muted-foreground hover:text-foreground transition-colors" />
                                        )}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {turnDone ? t("toggleTooltipUndo") : isRecurring ? t("toggleTooltipRecurring") : t("toggleTooltip")}
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
                                      {task.icon && <span className="shrink-0 text-xl" aria-hidden="true">{task.icon}</span>}
                                      <p
                                        className={`font-medium truncate ${
                                          task.completed
                                            ? "line-through text-muted-foreground"
                                            : ""
                                        }`}
                                      >
                                        {task.title}
                                      </p>
                                      {task.points > 0 && <span className="shrink-0 text-xs text-primary">⭐ {task.points}</span>}
                                      {isRecurring && task.recurrence && (() => {
                                        const pickedDays = recurrenceWeekdays(task.recurrence);
                                        const RecurrenceIcon = RECURRENCE_ICON_MAP[pickedDays ? "custom" : (task.recurrence as RecurrenceType)];
                                        if (!RecurrenceIcon) return null;
                                        return (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <span className="shrink-0">
                                                <RecurrenceIcon className="size-3.5 text-muted-foreground" />
                                              </span>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              {pickedDays ? weekdaysLabel(pickedDays) : RECURRENCE_LABELS[task.recurrence as RecurrenceType]}
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
                                      {(task.rotation_person_ids?.length ?? 0) > 1 && (
                                        <span className="flex items-center gap-0.5" title={t("turnsBetween", { names: (task.rotation_person_ids ?? []).map((id) => getPersonById(id)?.name).filter(Boolean).join(", ") })}>
                                          <Repeat2 className="size-3 text-muted-foreground" aria-hidden="true" />
                                          {(task.rotation_person_ids ?? []).map((id) => (
                                            <span key={id} className="size-2 rounded-full" style={{ backgroundColor: getPersonById(id)?.color }} />
                                          ))}
                                          <span className="sr-only">{t("turnsBetween", { names: (task.rotation_person_ids ?? []).map((id) => getPersonById(id)?.name).filter(Boolean).join(", ") })}</span>
                                        </span>
                                      )}
                                      <TurnStrip days={strip} people={people ?? []} />
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
                  {editTurns !== null && editRecurrence !== "once" ? (
                    <p className="text-sm text-muted-foreground py-2">{t("assignTurnsNote")}</p>
                  ) : (
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
                  )}
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
                <div className={`flex flex-col gap-2 ${editRecurrence === "custom" ? "sm:col-span-2" : ""}`}>
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
                      <SelectItem value="custom">
                        <div className="flex items-center gap-2">
                          <CalendarDays className="size-4 text-muted-foreground" /> {t("recurrence.custom")}
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {editRecurrence === "custom" && (
                    <WeekdayPicker value={editDays} onChange={setEditDays} />
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <Label>{keepsSchedule({ recurrence: editRecurrence === "custom" ? "days:MO" : editRecurrence, rotation_person_ids: editTurns, track_completion: editTrack }) ? t("fieldStart") : t("fieldDueDate")}</Label>
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

              {editRecurrence !== "once" && (
                <TodoTurnFields people={people ?? []} turns={editTurns} onTurnsChange={setEditTurns} track={editTrack} onTrackChange={setEditTrack} />
              )}

              <TodoDecorationFields icon={editIcon} points={editPoints} onIconChange={setEditIcon} onPointsChange={setEditPoints} />

              <Button
                className="w-full"
                onClick={handleEditTask}
                disabled={!editTitle.trim() || updateTodo.isPending || (editRecurrence === "custom" && editDays.length === 0) || (editRecurrence !== "once" && editTurns?.length === 0)}
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
