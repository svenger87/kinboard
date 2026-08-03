"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { getISOWeek } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamilyStore } from "@/stores/family-store";
import { showUndoToast } from "@/lib/undo-toast";
import { getIntlLocale } from "@/i18n/intl-locale";
import { PageHeader } from "@/components/page-header";
import {
  ChefHat,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  MoreVertical,
  Clock,
  Users,
  ShoppingCart,
  ArrowRight,
  Trash2,
  Edit,
  GripVertical,
  Search,
  X,
  ListFilter,
  Grid3X3,
  List,
  Loader2,
  CalendarDays,
  Coffee,
  UtensilsCrossed,
  Sunset,
  Cookie,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  DragStartEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  useSortable,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  useMealPlan,
  useAddMealPlanEntry,
  useUpdateMealPlanEntry,
  useRescheduleMealPlanEntry,
  useDeleteMealPlanEntry,
  useGenerateShoppingFromMealPlan,
  usePostponeMeal,
  getWeekStart,
  getWeekDates,
  formatDate,
  MEAL_TYPES,
  mealPlanQueryKeys,
  useRecipes,
  useRecipe,
  useAddRecipeToShoppingList,
  useKeyboardShortcuts,
  useSwipeNavigation,
  type CreateMealPlanEntryInput,
} from "@/hooks";
import { ErrorState } from "@/components/error-state";
import { FAB } from "@/components/fab";
import type { MealPlanEntryWithRecipe, MealType, Recipe } from "@/types/database";

// Meal type icon mapping
const MEAL_TYPE_ICONS: Record<MealType, typeof Coffee> = {
  breakfast: Coffee,
  lunch: UtensilsCrossed,
  dinner: Sunset,
  snack: Cookie,
};

// Meal suggestion hints for empty slots — pipe-separated strings come from
// the `mealHints` translation namespace; consumers split and seed-pick.
function pickMealHint(hintsRaw: string, mealType: MealType, date: string): string {
  const hints = hintsRaw.split("|").map((h) => h.trim()).filter(Boolean);
  if (hints.length === 0) return "";
  // Use date + mealType as seed for consistent hint per slot
  const hash = (date + mealType).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return hints[hash % hints.length];
}

/**
 * Pick a few recipes to suggest, stably.
 *
 * This replaced `recipes.sort(() => Math.random() - 0.5).slice(0, 3)`
 * written inline in the JSX, which had three problems stacked on top of
 * each other:
 *
 *  - `sort` mutates in place, and `recipes` is the array held by the
 *    TanStack Query cache. Rendering the meal planner quietly reordered
 *    the recipe list every other consumer reads.
 *  - It re-ran on every render with new randomness, so the three cards
 *    changed under the reader's hands on any state change at all — a
 *    hover, a refetch, a drag. That's the flicker.
 *  - Images inside the cards then reload at different heights, which is
 *    what makes the page jump while you're scrolling it.
 *
 * A hash of the recipe id and a seed gives a shuffle that is random-
 * looking but fixed: the same week shows the same suggestions until the
 * recipes or the week actually change.
 */
function hashString(value: string): number {
  // djb2 — deterministic across renders, reloads and devices, unlike
  // anything seeded from Math.random or a timestamp.
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

const SUGGESTION_COUNT = 3;

function RecipeSuggestions({
  recipes,
  seed,
  onSelect,
}: {
  recipes: Recipe[];
  /** Changing this reshuffles; the visible week is the natural choice. */
  seed: string;
  onSelect: () => void;
}) {
  const t = useTranslations("meals");

  const suggestions = useMemo(
    () =>
      // Copy before sorting — see above.
      [...recipes]
        .sort((a, b) => hashString(seed + a.id) - hashString(seed + b.id))
        .slice(0, SUGGESTION_COUNT),
    [recipes, seed],
  );

  if (suggestions.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
    >
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3 px-1">
        {t("recipeSuggestions")}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {suggestions.map((recipe) => (
          <Card
            key={recipe.id}
            className="group cursor-pointer hover:bg-accent/40 transition-all"
            onClick={onSelect}
          >
            <CardContent className="p-4 flex items-center gap-3">
              {recipe.image_url ? (
                <div className="size-12 rounded-lg overflow-hidden shrink-0 bg-muted/30">
                  <img
                    src={recipe.image_url}
                    alt={recipe.title}
                    className="size-full object-cover"
                  />
                </div>
              ) : (
                <div className="size-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <UtensilsCrossed className="size-5 text-primary" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{recipe.title}</p>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                  {recipe.prep_time_minutes && (
                    <span className="flex items-center gap-0.5">
                      <Clock className="size-3" />
                      {recipe.prep_time_minutes} min
                    </span>
                  )}
                  {recipe.servings && (
                    <span className="flex items-center gap-0.5">
                      <Users className="size-3" />
                      {recipe.servings}
                    </span>
                  )}
                </div>
              </div>
              <ArrowRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </CardContent>
          </Card>
        ))}
      </div>
    </motion.div>
  );
}

// Meal slot droppable component
function MealSlot({
  date,
  mealType,
  entries,
  onAddClick,
  onEntryAction,
}: {
  date: string;
  mealType: MealType;
  entries: MealPlanEntryWithRecipe[];
  onAddClick: () => void;
  onEntryAction: (action: string, entry: MealPlanEntryWithRecipe) => void;
}) {
  const t = useTranslations("meals");
  const tHints = useTranslations("mealHints");
  const slotEntries = entries.filter(
    (e) => e.date === date && e.meal_type === mealType
  );

  // Make this slot a drop target with ID format: date_mealType
  const { setNodeRef, isOver } = useDroppable({
    id: `${date}_${mealType}`,
  });

  const MealIcon = MEAL_TYPE_ICONS[mealType];
  // Seeded hint from the locale-aware mealHints namespace
  const hint = pickMealHint(tHints(mealType), mealType, date);

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[90px] min-w-0 p-2 rounded-lg border transition-colors ${
        isOver
          ? "bg-primary/15 border-primary border-solid"
          : slotEntries.length === 0
          ? "border-dashed border-border/40 hover:border-primary/40 hover:bg-accent/40"
          : "border-solid border-border bg-muted/30"
      }`}
    >
      {slotEntries.length === 0 ? (
        <button
          onClick={onAddClick}
          aria-label={hint ? t("addHintAria", { hint }) : t("emptyAction")}
          className="size-full min-h-[60px] flex flex-col items-center justify-center gap-1.5 text-muted-foreground/50 hover:text-muted-foreground hover:bg-primary/5 active:bg-primary/10 transition-all duration-200 group rounded-md"
        >
          <div className="flex items-center gap-1.5">
            <MealIcon className="size-3.5" />
            <Plus className="size-3.5 text-primary/60 group-hover:text-primary" />
          </div>
          {hint && <span className="text-[11px]">{hint}?</span>}
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          {slotEntries.map((entry) => (
            <MealEntryCard
              key={entry.id}
              entry={entry}
              onAction={(action) => onEntryAction(action, entry)}
            />
          ))}
          <button
            onClick={onAddClick}
            aria-label={t("addAnotherAria")}
            className="w-full py-1 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors flex items-center justify-center gap-1"
          >
            <Plus className="size-3" />
            {t("addInline")}
          </button>
        </div>
      )}
    </div>
  );
}

// Draggable meal entry card
function MealEntryCard({
  entry,
  onAction,
  isDragging = false,
}: {
  entry: MealPlanEntryWithRecipe;
  onAction: (action: string) => void;
  isDragging?: boolean;
}) {
  const t = useTranslations("meals");
  const [menuOpen, setMenuOpen] = useState(false);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const isLongPress = useRef(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: entry.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Long press handlers for touch devices
  const handleTouchStart = useCallback(() => {
    isLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      setMenuOpen(true);
      // Haptic feedback
      if ("vibrate" in navigator) {
        navigator.vibrate(10);
      }
    }, 350);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleTouchMove = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  // Click handler - open detail view (only if not long press)
  const handleClick = useCallback(() => {
    if (!isLongPress.current) {
      onAction("view");
    }
    isLongPress.current = false;
  }, [onAction]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative min-w-0 ${isDragging ? "opacity-50" : ""}`}
    >
      <Card className="cursor-pointer hover:ring-1 hover:ring-primary/50 transition-all">
          <CardContent className="p-2">
        <div className="flex items-start gap-2">
          <div
            {...attributes}
            {...listeners}
            className="mt-1 text-muted-foreground/50 hover:text-muted-foreground cursor-grab"
          >
            <GripVertical className="size-3" />
          </div>

          <div
            className="flex-1 min-w-0"
            onClick={handleClick}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
          >
            {entry.recipe ? (
              <>
                <div className="flex items-start gap-2">
                  {entry.recipe.image_url && (
                    <img
                      src={entry.recipe.image_url}
                      alt={entry.recipe.title}
                      className="size-10 rounded object-cover flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-medium line-clamp-1">
                      {entry.recipe.title}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      {entry.recipe.total_time_minutes && (
                        <span className="flex items-center gap-0.5">
                          <Clock className="size-3" />
                          {entry.recipe.total_time_minutes}m
                        </span>
                      )}
                      {entry.servings && (
                        <span className="flex items-center gap-0.5">
                          <Users className="size-3" />
                          {entry.servings}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : entry.note ? (
              <p className="text-sm text-muted-foreground italic line-clamp-3">
                {entry.note}
              </p>
            ) : null}
          </div>

          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                aria-label={t("entryOptionsAria")}
              >
                <MoreVertical className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {entry.recipe && (
                <DropdownMenuItem onClick={() => onAction("view")}>
                  <ChefHat className="size-4 mr-2" />
                  {t("menuViewDetails")}
                </DropdownMenuItem>
              )}
              {entry.note && !entry.recipe && (
                <DropdownMenuItem onClick={() => onAction("edit")}>
                  <Edit className="size-4 mr-2" />
                  {t("menuEdit")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onAction("postpone")}>
                <ArrowRight className="size-4 mr-2" />
                {t("menuPostpone")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAction("reschedule")}>
                <CalendarDays className="size-4 mr-2" />
                {t("menuReschedule")}
              </DropdownMenuItem>
              {entry.recipe && (
                <DropdownMenuItem onClick={() => onAction("shopping")}>
                  <ShoppingCart className="size-4 mr-2" />
                  {t("menuShopping")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onAction("delete")}
                className="text-destructive"
              >
                <Trash2 className="size-4 mr-2" />
                {t("menuDelete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
          </CardContent>
        </Card>
    </div>
  );
}

// Recipe sidebar item
function RecipeSidebarItem({
  recipe,
  onSelect,
}: {
  recipe: Recipe;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className="w-full text-left p-2 rounded-lg hover:bg-muted/50 transition-colors flex items-center gap-3"
    >
      {recipe.image_url ? (
        <img
          src={recipe.image_url}
          alt={recipe.title}
          className="size-12 rounded-lg object-cover flex-shrink-0"
        />
      ) : (
        <div className="size-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <ChefHat className="size-5 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium line-clamp-1">{recipe.title}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          {recipe.total_time_minutes && (
            <span className="flex items-center gap-0.5">
              <Clock className="size-3" />
              {recipe.total_time_minutes}m
            </span>
          )}
          {recipe.servings && (
            <span className="flex items-center gap-0.5">
              <Users className="size-3" />
              {recipe.servings}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export default function MealPlannerPage() {
  useKeyboardShortcuts();
  useSwipeNavigation();

  const t = useTranslations("meals");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const intlLocale = getIntlLocale(locale);
  const mealTypeLabel = (type: MealType) => t(`mealType.${type}` as "mealType.breakfast");

  // State - default to list on mobile, grid on desktop
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // Auto-switch to appropriate view based on screen size
  useEffect(() => {
    const checkScreenSize = () => {
      const isMobile = window.innerWidth < 768;
      setViewMode(isMobile ? "list" : "grid");
    };

    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);
    return () => window.removeEventListener("resize", checkScreenSize);
  }, []);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showRescheduleDialog, setShowRescheduleDialog] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<{
    date: string;
    mealType: MealType;
  } | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<MealPlanEntryWithRecipe | null>(null);
  const [recipeSearch, setRecipeSearch] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleMealType, setRescheduleMealType] = useState<MealType>("dinner");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showShoppingDialog, setShowShoppingDialog] = useState(false);
  const [selectedShoppingEntries, setSelectedShoppingEntries] = useState<Set<string>>(new Set());
  const [showIngredientDialog, setShowIngredientDialog] = useState(false);
  const [ingredientEntry, setIngredientEntry] = useState<MealPlanEntryWithRecipe | null>(null);
  const [selectedIngredients, setSelectedIngredients] = useState<Set<string>>(new Set());
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [detailEntry, setDetailEntry] = useState<MealPlanEntryWithRecipe | null>(null);
  const [showEditNoteDialog, setShowEditNoteDialog] = useState(false);
  const [editNoteEntry, setEditNoteEntry] = useState<MealPlanEntryWithRecipe | null>(null);
  const [editNoteInput, setEditNoteInput] = useState("");
  const [entryPendingDelete, setEntryPendingDelete] = useState<MealPlanEntryWithRecipe | null>(null);

  // Calculate week start
  const weekStart = useMemo(() => getWeekStart(currentDate), [currentDate]);
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);

  // Data fetching
  const { data: mealPlanData, isLoading: isMealPlanLoading, isError: isMealPlanError, refetch: refetchMealPlan } = useMealPlan(weekStart);
  const { data: recipes = [], isLoading: isRecipesLoading } = useRecipes();

  // Mutations
  const addEntry = useAddMealPlanEntry();
  const rescheduleEntry = useRescheduleMealPlanEntry();
  const deleteEntry = useDeleteMealPlanEntry();
  const updateEntry = useUpdateMealPlanEntry();
  const generateShopping = useGenerateShoppingFromMealPlan();
  const postponeMeal = usePostponeMeal();
  const addToShoppingList = useAddRecipeToShoppingList();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  // Fetch full recipe with ingredients when showing ingredient dialog
  const { data: ingredientRecipe } = useRecipe(ingredientEntry?.recipe_id || null);

  // Fetch full recipe for detail view
  const { data: detailRecipe, isLoading: isDetailLoading } = useRecipe(detailEntry?.recipe_id || null);

  // Filter recipes for sidebar
  const filteredRecipes = useMemo(() => {
    if (!recipeSearch.trim()) return recipes.slice(0, 20);
    const search = recipeSearch.toLowerCase();
    return recipes
      .filter((r) => r.title.toLowerCase().includes(search))
      .slice(0, 20);
  }, [recipes, recipeSearch]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  // Week navigation
  const goToPrevWeek = () => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() - 7);
    setCurrentDate(newDate);
  };

  const goToNextWeek = () => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + 7);
    setCurrentDate(newDate);
  };

  const goToCurrentWeek = () => {
    setCurrentDate(new Date());
  };

  // Format week range for display
  const weekRangeDisplay = useMemo(() => {
    const start = new Date(weekDates[0]);
    const end = new Date(weekDates[6]);
    const startStr = start.toLocaleDateString(intlLocale, {
      day: "numeric",
      month: "short",
    });
    const endStr = end.toLocaleDateString(intlLocale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return `${startStr} - ${endStr}`;
  }, [weekDates, intlLocale]);

  // Check if showing current week
  const currentWeekStart = getWeekStart(new Date());
  const isCurrentWeek = currentWeekStart === weekStart;

  // Get today's date string
  const today = new Date().toISOString().split("T")[0];

  // Handle add meal click
  const handleAddClick = (date: string, mealType: MealType) => {
    setSelectedSlot({ date, mealType });
    setNoteInput("");
    setShowAddDialog(true);
  };

  // Handle add recipe to meal plan
  const handleAddRecipe = async (recipe: Recipe) => {
    if (!selectedSlot) return;

    try {
      await addEntry.mutateAsync({
        weekStart,
        entry: {
          date: selectedSlot.date,
          meal_type: selectedSlot.mealType,
          recipe_id: recipe.id,
          servings: recipe.servings || 4,
        },
      });
      setShowAddDialog(false);
      setSelectedSlot(null);
    } catch {
      toast.error(t("addFailed"));
    }
  };

  // Handle add note
  const handleAddNote = async () => {
    if (!selectedSlot || !noteInput.trim()) return;

    try {
      await addEntry.mutateAsync({
        weekStart,
        entry: {
          date: selectedSlot.date,
          meal_type: selectedSlot.mealType,
          note: noteInput.trim(),
        },
      });
      setShowAddDialog(false);
      setSelectedSlot(null);
      setNoteInput("");
    } catch {
      toast.error(t("noteSaveFailed"));
    }
  };

  // Handle entry actions
  const handleEntryAction = async (
    action: string,
    entry: MealPlanEntryWithRecipe
  ) => {
    switch (action) {
      case "view":
        if (entry.recipe_id) {
          setDetailEntry(entry);
          setShowDetailDialog(true);
        } else if (entry.note) {
          // For note-only entries, open edit dialog on click
          setEditNoteEntry(entry);
          setEditNoteInput(entry.note);
          setShowEditNoteDialog(true);
        }
        break;

      case "edit":
        setEditNoteEntry(entry);
        setEditNoteInput(entry.note || "");
        setShowEditNoteDialog(true);
        break;

      case "postpone":
        try {
          await postponeMeal.mutateAsync({
            entryId: entry.id,
            currentDate: entry.date,
            currentWeekStart: weekStart,
          });
        } catch {
          toast.error(t("moveFailed"));
        }
        break;

      case "reschedule":
        setSelectedEntry(entry);
        setRescheduleDate(entry.date);
        setRescheduleMealType(entry.meal_type);
        setShowRescheduleDialog(true);
        break;

      case "delete":
        setEntryPendingDelete(entry);
        break;

      case "shopping":
        // Show ingredient selection dialog
        if (entry.recipe_id) {
          setIngredientEntry(entry);
          setSelectedIngredients(new Set()); // Reset selection
          setShowIngredientDialog(true);
        }
        break;

    }
  };

  // Handle reschedule confirm
  const handleRescheduleConfirm = async () => {
    if (!selectedEntry || !rescheduleDate) return;

    try {
      await rescheduleEntry.mutateAsync({
        entryId: selectedEntry.id,
        newDate: rescheduleDate,
        newMealType: rescheduleMealType,
        currentWeekStart: weekStart,
      });
      setShowRescheduleDialog(false);
      setSelectedEntry(null);
    } catch {
      toast.error(t("rescheduleFailed"));
    }
  };

  // Handle bulk shopping list generation
  const handleGenerateShopping = async () => {
    try {
      const count = await generateShopping.mutateAsync({
        weekStart,
        selectedEntryIds:
          selectedShoppingEntries.size > 0
            ? Array.from(selectedShoppingEntries)
            : undefined,
      });
      setShowShoppingDialog(false);
      setSelectedShoppingEntries(new Set());
      toast.success(t("shoppingCreated"));
    } catch {
      toast.error(t("shoppingCreateFailed"));
    }
  };

  // Toggle shopping entry selection
  const toggleShoppingEntry = (entryId: string) => {
    setSelectedShoppingEntries((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(entryId)) {
        newSet.delete(entryId);
      } else {
        newSet.add(entryId);
      }
      return newSet;
    });
  };

  // Toggle ingredient selection
  const toggleIngredient = (ingredientId: string) => {
    setSelectedIngredients((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(ingredientId)) {
        newSet.delete(ingredientId);
      } else {
        newSet.add(ingredientId);
      }
      return newSet;
    });
  };

  // Select/deselect all ingredients
  const toggleAllIngredients = () => {
    if (!ingredientRecipe?.ingredients) return;
    if (selectedIngredients.size === ingredientRecipe.ingredients.length) {
      setSelectedIngredients(new Set());
    } else {
      setSelectedIngredients(new Set(ingredientRecipe.ingredients.map((i) => i.id)));
    }
  };

  // Handle adding ingredients to shopping list
  const handleAddIngredientsToShopping = async () => {
    if (!ingredientEntry?.recipe_id) return;

    try {
      await addToShoppingList.mutateAsync({
        recipeId: ingredientEntry.recipe_id,
        servings: ingredientEntry.servings || ingredientRecipe?.servings || 4,
        ingredientIds: selectedIngredients.size > 0 ? Array.from(selectedIngredients) : undefined,
      });
      setShowIngredientDialog(false);
      setIngredientEntry(null);
      setSelectedIngredients(new Set());
    } catch {
      toast.error(t("ingredientsAddFailed"));
    }
  };

  // DnD handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    // Parse drop target to get date and meal type
    const [targetDate, targetMealType] = (over.id as string).split("_");
    if (!targetDate || !targetMealType) return;

    try {
      await rescheduleEntry.mutateAsync({
        entryId: active.id as string,
        newDate: targetDate,
        newMealType: targetMealType as MealType,
        currentWeekStart: weekStart,
      });
    } catch {
      toast.error(t("moveFailed"));
    }
  };

  // Get active entry for drag overlay
  const activeEntry = activeId
    ? mealPlanData?.entries.find((e) => e.id === activeId)
    : null;

  // Entries with recipes for shopping
  const entriesWithRecipes = mealPlanData?.entries.filter((e) => e.recipe_id) || [];

  return (
    <TooltipProvider>
      <main id="main-content" className="min-h-screen relative overflow-hidden">
        {/* Background */}
        <div className="page-gradient" />

        <div className="relative z-10 p-4 md:p-8 max-w-7xl mx-auto safe-area-inset">
          <PageHeader
            icon={Calendar}
            title={t("title")}
            subtitle={t("subtitle")}
            backHref="/"
            className="mb-8"
            actions={
              <>
                <div className="hidden md:flex items-center border rounded-lg p-1">
                  <Button
                    variant={viewMode === "grid" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode("grid")}
                    className="h-8 px-3"
                  >
                    <Grid3X3 className="size-4" />
                  </Button>
                  <Button
                    variant={viewMode === "list" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode("list")}
                    className="h-8 px-3"
                  >
                    <List className="size-4" />
                  </Button>
                </div>
                <Button
                  onClick={() => setShowShoppingDialog(true)}
                  disabled={entriesWithRecipes.length === 0}
                >
                  <ShoppingCart className="size-4 mr-2" />
                  {t("shoppingButton")}
                </Button>
                <Link href="/recipes">
                  <Button variant="outline">
                    <ChefHat className="size-4 mr-2" />
                    {t("recipesButton")}
                  </Button>
                </Link>
              </>
            }
          />

          {/* Week Navigation */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-6"
          >
            <Card><CardContent className="p-4">
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="icon" onClick={goToPrevWeek} aria-label={t("prevWeekAria")}>
                  <ChevronLeft className="size-5" />
                </Button>

                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-semibold">{weekRangeDisplay}</h2>
                  <Badge variant="secondary" className="text-xs">
                    {t("weekNumber", { number: getISOWeek(new Date(weekStart + "T12:00:00")) })}
                  </Badge>
                  {!isCurrentWeek && (
                    <Button variant="outline" size="sm" onClick={goToCurrentWeek}>
                      {t("backToCurrentWeek")}
                    </Button>
                  )}
                </div>

                <Button variant="ghost" size="icon" onClick={goToNextWeek} aria-label={t("nextWeekAria")}>
                  <ChevronRight className="size-5" />
                </Button>
              </div>
            </CardContent></Card>
          </motion.div>

          {/* Main Content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            {isMealPlanError ? (
              <Card><CardContent className="p-4">
                <ErrorState
                  title={t("loadErrorTitle")}
                  message={t("loadErrorMessage")}
                  onRetry={() => refetchMealPlan()}
                />
              </CardContent></Card>
            ) : isMealPlanLoading ? (
              viewMode === "grid" ? (
                <Card><CardContent className="p-4">
                  <div className="grid grid-cols-[80px_repeat(7,1fr)] gap-2 min-w-[800px]">
                    <div />
                    {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                      <Skeleton key={i} className="h-8 rounded-lg" />
                    ))}
                  </div>
                  {[1, 2, 3, 4].map((row) => (
                    <div key={row} className="grid grid-cols-[80px_repeat(7,1fr)] gap-2 mt-2 min-w-[800px]">
                      <Skeleton className="h-4 w-16 self-center" />
                      {[1, 2, 3, 4, 5, 6, 7].map((col) => (
                        <Skeleton key={col} className="h-[80px] rounded-lg" />
                      ))}
                    </div>
                  ))}
                </CardContent></Card>
              ) : (
                <div className="flex flex-col gap-4">
                  {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                    <Card key={i}><CardContent className="p-4">
                      <Skeleton className="h-5 w-48 mb-3" />
                      <div className="flex flex-col gap-2">
                        <Skeleton className="h-14 rounded-lg" />
                        <Skeleton className="h-14 rounded-lg" />
                      </div>
                      <Skeleton className="h-8 w-full mt-3 rounded-lg" />
                    </CardContent></Card>
                  ))}
                </div>
              )
            ) : mealPlanData && mealPlanData.entries.length === 0 && viewMode === "list" ? (
              <div className="space-y-4">
                <Card><CardContent className="p-8">
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="p-3 rounded-xl bg-primary/10 mb-4">
                      <ChefHat className="size-10 text-primary" strokeWidth={1.75} />
                    </div>
                    <h3 className="text-lg font-semibold mb-1">{t("emptyTitle")}</h3>
                    <p className="text-sm text-muted-foreground max-w-sm mb-6">
                      {t("emptyDescription")}
                    </p>
                    {/* Wraps rather than overflowing: "Mahlzeit
                        hinzufügen" and "Rezepte durchsuchen" are far
                        wider than their English equivalents and pushed
                        past both edges of the card on a phone. The
                        buttons keep their own labels on one line and
                        stack instead, and `max-w-full` stops a long
                        translation from widening the row past the
                        card. */}
                    <div className="flex flex-wrap justify-center gap-3 w-full max-w-full">
                      <Button
                        variant="outline"
                        className="max-w-full"
                        onClick={() => handleAddClick(today, "dinner")}
                      >
                        <Plus className="size-4 mr-2 shrink-0" />
                        <span className="truncate">{t("emptyAction")}</span>
                      </Button>
                      <Link href="/recipes" className="max-w-full">
                        <Button variant="outline" className="w-full max-w-full">
                          <ChefHat className="size-4 mr-2 shrink-0" />
                          <span className="truncate">{t("browseRecipes")}</span>
                        </Button>
                      </Link>
                    </div>
                  </div>
                </CardContent></Card>

                {/* Quick recipe suggestions */}
                <RecipeSuggestions
                  recipes={recipes}
                  seed={weekStart}
                  onSelect={() => handleAddClick(today, "dinner")}
                />
              </div>
            ) : viewMode === "grid" ? (
              <>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <Card><CardContent className="p-4 overflow-x-auto">
                  {/* Grid Header */}
                  <div className="grid grid-cols-[80px_repeat(7,1fr)] gap-2 min-w-[800px]">
                    <div />
                    {weekDates.map((date) => {
                      const d = new Date(date);
                      const isToday = date === today;
                      return (
                        <div
                          key={date}
                          className={`text-center p-2 rounded-lg ${
                            isToday
                              ? "bg-primary/10 text-primary font-semibold"
                              : ""
                          }`}
                        >
                          <div className="text-sm">{formatDate(date, intlLocale)}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Grid Body */}
                  {(["breakfast", "lunch", "dinner", "snack"] as MealType[]).map(
                    (mealType) => {
                      const RowIcon = MEAL_TYPE_ICONS[mealType];
                      return (
                      <div
                        key={mealType}
                        className="grid grid-cols-[80px_repeat(7,1fr)] gap-2 mt-2 min-w-[800px]"
                      >
                        <div className="flex flex-col items-center justify-center p-2 gap-1.5 rounded-lg bg-muted/30">
                          <RowIcon className="size-4 text-muted-foreground/60" />
                          <span className="text-xs font-medium text-muted-foreground/80">
                            {mealTypeLabel(mealType)}
                          </span>
                        </div>
                        {weekDates.map((date) => (
                          <MealSlot
                            key={`${date}_${mealType}`}
                            date={date}
                            mealType={mealType}
                            entries={mealPlanData?.entries || []}
                            onAddClick={() => handleAddClick(date, mealType)}
                            onEntryAction={handleEntryAction}
                          />
                        ))}
                      </div>
                      );
                    })
                  }
                </CardContent></Card>

                {/* Drag Overlay */}
                <DragOverlay>
                  {activeEntry && (
                    <MealEntryCard
                      entry={activeEntry}
                      onAction={() => {}}
                      isDragging
                    />
                  )}
                </DragOverlay>
              </DndContext>

              {/* Recipe suggestions below grid when empty */}
              {mealPlanData && mealPlanData.entries.length === 0 && (
                <div className="mt-4">
                  <RecipeSuggestions
                    recipes={recipes}
                    seed={weekStart}
                    onSelect={() => handleAddClick(today, "dinner")}
                  />
                </div>
              )}
              </>
            ) : (
              // List View
              <div className="flex flex-col gap-3">
                {weekDates.map((date) => {
                  const dayEntries = mealPlanData?.entries.filter(
                    (e) => e.date === date
                  ) || [];
                  const d = new Date(date + "T12:00:00");
                  const isToday = date === today;
                  const hasMeals = dayEntries.length > 0;

                  return (
                    <Card
                      key={date}
                      className={isToday ? "ring-2 ring-primary/50" : undefined}
                    >
                      <CardContent className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <h3
                          className={`font-semibold text-sm ${
                            isToday ? "text-primary" : ""
                          }`}
                        >
                          {d.toLocaleDateString(intlLocale, {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          })}
                          {isToday && (
                            <Badge variant="secondary" className="ml-2 text-[10px]">
                              {t("todayBadge")}
                            </Badge>
                          )}
                        </h3>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => handleAddClick(date, "dinner")}
                          aria-label={t("addAnotherAria")}
                        >
                          <Plus className="size-4" />
                        </Button>
                      </div>

                      {hasMeals ? (
                        <div className="flex flex-col gap-1.5">
                          {(["breakfast", "lunch", "dinner", "snack"] as MealType[]).map(
                            (mealType) => {
                              const typeEntries = dayEntries.filter(
                                (e) => e.meal_type === mealType
                              );
                              if (typeEntries.length === 0) return null;

                              const TypeIcon = MEAL_TYPE_ICONS[mealType];
                              return (
                                <div key={mealType}>
                                  <p className="text-kiosk-label mb-1 flex items-center gap-1">
                                    <TypeIcon className="size-3.5" />
                                    {mealTypeLabel(mealType)}
                                  </p>
                                  <div className="flex flex-col gap-1.5">
                                    {typeEntries.map((entry) => (
                                      <MealEntryCard
                                        key={entry.id}
                                        entry={entry}
                                        onAction={(action) =>
                                          handleEntryAction(action, entry)
                                        }
                                      />
                                    ))}
                                  </div>
                                </div>
                              );
                            }
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground/30 py-1">
                          {t("listEmpty")}
                        </p>
                      )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </motion.div>
        </div>

        {/* Add Meal Dialog */}
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent className="max-w-2xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle>{t("addDialogTitle")}</DialogTitle>
              <DialogDescription>
                {selectedSlot && (
                  <>
                    {formatDate(selectedSlot.date, intlLocale)} -{" "}
                    {mealTypeLabel(selectedSlot.mealType)}
                  </>
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="py-4">
              {/* Search recipes */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder={t("searchRecipes")}
                  value={recipeSearch}
                  onChange={(e) => setRecipeSearch(e.target.value)}
                  className="pl-10"
                />
                {recipeSearch && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 size-7"
                    onClick={() => setRecipeSearch("")}
                    aria-label={t("clearSearchAria")}
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>

              {/* Recipe list */}
              <ScrollArea className="h-[300px] pr-4">
                {isRecipesLoading ? (
                  <div className="flex flex-col gap-2">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : filteredRecipes.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <ChefHat className="size-8 mx-auto mb-2 opacity-50" />
                    <p>{t("noRecipesFound")}</p>
                    <Link href="/recipes/new">
                      <Button variant="link" size="sm">
                        {t("createRecipe")}
                      </Button>
                    </Link>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {filteredRecipes.map((recipe) => (
                      <RecipeSidebarItem
                        key={recipe.id}
                        recipe={recipe}
                        onSelect={() => handleAddRecipe(recipe)}
                      />
                    ))}
                  </div>
                )}
              </ScrollArea>

              {/* Divider */}
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">
                    {t("or")}
                  </span>
                </div>
              </div>

              {/* Note input */}
              <div>
                <p className="text-sm font-medium mb-2">{t("noteHeading")}</p>
                <Textarea
                  placeholder={t("notePlaceholder")}
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  rows={2}
                />
                <Button
                  onClick={handleAddNote}
                  disabled={!noteInput.trim() || addEntry.isPending}
                  className="mt-2"
                >
                  {addEntry.isPending ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="size-4 mr-2" />
                  )}
                  {t("noteSave")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Reschedule Dialog */}
        <Dialog open={showRescheduleDialog} onOpenChange={setShowRescheduleDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("rescheduleTitle")}</DialogTitle>
              <DialogDescription>
                {t("rescheduleDescription", { target: selectedEntry?.recipe?.title || selectedEntry?.note || "" })}
              </DialogDescription>
            </DialogHeader>

            <div className="py-4 flex flex-col gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  {t("fieldNewDate")}
                </label>
                <Input
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">
                  {t("fieldMealSlot")}
                </label>
                <Select
                  value={rescheduleMealType}
                  onValueChange={(v) => setRescheduleMealType(v as MealType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEAL_TYPES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {mealTypeLabel(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowRescheduleDialog(false)}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                onClick={handleRescheduleConfirm}
                disabled={!rescheduleDate || rescheduleEntry.isPending}
              >
                {rescheduleEntry.isPending ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : null}
                {t("rescheduleConfirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Shopping List Generation Dialog */}
        <Dialog open={showShoppingDialog} onOpenChange={setShowShoppingDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("shoppingDialogTitle")}</DialogTitle>
              <DialogDescription>
                {t("shoppingDialogDescription")}
              </DialogDescription>
            </DialogHeader>

            <div className="py-4">
              <ScrollArea className="h-[300px] pr-4">
                <div className="flex flex-col gap-2">
                  {entriesWithRecipes.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      {t("noRecipesPlanned")}
                    </p>
                  ) : (
                    entriesWithRecipes.map((entry) => (
                      <label
                        key={entry.id}
                        className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedShoppingEntries.has(entry.id)}
                          onChange={() => toggleShoppingEntry(entry.id)}
                          className="rounded"
                        />
                        <div className="flex-1">
                          <p className="font-medium">{entry.recipe?.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(entry.date, intlLocale)} -{" "}
                            {mealTypeLabel(entry.meal_type)}
                            {entry.servings && ` ${t("servingsSuffix", { count: entry.servings })}`}
                          </p>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowShoppingDialog(false)}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                onClick={handleGenerateShopping}
                disabled={generateShopping.isPending || entriesWithRecipes.length === 0}
              >
                {generateShopping.isPending ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <ShoppingCart className="size-4 mr-2" />
                )}
                {selectedShoppingEntries.size > 0
                  ? t("shoppingButtonSelected", { count: selectedShoppingEntries.size })
                  : t("shoppingButtonAll")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Ingredient Selection Dialog for Single Entry */}
        <Dialog open={showIngredientDialog} onOpenChange={setShowIngredientDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("ingredientDialogTitle")}</DialogTitle>
              <DialogDescription>
                {ingredientEntry?.recipe?.title && t.rich("ingredientDialogDescription", {
                  recipe: ingredientEntry.recipe.title,
                  bold: (chunks) => <strong>{chunks}</strong>,
                })}
              </DialogDescription>
            </DialogHeader>

            <div className="py-4">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-muted-foreground">
                  {t("ingredientsSelectedCount", { selected: selectedIngredients.size, total: ingredientRecipe?.ingredients?.length || 0 })}
                </span>
                <Button variant="ghost" size="sm" onClick={toggleAllIngredients}>
                  {selectedIngredients.size === ingredientRecipe?.ingredients?.length
                    ? t("deselectAllIngredients")
                    : t("selectAllIngredients")}
                </Button>
              </div>

              <ScrollArea className="h-[300px] pr-4">
                <div className="flex flex-col gap-2">
                  {!ingredientRecipe?.ingredients ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="size-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : ingredientRecipe.ingredients.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      {t("noIngredients")}
                    </p>
                  ) : (
                    ingredientRecipe.ingredients.map((ingredient) => (
                      <div
                        key={ingredient.id}
                        onClick={() => toggleIngredient(ingredient.id)}
                        className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                      >
                        <div
                          className={`size-5 shrink-0 rounded-md border flex items-center justify-center transition-colors ${
                            selectedIngredients.has(ingredient.id)
                              ? "bg-primary border-primary text-primary-foreground"
                              : "border-input"
                          }`}
                        >
                          {selectedIngredients.has(ingredient.id) && (
                            <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <span className="flex-1">
                          {ingredient.quantity && (
                            <span className="font-medium">
                              {ingredient.quantity}
                              {ingredient.unit && ` ${ingredient.unit}`}{" "}
                            </span>
                          )}
                          {ingredient.name}
                          {ingredient.notes && (
                            <span className="text-muted-foreground">
                              {" "}
                              ({ingredient.notes})
                            </span>
                          )}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowIngredientDialog(false);
                  setIngredientEntry(null);
                }}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                onClick={handleAddIngredientsToShopping}
                disabled={addToShoppingList.isPending}
              >
                {addToShoppingList.isPending ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <ShoppingCart className="size-4 mr-2" />
                )}
                {selectedIngredients.size > 0
                  ? t("addIngredientsSelected", { count: selectedIngredients.size })
                  : t("addIngredientsAll")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Recipe Detail Dialog */}
        <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ChefHat className="size-5 text-primary" />
                {detailEntry?.recipe?.title || t("detailDialogFallback")}
              </DialogTitle>
              {detailEntry && (
                <DialogDescription>
                  {formatDate(detailEntry.date, intlLocale)} - {mealTypeLabel(detailEntry.meal_type)}
                  {detailEntry.servings && ` ${t("detailServings", { count: detailEntry.servings })}`}
                </DialogDescription>
              )}
            </DialogHeader>

            <ScrollArea className="flex-1 -mx-6 px-6">
              {isDetailLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-8 animate-spin text-muted-foreground" />
                </div>
              ) : detailRecipe ? (
                <div className="flex flex-col gap-6 py-4">
                  {/* Recipe image */}
                  {detailRecipe.image_url && (
                    <div className="relative aspect-video rounded-xl overflow-hidden">
                      <img
                        src={detailRecipe.image_url}
                        alt={detailRecipe.title}
                        className="absolute inset-0 size-full object-cover"
                      />
                    </div>
                  )}

                  {/* Recipe info */}
                  <div className="flex flex-wrap gap-4">
                    {detailRecipe.prep_time_minutes && (
                      <div className="flex items-center gap-2 text-sm">
                        <Clock className="size-4 text-muted-foreground" />
                        <span>{t("detailPrepTime", { minutes: detailRecipe.prep_time_minutes })}</span>
                      </div>
                    )}
                    {detailRecipe.cook_time_minutes && (
                      <div className="flex items-center gap-2 text-sm">
                        <Clock className="size-4 text-muted-foreground" />
                        <span>{t("detailCookTime", { minutes: detailRecipe.cook_time_minutes })}</span>
                      </div>
                    )}
                    {detailRecipe.servings && (
                      <div className="flex items-center gap-2 text-sm">
                        <Users className="size-4 text-muted-foreground" />
                        <span>{t("detailServingsSection", { count: detailRecipe.servings })}</span>
                      </div>
                    )}
                  </div>

                  {/* Description */}
                  {detailRecipe.description && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2">{t("detailDescriptionHeading")}</h4>
                      <p className="text-sm text-muted-foreground">{detailRecipe.description}</p>
                    </div>
                  )}

                  {/* Ingredients */}
                  {detailRecipe.ingredients && detailRecipe.ingredients.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2">
                        {t("detailIngredientsHeading", { count: detailRecipe.ingredients.length })}
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {detailRecipe.ingredients.map((ing) => (
                          <div
                            key={ing.id}
                            className="flex items-center gap-2 text-sm p-2 rounded-lg bg-muted/30"
                          >
                            <span className="font-medium text-primary">
                              {ing.quantity}
                              {ing.unit && ` ${ing.unit}`}
                            </span>
                            <span>{ing.name}</span>
                            {ing.notes && (
                              <span className="text-muted-foreground text-xs">({ing.notes})</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Instructions */}
                  {detailRecipe.instructions && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2">{t("detailInstructionsHeading")}</h4>
                      <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {typeof detailRecipe.instructions === "string"
                          ? detailRecipe.instructions
                          : JSON.stringify(detailRecipe.instructions, null, 2)}
                      </div>
                    </div>
                  )}

                  {/* Note if present */}
                  {detailEntry?.note && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2">{t("detailNoteHeading")}</h4>
                      <p className="text-sm text-muted-foreground italic">{detailEntry.note}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  {t("detailLoadFailed")}
                </div>
              )}
            </ScrollArea>

            <DialogFooter className="flex-shrink-0 gap-2 sm:gap-0">
              <Link href={`/recipes/${detailEntry?.recipe_id}`}>
                <Button variant="outline">
                  <ChefHat className="size-4 mr-2" />
                  {t("detailGoToRecipe")}
                </Button>
              </Link>
              <Button
                onClick={() => {
                  if (detailEntry) {
                    setShowDetailDialog(false);
                    handleEntryAction("shopping", detailEntry);
                  }
                }}
                disabled={!detailEntry?.recipe_id}
              >
                <ShoppingCart className="size-4 mr-2" />
                {t("detailToShopping")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Note Dialog */}
        <Dialog open={showEditNoteDialog} onOpenChange={setShowEditNoteDialog}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Edit className="size-5 text-primary" />
                {t("editNoteTitle")}
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <Input
                value={editNoteInput}
                onChange={(e) => setEditNoteInput(e.target.value)}
                placeholder={t("editNotePlaceholder")}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && editNoteInput.trim() && editNoteEntry) {
                    updateEntry.mutateAsync({
                      weekStart,
                      update: { id: editNoteEntry.id, note: editNoteInput.trim() },
                    }).then(() => {
                      setShowEditNoteDialog(false);
                      toast.success(t("noteSaved"));
                    }).catch(() => {
                      toast.error(t("noteSaveFailed"));
                    });
                  }
                }}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowEditNoteDialog(false)}>
                  {tCommon("cancel")}
                </Button>
                <Button
                  disabled={!editNoteInput.trim() || updateEntry.isPending}
                  onClick={async () => {
                    if (!editNoteEntry) return;
                    try {
                      await updateEntry.mutateAsync({
                        weekStart,
                        update: { id: editNoteEntry.id, note: editNoteInput.trim() },
                      });
                      setShowEditNoteDialog(false);
                      toast.success(t("noteSaved"));
                    } catch {
                      toast.error(t("noteSaveFailed"));
                    }
                  }}
                >
                  {updateEntry.isPending ? (
                    <Loader2 className="size-4 animate-spin mr-2" />
                  ) : null}
                  {tCommon("save")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!entryPendingDelete} onOpenChange={(open) => !open && setEntryPendingDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("deleteDialogTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("deleteDialogDescription")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={async () => {
                  const entry = entryPendingDelete;
                  setEntryPendingDelete(null);
                  if (!entry) return;
                  try {
                    await deleteEntry.mutateAsync({ entryId: entry.id, weekStart });
                    const { recipe, ...entrySnapshot } = entry;
                    showUndoToast({
                      message: t("entryDeleted"),
                      undoLabel: tCommon("undo"),
                      errorMessage: tCommon("undoFailed"),
                      onUndo: async () => {
                        const supabase = createClient();

                        const { error } = await (supabase as any)
                          .from("meal_plan_entries")
                          .insert(entrySnapshot);
                        if (error) throw error;
                        if (family?.id) {
                          queryClient.invalidateQueries({
                            queryKey: mealPlanQueryKeys.week(family.id, weekStart),
                          });
                        }
                      },
                    });
                  } catch {
                    toast.error(t("deleteFailed"));
                  }
                }}
              >
                {tCommon("delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Mobile add FAB */}
        <FAB
          icon={Plus}
          onClick={() => handleAddClick(today, "dinner")}
          ariaLabel={t("fabAria")}
          className="sm:hidden"
        />
      </main>
    </TooltipProvider>
  );
}
