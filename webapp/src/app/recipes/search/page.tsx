"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  Search,
  ChefHat,
  Clock,
  Star,
  Users,
  ExternalLink,
  Loader2,
  Import,
  Check,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
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
  useExternalRecipeSearch,
  useImportRecipe,
  useDebounce,
  useKeyboardShortcuts,
  useSwipeNavigation,
  type ExternalRecipeResult,
} from "@/hooks";
import { formatRecipeTime } from "@/lib/recipe-time";

// Difficulty colors
const DIFFICULTY_COLORS: Record<string, { bg: string; text: string }> = {
  einfach: { bg: "bg-success/10", text: "text-success" },
  mittel: { bg: "bg-warning/10", text: "text-warning" },
  schwer: { bg: "bg-destructive/10", text: "text-destructive" },
};

export default function RecipeSearchPage() {
  useKeyboardShortcuts();
  useSwipeNavigation();

  const t = useTranslations("recipes");
  const difficultyLabels: Record<string, string> = {
    einfach: t("difficulty.einfach"),
    mittel: t("difficulty.mittel"),
    schwer: t("difficulty.schwer"),
  };

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRecipe, setSelectedRecipe] = useState<ExternalRecipeResult | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [importedRecipes, setImportedRecipes] = useState<Set<string>>(new Set());

  // Debounced search
  const debouncedQuery = useDebounce(searchQuery, 500);

  // Data fetching
  const { data: searchResults = [], isLoading } = useExternalRecipeSearch(debouncedQuery);
  const importRecipe = useImportRecipe();

  // Handle import
  const handleImport = async (recipe: ExternalRecipeResult) => {
    try {
      await importRecipe.mutateAsync(recipe.sourceUrl);
      setImportedRecipes((prev) => {
        const newSet = new Set(prev);
        newSet.add(recipe.id);
        return newSet;
      });
      setShowPreview(false);
      setSelectedRecipe(null);
    } catch {
      toast.error(t("importFailed"));
    }
  };

  // Format time
  const formatTime = (m: number | null) => formatRecipeTime(t, m);

  // Format rating
  const formatRating = (rating: number) => {
    return rating.toFixed(1);
  };

  return (
    <TooltipProvider>
      <main id="main-content" className="min-h-screen relative overflow-hidden">
        {/* Background */}
        <div className="page-gradient" />

        <div className="relative z-10 p-4 md:p-8 max-w-7xl mx-auto safe-area-inset">
          <PageHeader
            icon={Search}
            title={t("search.title")}
            subtitle={t("search.subtitle")}
            backHref="/recipes"
            className="mb-6"
          />

          {/* Search Input */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-6"
          >
            <Card className="p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" />
                <Input
                  placeholder={t("search.placeholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-11 h-12 text-lg"
                  autoFocus
                />
                {isLoading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
            </Card>
          </motion.div>

          {/* Search Results */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <ScrollArea className="h-[calc(100vh-280px)]">
              <AnimatePresence mode="popLayout">
                {!searchQuery ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center py-16 text-muted-foreground"
                  >
                    <ChefHat className="size-16 mb-4 opacity-30" />
                    <p className="text-lg">{t("search.emptyHeroTitle")}</p>
                    <p className="text-sm mt-1">
                      {t("search.emptyHeroDescription")}
                    </p>
                  </motion.div>
                ) : isLoading ? (
                  // Loading skeleton
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                      <Card key={i} className="overflow-hidden">
                        <Skeleton className="h-48 w-full" />
                        <div className="p-4">
                          <Skeleton className="h-6 w-3/4 mb-2" />
                          <Skeleton className="h-4 w-1/2" />
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : searchResults.length === 0 && debouncedQuery.length >= 2 ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center py-16 text-muted-foreground"
                  >
                    <Search className="size-12 mb-4 opacity-30" />
                    <p>{t("search.emptyResultsTitle")}</p>
                    <p className="text-sm mt-1">
                      {t("search.emptyResultsDescription")}
                    </p>
                  </motion.div>
                ) : (
                  // Results grid
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {searchResults.map((recipe) => {
                      const isImported = importedRecipes.has(recipe.id);
                      const difficulty = DIFFICULTY_COLORS[recipe.difficulty] || DIFFICULTY_COLORS.mittel;

                      return (
                        <motion.div
                          key={recipe.id}
                          layout
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                        >
                          <Card
                            className={`overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all ${
                              isImported ? "ring-2 ring-success/50" : ""
                            }`}
                            onClick={() => {
                              setSelectedRecipe(recipe);
                              setShowPreview(true);
                            }}
                          >
                            {/* Image */}
                            <div className="relative h-48 bg-muted">
                              {recipe.imageUrl ? (
                                <img
                                  src={recipe.imageUrl}
                                  alt={recipe.title}
                                  className="size-full object-cover"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                  }}
                                />
                              ) : (
                                <div className="size-full flex items-center justify-center">
                                  <ChefHat className="size-12 text-muted-foreground/30" />
                                </div>
                              )}

                              {/* Imported badge */}
                              {isImported && (
                                <div className="absolute top-2 right-2">
                                  <Badge className="bg-success text-white">
                                    <Check className="size-3 mr-1" />
                                    {t("search.importedBadge")}
                                  </Badge>
                                </div>
                              )}

                              {/* Source badge */}
                              <div className="absolute bottom-2 left-2">
                                <Badge variant="secondary" className="border-0 bg-black/55 text-xs text-white/90">
                                  <ExternalLink className="size-3 mr-1" />
                                  {recipe.sourceDomain}
                                </Badge>
                              </div>
                            </div>

                            {/* Content */}
                            <div className="p-4">
                              <h3 className="font-semibold line-clamp-2 group-hover:text-primary transition-colors">
                                {recipe.title}
                              </h3>

                              {recipe.subtitle && (
                                <p className="text-sm text-muted-foreground line-clamp-1 mt-1">
                                  {recipe.subtitle}
                                </p>
                              )}

                              <div className="flex items-center gap-3 mt-3 text-sm text-muted-foreground">
                                {recipe.rating > 0 && (
                                  <span className="flex items-center gap-1">
                                    <Star className="size-3.5 fill-warning text-warning" />
                                    {formatRating(recipe.rating)}
                                    {recipe.ratingCount > 0 && (
                                      <span className="text-xs">({recipe.ratingCount})</span>
                                    )}
                                  </span>
                                )}
                                {recipe.prepTime && (
                                  <span className="flex items-center gap-1">
                                    <Clock className="size-3.5" />
                                    {formatTime(recipe.prepTime)}
                                  </span>
                                )}
                                <Badge className={`${difficulty.bg} ${difficulty.text} border-0 text-xs`}>
                                  {difficultyLabels[recipe.difficulty] || recipe.difficulty}
                                </Badge>
                              </div>
                            </div>
                          </Card>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </AnimatePresence>
            </ScrollArea>
          </motion.div>
        </div>

        {/* Recipe Preview Dialog */}
        <Dialog open={showPreview} onOpenChange={setShowPreview}>
          <DialogContent className="max-w-2xl">
            {selectedRecipe && (
              <>
                <DialogHeader>
                  <DialogTitle className="pr-8">{selectedRecipe.title}</DialogTitle>
                  {selectedRecipe.subtitle && (
                    <DialogDescription>{selectedRecipe.subtitle}</DialogDescription>
                  )}
                </DialogHeader>

                <div className="py-4">
                  {/* Image */}
                  {selectedRecipe.imageUrl && (
                    <div className="rounded-xl overflow-hidden mb-4">
                      <img
                        src={selectedRecipe.imageUrl}
                        alt={selectedRecipe.title}
                        className="w-full h-64 object-cover"
                      />
                    </div>
                  )}

                  {/* Meta info */}
                  <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                    {selectedRecipe.rating > 0 && (
                      <span className="flex items-center gap-1">
                        <Star className="size-4 fill-warning text-warning" />
                        {formatRating(selectedRecipe.rating)}
                        {selectedRecipe.ratingCount > 0 && (
                          <span>{t("search.ratingsCount", { count: selectedRecipe.ratingCount })}</span>
                        )}
                      </span>
                    )}
                    {selectedRecipe.prepTime && (
                      <span className="flex items-center gap-1">
                        <Clock className="size-4" />
                        {formatTime(selectedRecipe.prepTime)}
                      </span>
                    )}
                    <Badge
                      className={`${DIFFICULTY_COLORS[selectedRecipe.difficulty]?.bg || ""} ${
                        DIFFICULTY_COLORS[selectedRecipe.difficulty]?.text || ""
                      } border-0`}
                    >
                      {difficultyLabels[selectedRecipe.difficulty] || selectedRecipe.difficulty}
                    </Badge>
                  </div>

                  <div className="mt-4 p-4 bg-muted/50 rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      {t("search.previewNote", { domain: selectedRecipe.sourceDomain })}
                    </p>
                  </div>
                </div>

                <DialogFooter className="flex-col sm:flex-row gap-2">
                  <a
                    href={selectedRecipe.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 sm:flex-initial"
                  >
                    <Button variant="outline" className="w-full">
                      <ExternalLink className="size-4 mr-2" />
                      {t("search.viewSource", { domain: selectedRecipe.sourceDomain })}
                    </Button>
                  </a>
                  <Button
                    onClick={() => handleImport(selectedRecipe)}
                    disabled={importRecipe.isPending || importedRecipes.has(selectedRecipe.id)}
                    className="flex-1 sm:flex-initial"
                  >
                    {importRecipe.isPending ? (
                      <>
                        <Loader2 className="size-4 mr-2 animate-spin" />
                        {t("importingLabel")}
                      </>
                    ) : importedRecipes.has(selectedRecipe.id) ? (
                      <>
                        <Check className="size-4 mr-2" />
                        {t("search.alreadyImported")}
                      </>
                    ) : (
                      <>
                        <Import className="size-4 mr-2" />
                        {t("search.saveToCollection")}
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </main>
    </TooltipProvider>
  );
}
