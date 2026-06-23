"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  ShoppingCart,
  Plus,
  Check,
  Package,
  X,
  Loader2,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/error-state";
import type { ShoppingItem } from "@/types/database";
import type { CatalogSearchResult } from "@/hooks/use-item-catalog";
import {
  useCatalogSearch,
  parseShoppingInput,
  useOfflineShopping,
} from "@/hooks";
import Link from "next/link";
import { OfflineBanner, OfflineIndicator } from "@/components/offline-banner";
import { CATEGORIES, detectCategory } from "@/lib/shopping-categories";

export default function EinkaufenPage() {
  const t = useTranslations("einkaufen");
  const tCategories = useTranslations("shoppingCategories");

  // Fetch items with offline support
  const {
    items = [],
    isLoading,
    error,
    refetch,
    isOnline,
    isSyncing,
    hasPendingSync,
    createItem,
    updateItem,
    deleteItem,
    syncNow,
  } = useOfflineShopping();

  // Input state
  const [inputValue, setInputValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  // Pull-to-refresh state
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const PULL_THRESHOLD = 80;

  // Use catalog search hook
  const { data: catalogResults = [], isLoading: catalogLoading } = useCatalogSearch(inputValue, {
    enabled: inputValue.length >= 2,
  });

  // Show suggestions when we have results
  useEffect(() => {
    if (catalogResults.length > 0 && inputValue.length >= 2) {
      setShowSuggestions(true);
    }
  }, [catalogResults, inputValue]);

  // Haptic feedback on check (if supported)
  const triggerHaptic = useCallback(() => {
    if ("vibrate" in navigator) {
      navigator.vibrate(10);
    }
  }, []);

  // Keep screen awake while shopping (if supported)
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;

    const requestWakeLock = async () => {
      if ("wakeLock" in navigator) {
        try {
          wakeLock = await navigator.wakeLock.request("screen");
        } catch (err) {
          console.log("Wake lock not available:", err);
        }
      }
    };

    requestWakeLock();

    return () => {
      if (wakeLock) {
        wakeLock.release();
      }
    };
  }, []);

  // Pull-to-refresh handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isRefreshing) return;
    const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
    if (scrollTop <= 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  }, [isRefreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (isRefreshing) return;
    const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
    if (scrollTop > 0) {
      setPullDistance(0);
      return;
    }

    const currentY = e.touches[0].clientY;
    const diff = currentY - touchStartY.current;

    if (diff > 0) {
      // Apply resistance for more natural feel
      const resistance = 0.4;
      setPullDistance(Math.min(diff * resistance, PULL_THRESHOLD * 1.5));
    }
  }, [isRefreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (isRefreshing) return;

    if (pullDistance >= PULL_THRESHOLD) {
      setIsRefreshing(true);
      setPullDistance(PULL_THRESHOLD);

      try {
        await refetch();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, isRefreshing, refetch]);

  // Clear form
  const resetForm = () => {
    setInputValue("");
    setShowSuggestions(false);
  };

  // Select a suggestion from catalog - directly adds the item
  const handleSelectSuggestion = async (suggestion: CatalogSearchResult) => {
    setShowSuggestions(false);

    const itemName = suggestion.name.trim();
    if (!itemName) return;

    const category = suggestion.category || detectCategory(itemName);

    try {
      await createItem.mutateAsync({
        name: itemName,
        category: category,
        quantity: null,
        unit: null,
        notes: null,
        image_url: suggestion.thumbnail_url || suggestion.image_url || null,
        catalog_item_id: suggestion.id,
      });

      resetForm();
      triggerHaptic();
    } catch {
      toast.error(t("toastAddFailed"));
    }
  };

  const handleAddItem = async () => {
    const parsed = parseShoppingInput(inputValue);
    const itemName = parsed.name || inputValue.trim();
    if (!itemName) return;

    try {
      const category = detectCategory(itemName);

      // Try to find a matching image from catalog (fuzzy match)
      let imageUrl: string | null = null;
      let catalogId: string | null = null;

      if (catalogResults.length > 0) {
        const normalizedName = itemName.toLowerCase().trim();
        const matchingResult = catalogResults.find((result) => {
          if (!result.thumbnail_url && !result.image_url) return false;
          const resultName = result.name.toLowerCase().trim();
          return resultName === normalizedName ||
            normalizedName.includes(resultName) ||
            resultName.includes(normalizedName);
        });

        if (matchingResult) {
          imageUrl = matchingResult.thumbnail_url || matchingResult.image_url || null;
          catalogId = matchingResult.id;
        }
      }

      await createItem.mutateAsync({
        name: itemName,
        category: category,
        quantity: parsed.quantity,
        unit: parsed.unit || null,
        notes: parsed.notes || null,
        image_url: imageUrl,
        catalog_item_id: catalogId,
      });

      resetForm();
      triggerHaptic();
    } catch {
      toast.error(t("toastAddFailed"));
    }
  };

  const handleToggleItem = async (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;

    try {
      await updateItem.mutateAsync({
        id,
        checked: !item.checked,
      });
      triggerHaptic();
    } catch {
      toast.error(t("toastToggleFailed"));
    }
  };

  const handleDeleteItem = async (id: string) => {
    try {
      await deleteItem.mutateAsync(id);
      triggerHaptic();
    } catch {
      toast.error(t("toastDeleteFailed"));
    }
  };

  const [isClearingChecked, setIsClearingChecked] = useState(false);

  const handleClearChecked = async () => {
    const checked = items.filter((item) => item.checked);
    if (checked.length === 0) return;

    setIsClearingChecked(true);
    try {
      await Promise.all(checked.map((item) => deleteItem.mutateAsync(item.id)));
      triggerHaptic();
      toast.success(t("toastClearedAll", { count: checked.length }));
    } catch {
      toast.error(t("toastClearPartial"));
    } finally {
      setIsClearingChecked(false);
    }
  };

  const toggleCategoryCollapse = (categoryKey: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryKey)) {
        next.delete(categoryKey);
      } else {
        next.add(categoryKey);
      }
      return next;
    });
  };

  // Group items by category (only unchecked by default)
  const uncheckedItems = items.filter((item) => !item.checked);
  const checkedItems = items.filter((item) => item.checked);

  const groupedItems = uncheckedItems.reduce((acc, item) => {
    const cat = item.category || "sonstiges";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, ShoppingItem[]>);

  const sortedCategories = Object.entries(groupedItems);

  const totalItems = items.length;
  const checkedCount = checkedItems.length;
  const progress = totalItems > 0 ? (checkedCount / totalItems) * 100 : 0;

  // Loading state — skeleton matching the real page layout
  if (isLoading) {
    return (
      <main id="main-content" className="min-h-screen bg-background text-foreground safe-area-inset">
        {/* Header skeleton */}
        <header className="fixed top-0 left-0 right-0 z-50 bg-card border-b border-border safe-area-top">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="size-9 rounded-xl" />
              <div>
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-3 w-20 mt-1" />
              </div>
            </div>
            <Skeleton className="size-9 rounded" />
          </div>
          <div className="h-1 bg-secondary" />
        </header>

        {/* Category skeletons */}
        <div className="pt-[88px] pb-[100px] px-4">
          <div className="flex flex-col gap-4">
            {[1, 2, 3].map((cat) => (
              <div key={cat} className="bg-card/50 rounded-2xl overflow-hidden border border-border/50">
                <div className="flex items-center gap-3 p-4">
                  <Skeleton className="size-9 rounded-xl" />
                  <Skeleton className="h-4 w-24 flex-1" />
                  <Skeleton className="h-5 w-8 rounded-full" />
                </div>
                <div className="px-4 pb-4 flex flex-col gap-2">
                  {[1, 2].map((item) => (
                    <div key={item} className="flex items-center gap-3 py-3">
                      <Skeleton className="size-12 rounded-full" />
                      <Skeleton className="size-12 rounded-xl" />
                      <div className="flex-1">
                        <Skeleton className="h-5 w-32" />
                        <Skeleton className="h-3 w-20 mt-1" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Input skeleton */}
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border p-4 safe-area-bottom">
          <Skeleton className="h-14 w-full rounded-md" />
        </div>
      </main>
    );
  }

  // Error state
  if (error) {
    return (
      <main id="main-content" className="min-h-screen bg-background text-foreground safe-area-inset flex items-center justify-center">
        <ErrorState
          icon={ShoppingCart}
          title={t("errorTitle")}
          message={t("errorMessage")}
          onRetry={() => refetch()}
        />
      </main>
    );
  }

  return (
    <main id="main-content" className="min-h-screen bg-background text-foreground safe-area-inset">
      {/* Header - Fixed */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-card border-b border-border safe-area-top">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <ShoppingCart className="size-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-medium">{t("title")}</h1>
                <OfflineIndicator />
              </div>
              <p className="text-sm text-muted-foreground">
                {t("subtitleProgress", { unchecked: uncheckedItems.length, total: totalItems })}
                {progress === 100 && totalItems > 0 && (
                  <span className="text-success ml-1">{t("allDoneSuffix")}</span>
                )}
              </p>
            </div>
          </div>
          <Link href="/" className="p-2 text-muted-foreground hover:text-foreground transition-colors" aria-label={t("backHomeAria")}>
            <ChevronLeft className="size-5" />
          </Link>
        </div>

        {/* Offline banner */}
        <OfflineBanner
          onSyncClick={syncNow}
          isSyncing={isSyncing}
        />

        {/* Progress bar */}
        <div className="h-1 bg-secondary relative">
          <motion.div
            className={`h-full ${progress === 100 ? "bg-success shadow-[0_0_8px_hsl(var(--success)/0.6)]" : "bg-primary"}`}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>
      </header>

      {/* Pull-to-refresh indicator */}
      <div
        className="fixed top-[88px] left-0 right-0 z-40 flex justify-center pointer-events-none"
        style={{
          transform: `translateY(${Math.min(pullDistance, PULL_THRESHOLD) - 40}px)`,
          opacity: pullDistance > 10 ? 1 : 0,
          transition: pullDistance === 0 ? 'all 0.2s ease-out' : 'none'
        }}
      >
        <div className={`p-3 rounded-full bg-card border border-border shadow-lg ${isRefreshing ? 'animate-spin' : ''}`}>
          <RefreshCw
            className="size-5 text-primary"
            style={{
              transform: `rotate(${(pullDistance / PULL_THRESHOLD) * 180}deg)`,
              transition: isRefreshing ? 'none' : 'transform 0.1s ease-out'
            }}
          />
        </div>
      </div>

      {/* Main content with padding for header and input */}
      <div
        ref={scrollContainerRef}
        className="pt-[88px] pb-[100px] px-4 min-h-screen"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: `translateY(${pullDistance}px)`,
          transition: pullDistance === 0 ? 'transform 0.2s ease-out' : 'none'
        }}
      >
        {/* Shopping List */}
        <AnimatePresence mode="popLayout">
          {sortedCategories.length === 0 && checkedCount === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-20 text-muted-foreground"
            >
              <ShoppingCart className="size-16 mb-4 opacity-30" />
              <p className="text-lg">{t("emptyTitle")}</p>
              <p className="text-sm mt-1">{t("emptyDescription")}</p>
            </motion.div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Unchecked items by category */}
              {sortedCategories.map(([categoryKey, categoryItems]) => {
                const category = CATEGORIES[categoryKey];
                if (!category) return null;
                const Icon = category.icon;
                const isCollapsed = collapsedCategories.has(categoryKey);

                return (
                  <motion.div
                    key={categoryKey}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-card/50 rounded-2xl overflow-hidden border border-border/50"
                  >
                    {/* Category Header - Collapsible */}
                    <button
                      onClick={() => toggleCategoryCollapse(categoryKey)}
                      className="w-full flex items-center gap-3 p-4 active:bg-accent/50"
                    >
                      <div
                        className="p-2 rounded-xl"
                        style={{ backgroundColor: `${category.color}20` }}
                      >
                        <Icon
                          className="size-5"
                          style={{ color: category.color }}
                        />
                      </div>
                      <span className="font-medium flex-1 text-left">
                        {tCategories(category.labelKey)}
                      </span>
                      <Badge variant="outline" className="mr-2">
                        {categoryItems.length}
                      </Badge>
                      {isCollapsed ? (
                        <ChevronDown className="size-5 text-muted-foreground" />
                      ) : (
                        <ChevronUp className="size-5 text-muted-foreground" />
                      )}
                    </button>

                    {/* Items */}
                    <AnimatePresence>
                      {!isCollapsed && (
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: "auto" }}
                          exit={{ height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-4 pb-4 flex flex-col gap-2">
                            {categoryItems.map((item) => (
                              <motion.div
                                key={item.id}
                                layout
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20, scale: 0.9 }}
                                className="flex items-center gap-3 py-3 border-b border-border/30 last:border-0"
                              >
                                {/* Large check button - 48px touch target */}
                                <button
                                  onClick={() => handleToggleItem(item.id)}
                                  aria-label={t("checkAria", { name: item.name })}
                                  className="shrink-0 size-12 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center active:bg-primary/15 active:border-primary transition-colors"
                                >
                                  <div className="size-6 rounded-full border-2 border-current" />
                                </button>

                                {/* Item image */}
                                {item.image_url ? (
                                  <div className="relative size-12 rounded-xl overflow-hidden shrink-0 bg-muted/30">
                                    <img
                                      src={item.image_url}
                                      alt={item.name}
                                      className="absolute inset-0 size-full object-cover"
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = 'none';
                                      }}
                                    />
                                  </div>
                                ) : (
                                  <div
                                    className="size-12 rounded-xl flex items-center justify-center shrink-0"
                                    style={{ backgroundColor: `${category.color}20` }}
                                  >
                                    <Icon
                                      className="size-6"
                                      style={{ color: category.color }}
                                    />
                                  </div>
                                )}

                                {/* Item info */}
                                <div
                                  className="flex-1 min-w-0 cursor-pointer"
                                  onClick={() => handleToggleItem(item.id)}
                                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleToggleItem(item.id); } }}
                                  role="button"
                                  tabIndex={0}
                                  aria-label={t("markDoneAria", { name: item.name })}
                                >
                                  <p className="font-medium text-lg truncate">
                                    {item.name}
                                  </p>
                                  {(item.quantity || item.notes) && (
                                    <p className="text-sm text-muted-foreground truncate">
                                      {item.quantity && (
                                        <span>
                                          {item.quantity}
                                          {item.unit && ` ${item.unit}`}
                                        </span>
                                      )}
                                      {item.quantity && item.notes && " • "}
                                      {item.notes}
                                    </p>
                                  )}
                                </div>

                                {/* Delete button */}
                                <button
                                  onClick={() => handleDeleteItem(item.id)}
                                  aria-label={t("removeAria", { name: item.name })}
                                  className="shrink-0 size-10 rounded-full flex items-center justify-center text-muted-foreground active:bg-destructive/20 active:text-destructive"
                                >
                                  <X className="size-5" />
                                </button>
                              </motion.div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}

              {/* Checked items section */}
              {checkedCount > 0 && (
                <motion.div
                  layout
                  className="bg-card/30 rounded-2xl overflow-hidden opacity-60 border border-border/30"
                >
                  <div className="flex items-center">
                    <button
                      onClick={() => toggleCategoryCollapse("__checked__")}
                      className="flex-1 flex items-center gap-3 p-4 active:bg-accent/50"
                    >
                      <div className="p-2 rounded-xl bg-primary/10">
                        <Check className="size-5 text-primary" />
                      </div>
                      <span className="font-medium flex-1 text-left">
                        {t("doneSection")}
                      </span>
                      <Badge variant="neutral" className="mr-2 bg-primary/10">
                        {checkedCount}
                      </Badge>
                      {collapsedCategories.has("__checked__") ? (
                        <ChevronDown className="size-5 text-muted-foreground" />
                      ) : (
                        <ChevronUp className="size-5 text-muted-foreground" />
                      )}
                    </button>
                    <button
                      onClick={handleClearChecked}
                      disabled={isClearingChecked}
                      className="shrink-0 p-3 mr-2 rounded-xl text-muted-foreground hover:text-destructive active:bg-destructive/10 transition-colors"
                      aria-label={t("deleteAllDoneAria")}
                    >
                      {isClearingChecked ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </button>
                  </div>

                  <AnimatePresence>
                    {!collapsedCategories.has("__checked__") && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: "auto" }}
                        exit={{ height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-4 flex flex-col gap-2">
                          {checkedItems.map((item) => (
                            <motion.div
                              key={item.id}
                              layout
                              className="flex items-center gap-3 py-3 border-b border-border/30 last:border-0"
                            >
                              {/* Checked button */}
                              <button
                                onClick={() => handleToggleItem(item.id)}
                                aria-label={t("uncheckAria", { name: item.name })}
                                className="shrink-0 size-12 rounded-full bg-primary flex items-center justify-center"
                              >
                                <Check className="size-6 text-primary-foreground" />
                              </button>

                              {/* Item info */}
                              <div
                                className="flex-1 min-w-0 cursor-pointer"
                                onClick={() => handleToggleItem(item.id)}
                                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleToggleItem(item.id); }}
                                role="button"
                                tabIndex={0}
                                aria-label={t("markUndoneAria", { name: item.name })}
                              >
                                <p className="font-medium text-lg truncate line-through text-muted-foreground">
                                  {item.name}
                                </p>
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Fixed bottom input */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border p-4 safe-area-bottom">
        <div className="relative">
          <Input
            ref={inputRef}
            placeholder={t("inputPlaceholder")}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setShowSuggestions(false);
                handleAddItem();
              }
              if (e.key === "Escape") {
                setShowSuggestions(false);
              }
            }}
            onFocus={() => catalogResults.length > 0 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            autoComplete="off"
            className="h-14 text-lg bg-card border-border pr-14"
          />
          <Button
            size="icon"
            onClick={handleAddItem}
            disabled={!inputValue.trim() || createItem.isPending}
            className="absolute right-2 top-1/2 -translate-y-1/2 size-10"
          >
            {createItem.isPending ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Plus className="size-5" />
            )}
          </Button>

          {/* Suggestions dropdown */}
          <AnimatePresence>
            {showSuggestions && catalogResults.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute bottom-full left-0 right-0 mb-2 bg-popover border border-border rounded-xl overflow-hidden max-h-64 overflow-y-auto shadow-lg"
              >
                {catalogResults.slice(0, 6).map((result, index) => {
                  const cat = CATEGORIES[result.category || "sonstiges"];
                  const Icon = cat?.icon || Package;
                  // Quick Add is only for new items (source=custom AND no id)
                  const isQuickAdd = result.source === "custom" && !result.id;

                  return (
                    <button
                      key={result.id || `${result.source}-${index}`}
                      type="button"
                      className="w-full flex items-center gap-3 px-4 py-3 active:bg-accent text-left border-b border-border/50 last:border-0"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectSuggestion(result);
                      }}
                    >
                      {isQuickAdd ? (
                        <div className="size-10 rounded-xl flex items-center justify-center shrink-0 bg-primary/10">
                          <Plus className="size-5 text-primary" />
                        </div>
                      ) : result.thumbnail_url ? (
                        <div className="relative size-10 rounded-xl overflow-hidden shrink-0 bg-muted/30">
                          <img
                            src={result.thumbnail_url}
                            alt={result.name}
                            className="absolute inset-0 size-full object-cover"
                          />
                        </div>
                      ) : (
                        <div
                          className="size-10 rounded-xl flex items-center justify-center shrink-0"
                          style={{ backgroundColor: `${cat?.color || "#6b7280"}20` }}
                        >
                          <Icon
                            className="size-5"
                            style={{ color: cat?.color || "#6b7280" }}
                          />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium truncate ${isQuickAdd ? "text-primary" : ""}`}>
                          {isQuickAdd ? t("quickAdd", { name: result.name }) : result.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {isQuickAdd ? t("quickAddDescription") : (cat ? tCategories(cat.labelKey) : t("categoryFallback"))}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}
