"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ChefHat,
  ArrowLeft,
  Heart,
  Clock,
  Users,
  ExternalLink,
  ShoppingCart,
  Edit,
  Trash2,
  Check,
  Minus,
  Plus,
  Loader2,
  Printer,
  Share2,
  Flame,
  CalendarPlus,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ChecklistItem } from "@/components/checklist-item";
import { PageHeader } from "@/components/page-header";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamilyStore } from "@/stores/family-store";
import { showUndoToast } from "@/lib/undo-toast";
import {
  useRecipe,
  useToggleRecipeFavorite,
  useDeleteRecipe,
  useAddRecipeToShoppingList,
  useAddMealPlanEntry,
  getWeekStart,
  useKeyboardShortcuts,
  useSwipeNavigation,
  recipeQueryKeys,
} from "@/hooks";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { formatRecipeTime } from "@/lib/recipe-time";
import { parseInstructions } from "@/lib/recipe-instructions";
import type { RecipeInstruction, RecipeIngredient, MealType } from "@/types/database";

// Difficulty colors
const DIFFICULTY_COLORS: Record<string, { bg: string; text: string }> = {
  einfach: { bg: "bg-success/10", text: "text-success" },
  mittel: { bg: "bg-warning/10", text: "text-warning" },
  schwer: { bg: "bg-destructive/10", text: "text-destructive" },
};

export default function RecipeDetailPage() {
  useKeyboardShortcuts();
  useSwipeNavigation();

  const t = useTranslations("recipes");
  const tCommon = useTranslations("common");
  const tMeals = useTranslations("meals");
  const params = useParams();
  const router = useRouter();
  const recipeId = params.id as string;

  // State
  const [servings, setServings] = useState<number | null>(null);
  const [selectedIngredients, setSelectedIngredients] = useState<Set<string>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showShoppingDialog, setShowShoppingDialog] = useState(false);
  const [showMealPlanDialog, setShowMealPlanDialog] = useState(false);
  const [mealPlanDate, setMealPlanDate] = useState<string>(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  });
  const [mealPlanType, setMealPlanType] = useState<MealType>("dinner");
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  // Data fetching
  const { data: recipe, isLoading, error } = useRecipe(recipeId);
  const toggleFavorite = useToggleRecipeFavorite();
  const deleteRecipe = useDeleteRecipe();
  const addToShoppingList = useAddRecipeToShoppingList();
  const addMealPlanEntry = useAddMealPlanEntry();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  // Initialize servings from recipe
  const effectiveServings = servings ?? recipe?.servings ?? 4;
  const multiplier = recipe?.servings ? effectiveServings / recipe.servings : 1;

  // Parse instructions
  const instructions: RecipeInstruction[] = parseInstructions(recipe?.instructions);

  // Format time
  const formatTime = (m: number | null) => formatRecipeTime(t, m);

  // Format quantity
  const formatQuantity = (quantity: number | null) => {
    if (!quantity) return "";
    const scaled = quantity * multiplier;
    // Round to nice fractions
    if (scaled % 1 === 0) return scaled.toString();
    if (scaled % 0.5 === 0) return scaled.toFixed(1);
    return scaled.toFixed(2).replace(/\.?0+$/, "");
  };

  // Handle delete
  const handleDelete = async () => {
    if (!recipe) return;

    // recipe (ingredients included) is already loaded via useRecipe; tag
    // assignments aren't, so fetch them just-in-time before the cascade delete.
    const supabase = createClient();
    let tagAssignmentSnapshot: { recipe_id: string; tag_id: string }[] = [];
    try {
      const { data } = await (supabase as any)
        .from("recipe_tag_assignments")
        .select("*")
        .eq("recipe_id", recipeId);
      tagAssignmentSnapshot = data ?? [];
    } catch {
      // Best-effort snapshot — undo will still restore the recipe + ingredients.
    }

    const { ingredients, tags: _tags, ...recipeSnapshot } = recipe;
    const ingredientSnapshot = ingredients;

    try {
      await deleteRecipe.mutateAsync(recipeId);
      router.push("/recipes");
      // Fire the undo toast after navigation — sonner's Toaster is mounted at
      // the root layout, so it survives the route change to /recipes.
      showUndoToast({
        message: t("recipeDeleted"),
        undoLabel: tCommon("undo"),
        errorMessage: tCommon("undoFailed"),
        onUndo: async () => {
          const undoClient = createClient();
          const { error: recipeError } = await (undoClient as any)
            .from("recipes")
            .insert(recipeSnapshot);
          if (recipeError) throw recipeError;
          if (ingredientSnapshot.length > 0) {
            const { error: ingredientsError } = await (undoClient as any)
              .from("recipe_ingredients")
              .insert(ingredientSnapshot);
            if (ingredientsError) throw ingredientsError;
          }
          if (tagAssignmentSnapshot.length > 0) {
            const { error: tagsError } = await (undoClient as any)
              .from("recipe_tag_assignments")
              .insert(tagAssignmentSnapshot);
            if (tagsError) throw tagsError;
          }
          if (family?.id) {
            queryClient.invalidateQueries({ queryKey: recipeQueryKeys.all(family.id) });
          }
        },
      });
    } catch {
      toast.error(t("deleteFailed"));
    }
  };

  // Handle add to meal plan
  const handleAddToMealPlan = async () => {
    try {
      await addMealPlanEntry.mutateAsync({
        weekStart: getWeekStart(new Date(`${mealPlanDate}T12:00:00`)),
        entry: {
          date: mealPlanDate,
          meal_type: mealPlanType,
          recipe_id: recipe!.id,
          servings: effectiveServings,
        },
      });
      setShowMealPlanDialog(false);
      toast.success(t("detail.mealPlanAdded"));
    } catch {
      toast.error(t("detail.mealPlanAddFailed"));
    }
  };

  // Handle add to shopping list
  const handleAddToShoppingList = async (selectedOnly: boolean) => {
    try {
      await addToShoppingList.mutateAsync({
        recipeId,
        servings: effectiveServings,
        ingredientIds: selectedOnly ? Array.from(selectedIngredients) : undefined,
      });
      setShowShoppingDialog(false);
      setSelectedIngredients(new Set());
    } catch {
      toast.error(t("detail.addFailed"));
    }
  };

  // Toggle ingredient selection
  const toggleIngredient = (id: string) => {
    const newSet = new Set(selectedIngredients);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIngredients(newSet);
  };

  // Toggle all ingredients
  const toggleAllIngredients = () => {
    if (selectedIngredients.size === recipe?.ingredients?.length) {
      setSelectedIngredients(new Set());
    } else {
      setSelectedIngredients(new Set(recipe?.ingredients?.map((i) => i.id) || []));
    }
  };

  // Toggle step completion
  const toggleStep = (step: number) => {
    const newSet = new Set(completedSteps);
    if (newSet.has(step)) {
      newSet.delete(step);
    } else {
      newSet.add(step);
    }
    setCompletedSteps(newSet);
  };

  // Loading state
  if (isLoading) {
    return (
      <TooltipProvider>
        <main id="main-content" className="min-h-page relative overflow-hidden">
          <div className="page-gradient" />
          <div className="relative z-10 p-4 md:p-8 max-w-6xl mx-auto safe-area-inset">
            <div className="flex items-center gap-3 mb-8">
              <Skeleton className="size-10 rounded-lg" />
              <Skeleton className="h-8 w-48" />
            </div>
            <Skeleton className="h-64 w-full rounded-xl mb-6" />
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="p-4">
                <Skeleton className="h-6 w-24 mb-4" />
                <div className="flex flex-col gap-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              </Card>
              <Card className="p-4">
                <Skeleton className="h-6 w-32 mb-4" />
                <div className="flex flex-col gap-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              </Card>
            </div>
          </div>
        </main>
      </TooltipProvider>
    );
  }

  // Error or not found
  if (error || !recipe) {
    return (
      <TooltipProvider>
        <main id="main-content" className="min-h-page relative overflow-hidden">
          <div className="page-gradient" />
          <div className="relative z-10 p-4 md:p-8 max-w-6xl mx-auto safe-area-inset">
            <Card className="p-8 text-center">
              <ChefHat className="size-12 mx-auto mb-3 text-destructive opacity-50" />
              <p className="text-destructive font-medium">{t("detail.notFoundTitle")}</p>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                {t("detail.notFoundDescription")}
              </p>
              <Link href="/recipes">
                <Button variant="outline">
                  <ArrowLeft className="size-4 mr-2" />
                  {t("detail.backToRecipes")}
                </Button>
              </Link>
            </Card>
          </div>
        </main>
      </TooltipProvider>
    );
  }

  const difficulty = DIFFICULTY_COLORS[recipe.difficulty || ""] || DIFFICULTY_COLORS.einfach;
  const difficultyLabels: Record<string, string> = {
    einfach: t("difficulty.einfach"),
    mittel: t("difficulty.mittel"),
    schwer: t("difficulty.schwer"),
  };

  return (
    <TooltipProvider>
      <main id="main-content" className="min-h-page relative overflow-hidden">
        {/* Background */}
        <div className="page-gradient" />

        <div className="relative z-10 p-4 md:p-8 max-w-6xl mx-auto safe-area-inset">
          <PageHeader
            icon={ChefHat}
            title={recipe.title}
            backHref="/recipes"
            className="mb-6"
            actions={
              <>
                <Button variant="ghost" size="icon" onClick={() => window.print()} aria-label={t("detail.printAria")}>
                  <Printer className="size-5" />
                </Button>
                <Link href={`/recipes/${recipe.id}/edit`}>
                  <Button variant="ghost" size="icon" aria-label={t("detail.editAria")}>
                    <Edit className="size-5" />
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  aria-label={t("detail.deleteAria")}
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <Trash2 className="size-5" />
                </Button>
              </>
            }
          />

          {/* Photo header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-6"
          >
            <div className="relative h-64 md:h-80 overflow-hidden rounded-2xl bg-muted">
              {recipe.image_url ? (
                <img
                  src={recipe.image_url}
                  alt={recipe.title}
                  className="size-full object-cover"
                />
              ) : (
                <div className="flex size-full items-center justify-center">
                  <ChefHat className="size-20 text-muted-foreground/20" strokeWidth={1.75} />
                </div>
              )}
              {/* Scrim for control legibility over the photo */}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-transparent" />

              <Link href="/recipes" aria-label={t("detail.backToRecipes")}>
                <span className="absolute left-4 top-4 flex size-11 items-center justify-center rounded-xl bg-card/90 text-foreground transition-colors hover:bg-card">
                  <ArrowLeft className="size-5" strokeWidth={1.75} />
                </span>
              </Link>

              <button
                type="button"
                aria-label={recipe.is_favorite ? t("detail.favoriteRemove") : t("detail.favoriteAdd")}
                onClick={() =>
                  toggleFavorite.mutate({
                    id: recipe.id,
                    is_favorite: !recipe.is_favorite,
                  })
                }
                className="absolute right-4 top-4 flex size-11 items-center justify-center rounded-xl bg-card/90 text-foreground transition-colors hover:bg-card"
              >
                <Heart
                  className={`size-5 ${recipe.is_favorite ? "fill-destructive text-destructive" : ""}`}
                  strokeWidth={1.75}
                />
              </button>

              {recipe.source_url && (
                <a
                  href={recipe.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute bottom-4 right-4"
                >
                  <Badge variant="secondary" className="border-0 bg-black/55 text-white/90">
                    <ExternalLink className="size-3 mr-1" />
                    {recipe.source_domain || t("detail.sourceFallback")}
                  </Badge>
                </a>
              )}
            </div>
          </motion.div>

          {/* Meta Info */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mb-6"
          >
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                {recipe.total_time_minutes && (
                  <Badge variant="neutral" className="gap-1.5 px-3 py-1.5 text-sm">
                    <Clock className="size-4 text-primary" strokeWidth={1.75} />
                    {formatTime(recipe.total_time_minutes)}
                  </Badge>
                )}
                {recipe.prep_time_minutes && (
                  <Badge variant="neutral" className="gap-1.5 px-3 py-1.5 text-sm">
                    <Clock className="size-4 text-muted-foreground" strokeWidth={1.75} />
                    {t("detail.metaPrep")} {formatTime(recipe.prep_time_minutes)}
                  </Badge>
                )}
                {recipe.cook_time_minutes && (
                  <Badge variant="neutral" className="gap-1.5 px-3 py-1.5 text-sm">
                    <Clock className="size-4 text-muted-foreground" strokeWidth={1.75} />
                    {t("detail.metaCook")} {formatTime(recipe.cook_time_minutes)}
                  </Badge>
                )}

                {/* Servings adjuster pill */}
                <div className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1">
                  <Users className="size-4 text-muted-foreground" strokeWidth={1.75} />
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    aria-label={t("detail.servingsDecreaseAria")}
                    onClick={() => setServings(Math.max(1, effectiveServings - 1))}
                  >
                    <Minus className="size-3" />
                  </Button>
                  <span className="w-6 text-center font-medium">{effectiveServings}</span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    aria-label={t("detail.servingsIncreaseAria")}
                    onClick={() => setServings(effectiveServings + 1)}
                  >
                    <Plus className="size-3" />
                  </Button>
                  <span className="text-sm text-muted-foreground">{t("detail.servingsLabel")}</span>
                </div>

                {recipe.difficulty && (
                  <Badge className={`${difficulty.bg} ${difficulty.text} gap-1.5 border-0 px-3 py-1.5 text-sm`}>
                    <Flame className="size-4" strokeWidth={1.75} />
                    {difficultyLabels[recipe.difficulty] || recipe.difficulty}
                  </Badge>
                )}
              </div>

              {recipe.description && (
                <p className="mt-4 text-muted-foreground">{recipe.description}</p>
              )}
            </Card>
          </motion.div>

          {/* Main Content Grid */}
          <div className="grid md:grid-cols-[300px_1fr] gap-6">
            {/* Ingredients */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <Card className="p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-semibold">{t("detail.ingredientsHeading")}</h2>
                  <Button variant="outline" size="sm" onClick={() => setShowShoppingDialog(true)}>
                    <ShoppingCart className="size-4 mr-2" />
                    {t("detail.toListButton")}
                  </Button>
                </div>

                <div className="flex flex-col gap-2">
                  {recipe.ingredients?.map((ingredient) => (
                    <ChecklistItem
                      key={ingredient.id}
                      checked={selectedIngredients.has(ingredient.id)}
                      onCheckedChange={() => toggleIngredient(ingredient.id)}
                      label={
                        <>
                          {ingredient.name}
                          {ingredient.notes && (
                            <span className="text-muted-foreground"> ({ingredient.notes})</span>
                          )}
                        </>
                      }
                      meta={
                        ingredient.quantity ? (
                          <span className="tabular-nums">
                            {formatQuantity(ingredient.quantity)}
                            {ingredient.unit ? ` ${ingredient.unit}` : ""}
                          </span>
                        ) : undefined
                      }
                    />
                  ))}
                </div>
              </Card>
            </motion.div>

            {/* Instructions */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
            >
              <Card className="p-4">
                <h2 className="font-semibold mb-4">{t("detail.instructionsHeading")}</h2>

                <div className="flex flex-col gap-4">
                  {instructions.map((instruction, index) => (
                    <div
                      key={index}
                      className={`flex gap-4 p-3 rounded-lg transition-all cursor-pointer ${
                        completedSteps.has(instruction.step)
                          ? "bg-success/10 opacity-60"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => toggleStep(instruction.step)}
                    >
                      <div
                        className={`shrink-0 size-8 rounded-full flex items-center justify-center font-medium ${
                          completedSteps.has(instruction.step)
                            ? "bg-success text-white"
                            : "bg-primary/10 text-primary"
                        }`}
                      >
                        {completedSteps.has(instruction.step) ? (
                          <Check className="size-4" />
                        ) : (
                          instruction.step
                        )}
                      </div>
                      <div className="flex-1">
                        <p
                          className={
                            completedSteps.has(instruction.step)
                              ? "line-through text-muted-foreground"
                              : ""
                          }
                        >
                          {instruction.text}
                        </p>
                        {instruction.image_url && (
                          <img
                            src={instruction.image_url}
                            alt={t("detail.stepImageAlt", { step: instruction.step })}
                            className="mt-2 rounded-lg max-h-48 object-cover"
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </motion.div>
          </div>

          {/* Footer actions */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-6 flex flex-col gap-3 sm:flex-row"
          >
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowMealPlanDialog(true)}
            >
              <CalendarPlus className="size-4 mr-2" />
              {t("detail.toMealPlanButton")}
            </Button>
            <Button
              variant="default"
              className="flex-1"
              onClick={() => setShowShoppingDialog(true)}
            >
              <ShoppingCart className="size-4 mr-2" />
              {t("detail.toListButton")}
            </Button>
          </motion.div>
        </div>

        {/* Delete Dialog */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("detail.deleteRecipeDescription", { title: recipe.title })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteRecipe.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  tCommon("delete")
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Meal Plan Dialog */}
        <Dialog open={showMealPlanDialog} onOpenChange={setShowMealPlanDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("detail.mealPlanDialogTitle")}</DialogTitle>
              <DialogDescription>{t("detail.mealPlanDialogDescription")}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="mealPlanDate" className="text-sm font-medium">
                  {t("detail.mealPlanDateLabel")}
                </label>
                <Input
                  id="mealPlanDate"
                  type="date"
                  value={mealPlanDate}
                  onChange={(e) => setMealPlanDate(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="mealPlanType" className="text-sm font-medium">
                  {t("detail.mealPlanTypeLabel")}
                </label>
                <Select value={mealPlanType} onValueChange={(v) => setMealPlanType(v as MealType)}>
                  <SelectTrigger id="mealPlanType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="breakfast">{tMeals("mealType.breakfast")}</SelectItem>
                    <SelectItem value="lunch">{tMeals("mealType.lunch")}</SelectItem>
                    <SelectItem value="dinner">{tMeals("mealType.dinner")}</SelectItem>
                    <SelectItem value="snack">{tMeals("mealType.snack")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowMealPlanDialog(false)}>
                {tCommon("cancel")}
              </Button>
              <Button onClick={handleAddToMealPlan} disabled={addMealPlanEntry.isPending}>
                {addMealPlanEntry.isPending ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    {t("detail.mealPlanAdding")}
                  </>
                ) : (
                  t("detail.mealPlanConfirm")
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Shopping List Dialog */}
        <Dialog open={showShoppingDialog} onOpenChange={setShowShoppingDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("detail.shoppingDialogTitle")}</DialogTitle>
              <DialogDescription>
                {t("detail.shoppingDialogDescription")}
              </DialogDescription>
            </DialogHeader>

            <div className="py-4">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-muted-foreground">
                  {t("detail.selectedCount", {
                    selected: selectedIngredients.size,
                    total: recipe.ingredients?.length || 0,
                  })}
                </span>
                <Button variant="ghost" size="sm" onClick={toggleAllIngredients}>
                  {selectedIngredients.size === recipe.ingredients?.length
                    ? t("detail.deselectAll")
                    : t("detail.selectAll")}
                </Button>
              </div>

              <div className="max-h-64 overflow-y-auto flex flex-col gap-2">
                {recipe.ingredients?.map((ingredient) => (
                  <label
                    key={ingredient.id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedIngredients.has(ingredient.id)}
                      onCheckedChange={() => toggleIngredient(ingredient.id)}
                    />
                    <span>
                      {ingredient.quantity && (
                        <span className="font-medium">
                          {formatQuantity(ingredient.quantity)}
                          {ingredient.unit && ` ${ingredient.unit}`}{" "}
                        </span>
                      )}
                      {ingredient.name}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowShoppingDialog(false)}>
                {tCommon("cancel")}
              </Button>
              <Button
                onClick={() => handleAddToShoppingList(selectedIngredients.size > 0)}
                disabled={addToShoppingList.isPending}
              >
                {addToShoppingList.isPending ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    {t("detail.addingLabel")}
                  </>
                ) : selectedIngredients.size > 0 ? (
                  t("detail.addSelected", { count: selectedIngredients.size })
                ) : (
                  t("detail.addAll")
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </TooltipProvider>
  );
}
