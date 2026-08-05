"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ChefHat,
  Plus,
  Search,
  Heart,
  Clock,
  Users,
  ExternalLink,
  Grid3X3,
  List,
  Import,
  Trash2,
  Loader2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FAB } from "@/components/fab";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamilyStore } from "@/stores/family-store";
import { showUndoToast } from "@/lib/undo-toast";
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import {
  useRecipes,
  useRecipeSearch,
  useToggleRecipeFavorite,
  useDeleteRecipe,
  useImportRecipe,
  useRecipeTags,
  useKeyboardShortcuts,
  useSwipeNavigation,
  recipeQueryKeys,
} from "@/hooks";
import { formatRecipeTime } from "@/lib/recipe-time";
import type { Recipe, RecipeIngredient, RecipeWithIngredients, RecipeTag } from "@/types/database";

// Type for recipe card that accepts either Recipe or RecipeWithIngredients
type RecipeCardData = Recipe & { ingredients?: RecipeWithIngredients["ingredients"] };

// Difficulty colors
const DIFFICULTY_COLORS: Record<string, { bg: string; text: string }> = {
  einfach: { bg: "bg-success/10", text: "text-success" },
  mittel: { bg: "bg-warning/10", text: "text-warning" },
  schwer: { bg: "bg-destructive/10", text: "text-destructive" },
};

export default function RecipesPage() {
  useKeyboardShortcuts();
  useSwipeNavigation();

  const t = useTranslations("recipes");
  const tCommon = useTranslations("common");

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [filter, setFilter] = useState<"all" | "favorites">("all");
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"recent" | "name" | "time">("recent");
  const [importUrl, setImportUrl] = useState("");
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [deleteRecipeId, setDeleteRecipeId] = useState<string | null>(null);

  // Data fetching
  const { data: recipes = [], isLoading, error, refetch } = useRecipes({
    favorites: filter === "favorites",
  });
  const { data: searchResults = [] } = useRecipeSearch(searchQuery);
  const toggleFavorite = useToggleRecipeFavorite();
  const deleteRecipe = useDeleteRecipe();
  const importRecipe = useImportRecipe();
  const { data: tags = [] } = useRecipeTags();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  const router = useRouter();

  // Filter and sort recipes
  const baseRecipes = searchQuery.length >= 2 ? searchResults : recipes;
  const displayedRecipes = activeTagId
    ? baseRecipes.filter((r) =>
        ((r as RecipeWithIngredients).tags ?? []).some((tag) => tag.id === activeTagId)
      )
    : baseRecipes;

  const sortedRecipes = [...displayedRecipes].sort((a, b) => {
    switch (sortBy) {
      case "name":
        return a.title.localeCompare(b.title);
      case "time":
        return (a.total_time_minutes || 999) - (b.total_time_minutes || 999);
      default:
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    }
  });

  // Handle import
  const handleImport = async () => {
    if (!importUrl.trim()) return;

    try {
      await importRecipe.mutateAsync(importUrl);
      setImportUrl("");
      setShowImportDialog(false);
    } catch {
      toast.error(t("importFailed"));
    }
  };

  // Handle delete
  const handleDelete = async () => {
    if (!deleteRecipeId) return;
    const id = deleteRecipeId;
    const supabase = createClient();

    // Just-in-time snapshot: the card being deleted may have come from search
    // results (no ingredients joined) rather than the favorites-filtered list,
    // so fetch recipe + children fresh instead of trusting cached data.
    let recipeSnapshot: Recipe | null = null;
    let ingredientSnapshot: RecipeIngredient[] = [];
    let tagAssignmentSnapshot: { recipe_id: string; tag_id: string }[] = [];
    try {
      const [{ data: recipeData }, { data: ingredientData }, { data: tagData }] = await Promise.all([
        (supabase as any).from("recipes").select("*").eq("id", id).single(),
        (supabase as any).from("recipe_ingredients").select("*").eq("recipe_id", id),
        (supabase as any).from("recipe_tag_assignments").select("*").eq("recipe_id", id),
      ]);
      recipeSnapshot = recipeData ?? null;
      ingredientSnapshot = (ingredientData as RecipeIngredient[] | null) ?? [];
      tagAssignmentSnapshot = tagData ?? [];
    } catch {
      // Best-effort snapshot — if it fails, delete still proceeds without undo.
    }

    try {
      await deleteRecipe.mutateAsync(id);
      setDeleteRecipeId(null);
      if (recipeSnapshot) {
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
      }
    } catch {
      toast.error(t("deleteFailed"));
    }
  };

  // Format time
  const formatTime = (m: number | null) => formatRecipeTime(t, m);

  // Loading state
  if (isLoading) {
    return (
      <TooltipProvider>
        <main id="main-content" className="min-h-screen relative overflow-hidden">
          <div className="page-gradient" />
          <div className="relative z-10 p-4 md:p-8 max-w-7xl mx-auto safe-area-inset">
            <PageHeader
              icon={ChefHat}
              title={t("title")}
              backHref="/"
              className="mb-8"
              subtitle={<Skeleton className="h-4 w-32" />}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Card key={i} className="overflow-hidden">
                  <Skeleton className="h-48 w-full" />
                  <div className="p-4">
                    <Skeleton className="h-6 w-3/4 mb-2" />
                    <Skeleton className="h-4 w-1/2 mb-2" />
                    <div className="flex gap-2">
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-5 w-12 rounded-full" />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </main>
      </TooltipProvider>
    );
  }

  // Error state
  if (error) {
    return (
      <TooltipProvider>
        <main id="main-content" className="min-h-screen relative overflow-hidden">
          <div className="page-gradient" />
          <div className="relative z-10 p-4 md:p-8 max-w-7xl mx-auto safe-area-inset">
            <Card className="p-8">
              <ErrorState
                icon={ChefHat}
                message={t("errorMessage")}
                onRetry={() => refetch()}
              />
            </Card>
          </div>
        </main>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <main id="main-content" className="min-h-screen relative overflow-hidden">
        {/* Background */}
        <div className="page-gradient" />

        {/* pb clears the fixed mobile nav (and the FAB) — without it the last
            recipe card stays under it no matter how far you scroll. */}
        <div className="relative z-10 p-4 md:p-8 max-w-7xl mx-auto safe-area-inset">
          <PageHeader
            icon={ChefHat}
            title={t("title")}
            subtitle={t("subtitleCount", { count: recipes.length })}
            backHref="/"
            className="mb-6"
            actions={
              <div className="flex items-center gap-2">
              {/* Import Button */}
              <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Import className="size-4 mr-2" />
                    {t("importButton")}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t("importDialogTitle")}</DialogTitle>
                    <DialogDescription>
                      {t("importDialogDescription")}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="py-4">
                    <Input
                      placeholder={t("importPlaceholder")}
                      value={importUrl}
                      onChange={(e) => setImportUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleImport();
                      }}
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setShowImportDialog(false)}
                    >
                      {tCommon("cancel")}
                    </Button>
                    <Button
                      onClick={handleImport}
                      disabled={!importUrl.trim() || importRecipe.isPending}
                    >
                      {importRecipe.isPending ? (
                        <>
                          <Loader2 className="size-4 mr-2 animate-spin" />
                          {t("importingLabel")}
                        </>
                      ) : (
                        t("importButton")
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Search in Chefkoch */}
              <Link href="/recipes/search">
                <Button variant="outline" size="sm">
                  <Search className="size-4 mr-2" />
                  {t("searchButton")}
                </Button>
              </Link>

              {/* Create New */}
              <Link href="/recipes/new">
                <Button size="sm">
                  <Plus className="size-4 mr-2" />
                  {t("newButton")}
                </Button>
              </Link>
              </div>
            }
          />

          {/* Filters and Search */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-6 sticky top-0 z-20"
          >
            <Card className="p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                {/* Search */}
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    placeholder={t("searchPlaceholder")}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 focus-visible:border-primary"
                  />
                </div>

                {/* Filters */}
                <div className="flex flex-wrap gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <RecipeFilterChip
                      label={t("filterAll")}
                      active={filter === "all" && !activeTagId}
                      onClick={() => {
                        setFilter("all");
                        setActiveTagId(null);
                      }}
                    />
                    <RecipeFilterChip
                      label={t("filterFavorites")}
                      active={filter === "favorites"}
                      onClick={() => {
                        setActiveTagId(null);
                        setFilter(filter === "favorites" ? "all" : "favorites");
                      }}
                    />
                    {tags.map((tag) => (
                      <RecipeFilterChip
                        key={tag.id}
                        label={tag.name}
                        active={activeTagId === tag.id}
                        onClick={() => {
                          setFilter("all");
                          setActiveTagId(activeTagId === tag.id ? null : tag.id);
                        }}
                      />
                    ))}
                  </div>

                  <Select value={sortBy} onValueChange={(v) => setSortBy(v as "recent" | "name" | "time")}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="recent">{t("sortRecent")}</SelectItem>
                      <SelectItem value="name">{t("sortName")}</SelectItem>
                      <SelectItem value="time">{t("sortTime")}</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* View Mode Toggle */}
                  <div className="flex border rounded-lg">
                    <Button
                      variant={viewMode === "grid" ? "secondary" : "ghost"}
                      size="icon"
                      className="size-9 rounded-r-none"
                      onClick={() => setViewMode("grid")}
                      aria-label={t("gridViewAria")}
                      aria-pressed={viewMode === "grid"}
                    >
                      <Grid3X3 className="size-4" />
                    </Button>
                    <Button
                      variant={viewMode === "list" ? "secondary" : "ghost"}
                      size="icon"
                      className="size-9 rounded-l-none"
                      onClick={() => setViewMode("list")}
                      aria-label={t("listViewAria")}
                      aria-pressed={viewMode === "list"}
                    >
                      <List className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>

          {/* Active filters & results summary */}
          {(searchQuery.length >= 2 || filter !== "all" || sortBy !== "recent") && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="flex flex-wrap items-center gap-2 mb-4"
            >
              <span className="text-sm text-muted-foreground">
                {t("resultsCount", { count: sortedRecipes.length })}
              </span>
              {searchQuery.length >= 2 && (
                <Badge
                  variant="secondary"
                  className="gap-1 cursor-pointer hover:bg-destructive/20"
                  onClick={() => setSearchQuery("")}
                >
                  {t("filterSearchBadge", { query: searchQuery })}
                  <span className="text-xs ml-1">×</span>
                </Badge>
              )}
              {filter === "favorites" && (
                <Badge
                  variant="secondary"
                  className="gap-1 cursor-pointer hover:bg-destructive/20"
                  onClick={() => setFilter("all")}
                >
                  <Heart className="size-3" /> {t("filterFavoritesBadge")}
                  <span className="text-xs ml-1">×</span>
                </Badge>
              )}
              {sortBy !== "recent" && (
                <Badge variant="outline" className="text-xs">
                  {sortBy === "name" ? t("sortedByName") : t("sortedByTime")}
                </Badge>
              )}
            </motion.div>
          )}

          {/* Recipe List */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            {/* Phones scroll the page itself: the fixed-height viewport left the
                last card behind the nav, reachable only by a second scroll. */}
            <ScrollArea className="h-auto md:h-[calc(100vh-280px)]">
              <AnimatePresence mode="popLayout">
                {sortedRecipes.length === 0 ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center py-16 text-muted-foreground"
                  >
                    <ChefHat className="size-12 mb-4 opacity-30" />
                    {searchQuery.length >= 2 ? (
                      <>
                        <p>{t("emptySearchTitle")}</p>
                        <p className="text-sm mt-1">
                          {t("emptySearchDescription", { query: searchQuery })}
                        </p>
                        <Button
                          variant="outline"
                          className="mt-4"
                          onClick={() => setSearchQuery("")}
                        >
                          {t("emptySearchAction")}
                        </Button>
                      </>
                    ) : filter === "favorites" ? (
                      <>
                        <p>{t("emptyFavoritesTitle")}</p>
                        <p className="text-sm mt-1">
                          {t("emptyFavoritesDescription")}
                        </p>
                        <Button
                          variant="outline"
                          className="mt-4"
                          onClick={() => setFilter("all")}
                        >
                          {t("emptyFavoritesAction")}
                        </Button>
                      </>
                    ) : (
                      <>
                        <p>{t("emptyTitle")}</p>
                        <p className="text-sm mt-1">
                          {t("emptyDescription")}
                        </p>
                        <div className="flex gap-2 mt-4">
                          <Button
                            variant="outline"
                            onClick={() => setShowImportDialog(true)}
                          >
                            <Import className="size-4 mr-2" />
                            {t("importButton")}
                          </Button>
                          <Link href="/recipes/new">
                            <Button>
                              <Plus className="size-4 mr-2" />
                              {t("newButton")}
                            </Button>
                          </Link>
                        </div>
                      </>
                    )}
                  </motion.div>
                ) : viewMode === "grid" ? (
                  // Grid View
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {sortedRecipes.map((recipe) => (
                      <RecipeCard
                        key={recipe.id}
                        recipe={recipe}
                        formatTime={formatTime}
                        onToggleFavorite={() =>
                          toggleFavorite.mutate({
                            id: recipe.id,
                            is_favorite: !recipe.is_favorite,
                          })
                        }
                        onDelete={() => setDeleteRecipeId(recipe.id)}
                      />
                    ))}
                  </div>
                ) : (
                  // List View
                  <div className="flex flex-col gap-2">
                    {sortedRecipes.map((recipe) => (
                      <RecipeListItem
                        key={recipe.id}
                        recipe={recipe}
                        formatTime={formatTime}
                        onToggleFavorite={() =>
                          toggleFavorite.mutate({
                            id: recipe.id,
                            is_favorite: !recipe.is_favorite,
                          })
                        }
                        onDelete={() => setDeleteRecipeId(recipe.id)}
                      />
                    ))}
                  </div>
                )}
              </AnimatePresence>
            </ScrollArea>
          </motion.div>
        </div>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!deleteRecipeId} onOpenChange={() => setDeleteRecipeId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("deleteDescription")}
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

        {/* Mobile FAB */}
        <div className="sm:hidden">
          <FAB
            icon={Plus}
            onClick={() => router.push("/recipes/new")}
            ariaLabel={t("newButton")}
          />
        </div>
      </main>
    </TooltipProvider>
  );
}

// Recipe Card Component (Grid View)
function RecipeCard({
  recipe,
  formatTime,
  onToggleFavorite,
  onDelete,
}: {
  recipe: RecipeCardData;
  formatTime: (minutes: number | null) => string | null;
  onToggleFavorite: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("recipes");
  const difficulty = DIFFICULTY_COLORS[recipe.difficulty || ""] || DIFFICULTY_COLORS.einfach;
  const difficultyLabels: Record<string, string> = {
    einfach: t("difficulty.einfach"),
    mittel: t("difficulty.mittel"),
    schwer: t("difficulty.schwer"),
  };

  return (
    <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <Link href={`/recipes/${recipe.id}`}>
        <Card className="overflow-hidden group cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all">
          {/* Image with gradient overlay */}
          <div className="relative h-52 bg-muted">
            {recipe.image_url ? (
              <img
                src={recipe.image_url}
                alt={recipe.title}
                className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
            ) : (
              <div className="size-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/50">
                <ChefHat className="size-16 text-muted-foreground/20" />
              </div>
            )}

            {/* Gradient overlay for text readability */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

            {/* Favorite Button */}
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleFavorite();
              }}
              className="absolute top-3 right-3 flex size-11 items-center justify-center rounded-full border border-border bg-card/90 text-foreground transition-colors hover:bg-card"
            >
              <Heart
                className={`size-4 ${recipe.is_favorite ? "fill-destructive text-destructive" : ""}`}
                strokeWidth={1.75}
              />
            </button>

            {/* Source badge */}
            {recipe.source_domain && (
              <div className="absolute top-3 left-3">
                <Badge variant="secondary" className="text-[10px] border-0 bg-black/55 text-white/90">
                  <ExternalLink className="size-2.5 mr-1" />
                  {recipe.source_domain}
                </Badge>
              </div>
            )}

            {/* Title + meta overlaid on image bottom */}
            <div className="absolute bottom-0 left-0 right-0 p-4">
              <h3 className="font-semibold text-white text-shadow-sm line-clamp-2 leading-tight">
                {recipe.title}
              </h3>
              <div className="flex items-center gap-2.5 mt-2">
                {recipe.total_time_minutes && (
                  <span className="flex items-center gap-1 text-xs text-white/70">
                    <Clock className="size-3" />
                    {formatTime(recipe.total_time_minutes)}
                  </span>
                )}
                {recipe.servings && (
                  <span className="flex items-center gap-1 text-xs text-white/70">
                    <Users className="size-3" />
                    {recipe.servings}
                  </span>
                )}
                {recipe.difficulty && (
                  <Badge className={`${difficulty.bg} ${difficulty.text} border-0 text-[10px] py-0 h-5`}>
                    {difficultyLabels[recipe.difficulty] || recipe.difficulty}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Description — only if present, kept compact */}
          {recipe.description && (
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground line-clamp-2">
                {recipe.description}
              </p>
            </div>
          )}
        </Card>
      </Link>
    </motion.div>
  );
}

// Recipe List Item Component (List View)
function RecipeListItem({
  recipe,
  formatTime,
  onToggleFavorite,
  onDelete,
}: {
  recipe: RecipeCardData;
  formatTime: (minutes: number | null) => string | null;
  onToggleFavorite: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("recipes");
  const difficulty = DIFFICULTY_COLORS[recipe.difficulty || ""] || DIFFICULTY_COLORS.einfach;
  const difficultyLabels: Record<string, string> = {
    einfach: t("difficulty.einfach"),
    mittel: t("difficulty.mittel"),
    schwer: t("difficulty.schwer"),
  };

  return (
    <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <Link href={`/recipes/${recipe.id}`}>
        <Card className="p-4 group cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all">
          <div className="flex gap-4">
            {/* Image */}
            <div className="shrink-0 size-24 rounded-lg bg-muted overflow-hidden">
              {recipe.image_url ? (
                <img
                  src={recipe.image_url}
                  alt={recipe.title}
                  className="size-full object-cover"
                />
              ) : (
                <div className="size-full flex items-center justify-center">
                  <ChefHat className="size-8 text-muted-foreground/30" />
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold truncate group-hover:text-primary transition-colors">
                  {recipe.title}
                </h3>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onToggleFavorite();
                    }}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                  >
                    <Heart
                      className={`size-4 ${
                        recipe.is_favorite ? "fill-destructive text-destructive" : "text-muted-foreground"
                      }`}
                    />
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onDelete();
                    }}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                {recipe.total_time_minutes && (
                  <span className="flex items-center gap-1">
                    <Clock className="size-3.5" />
                    {formatTime(recipe.total_time_minutes)}
                  </span>
                )}
                {recipe.servings && (
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5" />
                    {t("servingsCount", { count: recipe.servings })}
                  </span>
                )}
                {recipe.difficulty && (
                  <Badge className={`${difficulty.bg} ${difficulty.text} border-0 text-xs`}>
                    {difficultyLabels[recipe.difficulty] || recipe.difficulty}
                  </Badge>
                )}
                {recipe.source_domain && (
                  <Badge variant="outline" className="text-xs">
                    {recipe.source_domain}
                  </Badge>
                )}
              </div>

              {recipe.description && (
                <p className="text-sm text-muted-foreground mt-2 line-clamp-1">
                  {recipe.description}
                </p>
              )}

              <p className="text-xs text-muted-foreground mt-2">
                {t("ingredientsCount", { count: recipe.ingredients?.length || 0 })}
              </p>
            </div>
          </div>
        </Card>
      </Link>
    </motion.div>
  );
}

// Library filter chip (All / Favorites / tag). Mirrors the PersonChip toggle pattern.
function RecipeFilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-[36px] items-center rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors [transition-duration:120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
        active
          ? "bg-primary/12 text-primary"
          : "bg-muted text-muted-foreground hover:bg-muted/80"
      }`}
    >
      {label}
    </button>
  );
}
