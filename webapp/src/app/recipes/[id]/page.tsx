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
} from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
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
import {
  useRecipe,
  useToggleRecipeFavorite,
  useDeleteRecipe,
  useAddRecipeToShoppingList,
  useKeyboardShortcuts,
  useSwipeNavigation,
} from "@/hooks";
import type { RecipeInstruction, RecipeIngredient } from "@/types/database";

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
  const params = useParams();
  const router = useRouter();
  const recipeId = params.id as string;

  // State
  const [servings, setServings] = useState<number | null>(null);
  const [selectedIngredients, setSelectedIngredients] = useState<Set<string>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showShoppingDialog, setShowShoppingDialog] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  // Data fetching
  const { data: recipe, isLoading, error } = useRecipe(recipeId);
  const toggleFavorite = useToggleRecipeFavorite();
  const deleteRecipe = useDeleteRecipe();
  const addToShoppingList = useAddRecipeToShoppingList();


  // Initialize servings from recipe
  const effectiveServings = servings ?? recipe?.servings ?? 4;
  const multiplier = recipe?.servings ? effectiveServings / recipe.servings : 1;

  // Parse instructions
  const instructions: RecipeInstruction[] = recipe?.instructions
    ? (typeof recipe.instructions === "string"
        ? JSON.parse(recipe.instructions)
        : recipe.instructions)
    : [];

  // Format time
  const formatTime = (minutes: number | null) => {
    if (!minutes) return null;
    if (minutes < 60) return t("timeMinutes", { count: minutes });
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? t("timeHoursMinutes", { hours, minutes: mins }) : t("timeHours", { hours });
  };

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
    try {
      await deleteRecipe.mutateAsync(recipeId);
      router.push("/recipes");
    } catch {
      toast.error(t("deleteFailed"));
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
        <main id="main-content" className="min-h-screen relative overflow-hidden">
          <div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none" />
          <div className="relative z-10 p-4 md:p-8 max-w-6xl mx-auto safe-area-inset">
            <div className="flex items-center gap-3 mb-8">
              <Skeleton className="size-10 rounded-lg" />
              <Skeleton className="h-8 w-48" />
            </div>
            <Skeleton className="h-64 w-full rounded-xl mb-6" />
            <div className="grid md:grid-cols-2 gap-6">
              <GlassCard className="p-4">
                <Skeleton className="h-6 w-24 mb-4" />
                <div className="flex flex-col gap-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              </GlassCard>
              <GlassCard className="p-4">
                <Skeleton className="h-6 w-32 mb-4" />
                <div className="flex flex-col gap-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              </GlassCard>
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
        <main id="main-content" className="min-h-screen relative overflow-hidden">
          <div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none" />
          <div className="relative z-10 p-4 md:p-8 max-w-6xl mx-auto safe-area-inset">
            <GlassCard className="p-8 text-center">
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
            </GlassCard>
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
      <main id="main-content" className="min-h-screen relative overflow-hidden">
        {/* Background */}
        <div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none" />

        <div className="relative z-10 p-4 md:p-8 max-w-6xl mx-auto safe-area-inset">
          <PageHeader
            icon={ChefHat}
            title={recipe.title}
            backHref="/recipes"
            className="mb-6"
            actions={
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={recipe.is_favorite ? t("detail.favoriteRemove") : t("detail.favoriteAdd")}
                  onClick={() =>
                    toggleFavorite.mutate({
                      id: recipe.id,
                      is_favorite: !recipe.is_favorite,
                    })
                  }
                >
                  <Heart
                    className={`size-5 ${
                      recipe.is_favorite ? "fill-destructive text-destructive" : ""
                    }`}
                  />
                </Button>
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

          {/* Hero Image */}
          {recipe.image_url && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="mb-6"
            >
              <div className="relative rounded-xl overflow-hidden h-64 md:h-80">
                <img
                  src={recipe.image_url}
                  alt={recipe.title}
                  className="size-full object-cover"
                />
                {recipe.source_url && (
                  <a
                    href={recipe.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute bottom-4 right-4"
                  >
                    <Badge variant="secondary" className="backdrop-blur-sm">
                      <ExternalLink className="size-3 mr-1" />
                      {recipe.source_domain || t("detail.sourceFallback")}
                    </Badge>
                  </a>
                )}
              </div>
            </motion.div>
          )}

          {/* Meta Info */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mb-6"
          >
            <GlassCard className="p-4">
              <div className="flex flex-wrap items-center gap-4">
                {recipe.prep_time_minutes && (
                  <div className="flex items-center gap-2">
                    <Clock className="size-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">{t("detail.metaPrep")}</p>
                      <p className="font-medium">{formatTime(recipe.prep_time_minutes)}</p>
                    </div>
                  </div>
                )}
                {recipe.cook_time_minutes && (
                  <div className="flex items-center gap-2">
                    <Clock className="size-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">{t("detail.metaCook")}</p>
                      <p className="font-medium">{formatTime(recipe.cook_time_minutes)}</p>
                    </div>
                  </div>
                )}
                {recipe.total_time_minutes && (
                  <div className="flex items-center gap-2">
                    <Clock className="size-4 text-month-primary" />
                    <div>
                      <p className="text-xs text-muted-foreground">{t("detail.metaTotal")}</p>
                      <p className="font-medium">{formatTime(recipe.total_time_minutes)}</p>
                    </div>
                  </div>
                )}

                <Separator orientation="vertical" className="h-10" />

                {/* Servings Adjuster */}
                <div className="flex items-center gap-2">
                  <Users className="size-4 text-muted-foreground" />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      onClick={() => setServings(Math.max(1, effectiveServings - 1))}
                    >
                      <Minus className="size-3" />
                    </Button>
                    <span className="w-8 text-center font-medium">{effectiveServings}</span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      onClick={() => setServings(effectiveServings + 1)}
                    >
                      <Plus className="size-3" />
                    </Button>
                    <span className="text-sm text-muted-foreground">{t("detail.servingsLabel")}</span>
                  </div>
                </div>

                {recipe.difficulty && (
                  <>
                    <Separator orientation="vertical" className="h-10" />
                    <Badge className={`${difficulty.bg} ${difficulty.text} border-0`}>
                      {difficultyLabels[recipe.difficulty] || recipe.difficulty}
                    </Badge>
                  </>
                )}
              </div>

              {recipe.description && (
                <p className="text-muted-foreground mt-4">{recipe.description}</p>
              )}
            </GlassCard>
          </motion.div>

          {/* Main Content Grid */}
          <div className="grid md:grid-cols-[300px_1fr] gap-6">
            {/* Ingredients */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <GlassCard className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold">{t("detail.ingredientsHeading")}</h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowShoppingDialog(true)}
                  >
                    <ShoppingCart className="size-4 mr-2" />
                    {t("detail.shoppingButton")}
                  </Button>
                </div>

                <div className="flex flex-col gap-2">
                  {recipe.ingredients?.map((ingredient) => (
                    <label
                      key={ingredient.id}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                    >
                      <Checkbox
                        checked={selectedIngredients.has(ingredient.id)}
                        onCheckedChange={() => toggleIngredient(ingredient.id)}
                      />
                      <span className="flex-1">
                        {ingredient.quantity && (
                          <span className="font-medium">
                            {formatQuantity(ingredient.quantity)}
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
                    </label>
                  ))}
                </div>
              </GlassCard>
            </motion.div>

            {/* Instructions */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
            >
              <GlassCard className="p-4">
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
                            : "bg-month-primary/10 text-month-primary"
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
              </GlassCard>
            </motion.div>
          </div>
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
