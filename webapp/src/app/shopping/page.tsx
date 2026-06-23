"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations, useLocale } from "next-intl";
import {
  ShoppingCart,
  Plus,
  Trash2,
  Check,
  Package,
  X,
  Loader2,
  ChefHat,
  Image as ImageIcon,
  Minus,
  Search,
  Tag,
  MoreVertical,
  Pencil,
  Link2,
  Mic,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  TooltipProvider,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ShoppingItem } from "@/types/database";
import type { CatalogSearchResult } from "@/hooks/use-item-catalog";
import type { OfflineShoppingItem } from "@/hooks/use-offline-shopping";
import {
  useBringSettings,
  useBringAddItem,
  useBringRemoveItem,
  useKeyboardShortcuts,
  useSwipeNavigation,
  useCatalogSearch,
  useSaveToCatalog,
  parseShoppingInput,
  useOfflineShopping,
  usePeople,
} from "@/hooks";
import { ShoppingInstallPrompt } from "@/components/shopping-install-prompt";
import { PageHeader } from "@/components/page-header";
import { OfflineBanner, OfflineIndicator } from "@/components/offline-banner";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/empty-state";
import { CATEGORIES, detectCategory } from "@/lib/shopping-categories";
import { ChecklistItem } from "@/components/checklist-item";
import { PersonAvatar } from "@/components/person-avatar";


// Minimal Web Speech API surface — feature-detected, no external types.
interface MinimalSpeechRecognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => MinimalSpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Common units for shopping items
const UNITS = [
  { value: "none", label: "-" },
  { value: "Stück", label: "Stück" },
  { value: "kg", label: "kg" },
  { value: "g", label: "g" },
  { value: "L", label: "L" },
  { value: "ml", label: "ml" },
  { value: "Packung", label: "Packung" },
  { value: "Dose", label: "Dose" },
  { value: "Flasche", label: "Flasche" },
  { value: "Glas", label: "Glas" },
  { value: "Bund", label: "Bund" },
  { value: "Scheiben", label: "Scheiben" },
  { value: "EL", label: "EL" },
  { value: "TL", label: "TL" },
];

export default function ShoppingPage() {
  // Enable keyboard shortcuts and swipe navigation
  useKeyboardShortcuts();
  useSwipeNavigation();

  const t = useTranslations("shopping");
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
  const saveToCatalog = useSaveToCatalog();
  const { data: people = [] } = usePeople();
  const personById = (id: string | null | undefined) =>
    id ? people.find((p) => p.id === id) ?? null : null;

  const locale = useLocale();
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef<MinimalSpeechRecognition | null>(null);

  useEffect(() => {
    setSpeechSupported(getSpeechRecognitionCtor() !== null);
  }, []);

  const handleVoiceInput = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new Ctor();
    recognition.lang = locale === "de" ? "de-DE" : locale === "fr" ? "fr-FR" : "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) {
        handleInputChange(transcript);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  // Bring! integration
  const { data: bringSettings } = useBringSettings();
  const bringAddItem = useBringAddItem();
  const bringRemoveItem = useBringRemoveItem();

  const isBringConnected = !!bringSettings?.credentials && !!bringSettings?.selectedListId;
  const isTwoWaySync = bringSettings?.twoWaySync ?? true;

  // Input state
  const [inputValue, setInputValue] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("sonstiges");
  const [selectedQuantity, setSelectedQuantity] = useState<number | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<string>("none");
  const [selectedNotes, setSelectedNotes] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(null);

  // UI state
  const [showChecked, setShowChecked] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Image search dialog state
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [imageSearchQuery, setImageSearchQuery] = useState("");
  const [imageSearchResults, setImageSearchResults] = useState<{ url: string; thumbnail: string; title: string }[]>([]);
  const [imageSearchLoading, setImageSearchLoading] = useState(false);
  const [editingItemForImage, setEditingItemForImage] = useState<ShoppingItem | null>(null);

  // Item edit popover state
  const [editPopoverOpen, setEditPopoverOpen] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editCategory, setEditCategory] = useState("");

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

  const isSaving = createItem.isPending || updateItem.isPending || deleteItem.isPending;

  // Parse input and update fields
  const handleInputChange = (value: string) => {
    setInputValue(value);

    // Parse for quantity/unit/notes
    if (value.length >= 2) {
      const parsed = parseShoppingInput(value);
      if (parsed.quantity !== null) {
        setSelectedQuantity(parsed.quantity);
      }
      if (parsed.unit) {
        setSelectedUnit(parsed.unit);
      }
      if (parsed.notes) {
        setSelectedNotes(parsed.notes);
      }
    }
  };

  // Select a suggestion from catalog - directly adds the item
  const handleSelectSuggestion = async (suggestion: CatalogSearchResult) => {
    setShowSuggestions(false);

    // Get the item name from the suggestion
    const itemName = suggestion.name.trim();
    if (!itemName) return;

    // Determine category - use suggestion category or auto-detect
    const category = suggestion.category || detectCategory(itemName);

    try {
      // Add to Supabase with all suggestion details
      await createItem.mutateAsync({
        name: itemName,
        category: category,
        quantity: selectedQuantity,
        unit: selectedUnit === "none" ? null : selectedUnit,
        notes: selectedNotes || null,
        image_url: suggestion.thumbnail_url || suggestion.image_url || selectedImage,
        catalog_item_id: suggestion.id,
      });

      // Also add to Bring! if connected and two-way sync is enabled
      if (isBringConnected && isTwoWaySync && bringSettings?.selectedListId) {
        try {
          const bringSpec = selectedQuantity && selectedUnit !== "none"
            ? `${selectedQuantity} ${selectedUnit}`
            : undefined;
          await bringAddItem.mutateAsync({
            listId: bringSettings.selectedListId,
            itemName: itemName,
            specification: bringSpec,
          });
        } catch (bringErr) {
          console.error("Failed to add item to Bring!:", bringErr);
        }
      }

      resetForm();
    } catch {
      toast.error(t("toastAddFailed"));
    }
  };

  // Clear form and re-focus input for rapid additions
  const resetForm = () => {
    setInputValue("");
    setSelectedCategory("sonstiges");
    setSelectedQuantity(null);
    setSelectedUnit("none");
    setSelectedNotes("");
    setSelectedImage(null);
    setSelectedCatalogId(null);
    setShowSuggestions(false);
    // Re-focus input for rapid sequential additions
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleAddItem = async () => {
    const parsed = parseShoppingInput(inputValue);
    const itemName = parsed.name || inputValue.trim();
    if (!itemName) return;

    try {
      // Use parsed values or selected values
      const quantity = selectedQuantity ?? parsed.quantity;
      const unit = selectedUnit === "none" ? (parsed.unit || null) : (selectedUnit || parsed.unit);
      const notes = selectedNotes || parsed.notes;

      // Auto-detect category if still default
      const category = selectedCategory === "sonstiges"
        ? detectCategory(itemName)
        : selectedCategory;

      // Try to find a matching image from catalog if none selected
      let imageUrl = selectedImage;
      let catalogId = selectedCatalogId;

      if (!imageUrl && catalogResults.length > 0) {
        // Look for a catalog item that matches the parsed name (fuzzy match)
        const normalizedName = itemName.toLowerCase().trim();
        const matchingResult = catalogResults.find((result) => {
          if (!result.thumbnail_url && !result.image_url) return false;
          const resultName = result.name.toLowerCase().trim();
          // Exact match or parsed name contains the catalog item name
          return resultName === normalizedName ||
            normalizedName.includes(resultName) ||
            resultName.includes(normalizedName);
        });

        if (matchingResult) {
          imageUrl = matchingResult.thumbnail_url || matchingResult.image_url;
          catalogId = matchingResult.id;
        }
      }

      // Add to Supabase
      await createItem.mutateAsync({
        name: itemName,
        category: category,
        quantity: quantity,
        unit: unit,
        notes: notes,
        image_url: imageUrl,
        catalog_item_id: catalogId,
      });

      // Also add to Bring! if connected and two-way sync is enabled
      if (isBringConnected && isTwoWaySync && bringSettings?.selectedListId) {
        try {
          const bringSpec = quantity && unit ? `${quantity} ${unit}` : undefined;
          await bringAddItem.mutateAsync({
            listId: bringSettings.selectedListId,
            itemName: itemName,
            specification: bringSpec,
          });
        } catch (bringErr) {
          console.error("Failed to add item to Bring!:", bringErr);
        }
      }

      resetForm();
    } catch {
      toast.error(t("toastAddFailed"));
    }
  };

  const handleToggleItem = async (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;

    const newChecked = !item.checked;

    try {
      await updateItem.mutateAsync({
        id,
        checked: newChecked,
      });

      // Sync with Bring!
      if (isBringConnected && isTwoWaySync && bringSettings?.selectedListId) {
        try {
          if (newChecked) {
            await bringRemoveItem.mutateAsync({
              listId: bringSettings.selectedListId,
              itemName: item.name,
            });
          } else {
            await bringAddItem.mutateAsync({
              listId: bringSettings.selectedListId,
              itemName: item.name,
            });
          }
        } catch (bringErr) {
          console.error("Failed to sync item toggle to Bring!:", bringErr);
        }
      }
    } catch {
      toast.error(t("toastToggleFailed"));
    }
  };

  const handleUpdateItemQuantity = async (id: string, delta: number) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;

    const newQuantity = Math.max(0, (item.quantity || 1) + delta);
    if (newQuantity === 0) {
      await handleDeleteItem(id);
    } else {
      await updateItem.mutateAsync({ id, quantity: newQuantity });
    }
  };

  const handleDeleteItem = async (id: string) => {
    const item = items.find((i) => i.id === id);

    try {
      await deleteItem.mutateAsync(id);

      if (item && isBringConnected && isTwoWaySync && bringSettings?.selectedListId) {
        try {
          await bringRemoveItem.mutateAsync({
            listId: bringSettings.selectedListId,
            itemName: item.name,
          });
        } catch (bringErr) {
          console.error("Failed to remove item from Bring!:", bringErr);
        }
      }
    } catch {
      toast.error(t("toastDeleteFailed"));
    }
  };

  const handleClearChecked = async () => {
    const checked = items.filter((item) => item.checked);
    if (checked.length === 0) return;

    let deleted = 0;
    for (const item of checked) {
      try {
        await deleteItem.mutateAsync(item.id);
        deleted++;

        if (isBringConnected && isTwoWaySync && bringSettings?.selectedListId) {
          try {
            await bringRemoveItem.mutateAsync({
              listId: bringSettings.selectedListId,
              itemName: item.name,
            });
          } catch (bringErr) {
            console.error("Failed to remove item from Bring!:", bringErr);
          }
        }
      } catch {
        // Continue with remaining items even if one fails
      }
    }

    if (deleted < checked.length) {
      toast.error(t("toastClearedPartial", { deleted, total: checked.length }));
    } else {
      toast.success(t("toastClearedAll", { count: deleted }));
    }
  };

  // Open edit popover for an item
  const handleOpenEditPopover = (item: ShoppingItem) => {
    setEditPopoverOpen(item.id);
    setEditNotes(item.notes || "");
    setEditCategory(item.category || "sonstiges");
  };

  // Save item edits (category and notes)
  const handleSaveItemEdits = async (itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;

    try {
      await updateItem.mutateAsync({
        id: itemId,
        category: editCategory,
        notes: editNotes || null,
      });

      // Also update catalog if item has a catalog_item_id
      if (item.catalog_item_id && editCategory !== item.category) {
        // Update catalog item category
        try {
          await saveToCatalog.mutateAsync({
            name: item.name,
            category: editCategory,
            source: "custom",
          });
        } catch {
          // Best effort - catalog update can fail
        }
      }

      setEditPopoverOpen(null);
    } catch {
      toast.error(t("toastUpdateFailed"));
    }
  };

  // Open image search dialog for an item
  const handleOpenImageDialog = (item: ShoppingItem) => {
    setEditingItemForImage(item);
    setImageSearchQuery(item.name);
    setImageSearchResults([]);
    setImageDialogOpen(true);
    // Trigger initial search
    handleImageSearch(item.name);
  };

  // Search for images
  const handleImageSearch = async (query: string) => {
    if (!query || query.length < 2) return;

    setImageSearchLoading(true);
    try {
      const response = await fetch(`/api/images/search?q=${encodeURIComponent(query)}&limit=12`);
      if (response.ok) {
        const data = await response.json();
        setImageSearchResults(data.results || []);
      }
    } catch (err) {
      console.error("Failed to search images:", err);
    } finally {
      setImageSearchLoading(false);
    }
  };

  // Select an image for the item
  const handleSelectImage = async (imageUrl: string) => {
    if (!editingItemForImage) return;

    try {
      // Update the shopping item with the new image
      await updateItem.mutateAsync({
        id: editingItemForImage.id,
        image_url: imageUrl,
      });

      // Also save to catalog for future reuse
      // Extract base name by parsing and getting just the name
      const parsed = parseShoppingInput(editingItemForImage.name);
      const baseName = parsed.name || editingItemForImage.name;

      try {
        await saveToCatalog.mutateAsync({
          name: baseName,
          image_url: imageUrl,
          thumbnail_url: imageUrl,
          category: editingItemForImage.category,
          source: "custom",
        });
      } catch (catalogErr) {
        // Catalog save is best-effort, don't fail the whole operation
        console.log("Could not save to catalog (may already exist):", catalogErr);
      }

      setImageDialogOpen(false);
      setEditingItemForImage(null);
    } catch {
      toast.error(t("toastImageUpdateFailed"));
    }
  };

  // Group items by category
  const groupedItems = items.reduce((acc, item) => {
    if (!showChecked && item.checked) return acc;
    const cat = item.category || "sonstiges";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, OfflineShoppingItem[]>);

  // Sort categories: ones with unchecked items first
  const sortedCategories = Object.entries(groupedItems).sort(([, itemsA], [, itemsB]) => {
    const hasUncheckedA = itemsA.some((i) => !i.checked);
    const hasUncheckedB = itemsB.some((i) => !i.checked);
    if (hasUncheckedA !== hasUncheckedB) return hasUncheckedA ? -1 : 1;
    return 0;
  });

  const totalItems = items.length;
  const checkedItems = items.filter((i) => i.checked).length;
  const uncheckedItems = totalItems - checkedItems;

  // Format quantity for display
  const formatQuantity = (item: ShoppingItem) => {
    if (!item.quantity) return null;
    const qty = item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(1);
    return item.unit ? `${qty} ${item.unit}` : qty.toString();
  };

  // Loading state
  if (isLoading) {
    return (
      <TooltipProvider>
        <main id="main-content" className="min-h-screen relative overflow-hidden">
          <div className="page-gradient" />
          <div className="relative z-10 p-4 md:p-8 max-w-6xl mx-auto safe-area-inset">
            <PageHeader
              icon={ShoppingCart}
              title={t("title")}
              backHref="/"
              className="mb-8"
              subtitle={<Skeleton className="h-4 w-32" />}
            />
            <Card className="mb-6">
              <CardContent className="p-4">
                <div className="flex gap-3">
                  <Skeleton className="h-10 flex-1" />
                  <Skeleton className="h-10 w-24" />
                  <Skeleton className="size-10" />
                </div>
              </CardContent>
            </Card>
            <div className="flex flex-col gap-4">
              {[1, 2, 3].map((i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="h-5 w-32 mb-3" />
                    <div className="flex flex-col gap-2">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  </CardContent>
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
          <div className="relative z-10 p-4 md:p-8 max-w-6xl mx-auto safe-area-inset">
            <PageHeader
              icon={ShoppingCart}
              title={t("title")}
              backHref="/"
              className="mb-8"
            />
            <Card>
              <CardContent className="p-8 text-center">
                <ShoppingCart className="size-12 mx-auto mb-3 text-destructive opacity-50" />
                <p className="text-destructive font-medium">{t("errorTitle")}</p>
                <p className="text-sm text-muted-foreground mt-1 mb-4">
                  {t("errorMessage")}
                </p>
                <Button variant="outline" onClick={() => refetch()}>
                  {t("errorRetry")}
                </Button>
              </CardContent>
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

        <div className="relative z-10 p-4 md:p-8 max-w-6xl mx-auto safe-area-inset">
          <PageHeader
            icon={ShoppingCart}
            title={
              <>
                {t("title")}
                {isBringConnected && (
                  <Badge className="bg-success/10 text-success border-success/20 text-xs ml-2 align-middle">
                    <Check className="size-3 mr-1" />
                    {t("bringSync")}
                  </Badge>
                )}
              </>
            }
            subtitle={t("subtitleProgress", { unchecked: uncheckedItems, total: totalItems })}
            backHref="/"
            className="mb-8"
            actions={
              <>
                <OfflineIndicator className="mr-1" />
                <Button
                  variant={showChecked ? "outline" : "secondary"}
                  size="sm"
                  onClick={() => setShowChecked(!showChecked)}
                >
                  {showChecked ? t("hideChecked") : t("showAll")}
                </Button>
                {checkedItems > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearChecked}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-4 mr-2" />
                    {t("deleteChecked")}
                  </Button>
                )}
                {!isBringConnected && (
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/settings/bring">
                      <Link2 className="size-4 mr-2" />
                      {t("connectBring")}
                    </Link>
                  </Button>
                )}
              </>
            }
          />

          {/* Offline status banner */}
          <OfflineBanner
            onSyncClick={syncNow}
            isSyncing={isSyncing}
            className="mb-4 rounded-lg overflow-hidden"
          />

          {/* Install prompt for standalone shopping PWA */}
          <ShoppingInstallPrompt />

          {/* Smart Add Form */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-6"
          >
            <Card><CardContent className="p-4">
              {/* Main input row */}
              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  {/* Selected image preview */}
                  {selectedImage && (
                    <div className="relative size-10 shrink-0 rounded-lg overflow-hidden bg-muted/20">
                      <img
                        src={selectedImage}
                        alt={t("imagePreviewAlt")}
                        className="absolute inset-0 size-full object-cover object-center"
                      />
                      <button
                        onClick={() => setSelectedImage(null)}
                        className="absolute -top-1 -right-1 size-4 bg-destructive text-white rounded-full flex items-center justify-center z-10"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  )}

                  {/* Input with suggestions */}
                  <div className="relative flex-1">
                    <Input
                      ref={inputRef}
                      placeholder={t("inputPlaceholder")}
                      value={inputValue}
                      onChange={(e) => handleInputChange(e.target.value)}
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
                      className="pr-10"
                    />
                    {catalogLoading && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      </div>
                    )}

                    {/* Catalog suggestions dropdown */}
                    <AnimatePresence>
                      {showSuggestions && catalogResults.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="absolute z-[100] w-full mt-1 bg-popover border rounded-lg shadow-lg overflow-hidden max-h-80 overflow-y-auto"
                        >
                          {catalogResults.map((result, index) => {
                            const cat = CATEGORIES[result.category || "sonstiges"];
                            const Icon = cat?.icon || Package;
                            // Quick Add is only for new items (source=custom AND no id)
                            // Saved custom catalog items have source=custom but also have an id
                            const isQuickAdd = result.source === "custom" && !result.id;

                            return (
                              <button
                                key={result.id || `${result.source}-${index}`}
                                type="button"
                                className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent text-left transition-colors border-b border-border/50 last:border-0 ${
                                  isQuickAdd ? "bg-primary/5" : ""
                                }`}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  handleSelectSuggestion(result);
                                }}
                              >
                                {/* Product image or category icon */}
                                {isQuickAdd ? (
                                  <div className="size-8 rounded flex items-center justify-center shrink-0 bg-primary/10">
                                    <Plus className="size-4 text-primary" />
                                  </div>
                                ) : result.thumbnail_url ? (
                                  <div className="relative size-8 rounded overflow-hidden shrink-0 bg-muted/20">
                                    <img
                                      src={result.thumbnail_url}
                                      alt={result.name}
                                      className="absolute inset-0 size-full object-cover object-center"
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = 'none';
                                      }}
                                    />
                                  </div>
                                ) : (
                                  <div
                                    className="size-8 rounded flex items-center justify-center shrink-0"
                                    style={{ backgroundColor: `${cat?.color || "#6b7280"}20` }}
                                  >
                                    <Icon
                                      className="size-4"
                                      style={{ color: cat?.color || "#6b7280" }}
                                    />
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className={`font-medium truncate ${isQuickAdd ? "text-primary" : ""}`}>
                                    {isQuickAdd ? t("quickAdd", { name: result.name }) : result.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {isQuickAdd
                                      ? t("quickAddDescription")
                                      : (cat ? tCategories(cat.labelKey) : t("categoryFallback")) + (result.source === "bring" ? t("bringSourceSuffix") : "")}
                                  </p>
                                </div>
                              </button>
                            );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {speechSupported && (
                    <Button
                      type="button"
                      variant={isListening ? "default" : "outline"}
                      size="icon"
                      onClick={handleVoiceInput}
                      aria-label={isListening ? t("voiceStop") : t("voiceStart")}
                      title={isListening ? t("voiceStop") : t("voiceStart")}
                    >
                      <Mic className={`size-4 ${isListening ? "animate-pulse" : ""}`} strokeWidth={1.75} />
                    </Button>
                  )}
                  <Button
                    onClick={handleAddItem}
                    disabled={!inputValue.trim() || createItem.isPending}
                  >
                    {createItem.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                  </Button>
                </div>

                {/* Additional fields row */}
                <div className="flex flex-wrap gap-2">
                  {/* Quantity input */}
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min="0"
                      step="0.5"
                      placeholder={t("quantityPlaceholder")}
                      value={selectedQuantity ?? ""}
                      onChange={(e) => setSelectedQuantity(e.target.value ? parseFloat(e.target.value) : null)}
                      className="w-20 h-10 text-sm"
                    />
                    <Select value={selectedUnit} onValueChange={setSelectedUnit}>
                      <SelectTrigger className="w-24 h-10 text-sm">
                        <SelectValue placeholder={t("unitPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {UNITS.map((unit) => (
                          <SelectItem key={unit.value} value={unit.value}>
                            {unit.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Category selector */}
                  <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                    <SelectTrigger className="w-36 h-10 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CATEGORIES).map(([key, cat]) => {
                        const Icon = cat.icon;
                        return (
                          <SelectItem key={key} value={key}>
                            <div className="flex items-center gap-2">
                              <Icon className="size-4" style={{ color: cat.color }} />
                              {tCategories(cat.labelKey)}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>

                  {/* Notes input */}
                  <Input
                    placeholder={t("notesPlaceholder")}
                    value={selectedNotes}
                    onChange={(e) => setSelectedNotes(e.target.value)}
                    className="flex-1 min-w-32 h-10 text-sm"
                  />
                </div>
              </div>
            </CardContent></Card>
          </motion.div>

          <Separator className="mb-6" />

          {/* Shopping List */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <ScrollArea className="h-[calc(100vh-420px)]">
              <AnimatePresence mode="popLayout">
                {sortedCategories.length === 0 ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    {totalItems > 0 && !showChecked ? (
                      // All items are checked but hidden
                      <EmptyState
                        icon={Check}
                        title={t("emptyAllDoneTitle")}
                        description={t("emptyAllDoneCheckedHidden", { count: checkedItems })}
                        action={{
                          label: t("emptyAllDoneShowAction"),
                          onClick: () => setShowChecked(true),
                          variant: "link",
                        }}
                      />
                    ) : totalItems > 0 && checkedItems === totalItems ? (
                      // All items are checked and visible
                      <EmptyState
                        icon={Check}
                        title={t("emptyAllDoneTitle")}
                        description={t("emptyAllDoneVisibleDescription")}
                        action={{
                          label: t("emptyAllDoneDeleteAction"),
                          onClick: handleClearChecked,
                          variant: "link",
                        }}
                      />
                    ) : (
                      // Truly empty list
                      <EmptyState
                        icon={ShoppingCart}
                        title={t("emptyTitle")}
                        description={t("emptyDescription")}
                        action={{
                          label: t("emptyAction"),
                          onClick: () => inputRef.current?.focus(),
                          variant: "link",
                        }}
                      />
                    )}
                  </motion.div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {sortedCategories.map(([categoryKey, categoryItems]) => {
                      const category = CATEGORIES[categoryKey];
                      if (!category) return null;
                      const allChecked = categoryItems.every((i) => i.checked);

                      return (
                        <motion.div
                          key={categoryKey}
                          layout
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                        >
                          <Card
                            className={`transition-opacity ${
                              allChecked ? "opacity-55" : ""
                            }`}
                          >
                            <CardContent className="p-4">
                            {/* Category Header — functional-color dot + mono label */}
                            <div className="flex items-center gap-2 mb-3">
                              <span
                                className="size-2 shrink-0 rounded-full"
                                style={{ backgroundColor: category.color }}
                                aria-hidden="true"
                              />
                              <h3 className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
                                {tCategories(category.labelKey)}
                              </h3>
                              <Badge variant="neutral" className="ml-auto">
                                {categoryItems.filter((i) => !i.checked).length}/
                                {categoryItems.length}
                              </Badge>
                            </div>

                            {/* Items */}
                            <div className="flex flex-col gap-1">
                              <AnimatePresence mode="popLayout">
                                {categoryItems
                                  .sort((a, b) => (a.checked === b.checked ? 0 : a.checked ? 1 : -1))
                                  .map((item) => (
                                    <motion.div
                                      key={item.id}
                                      layout
                                      initial={{ opacity: 0, x: -10 }}
                                      animate={{ opacity: 1, x: 0 }}
                                      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                                      transition={{ duration: 0.2 }}
                                      className="group flex items-stretch gap-2"
                                    >
                                      <div className="flex-1 min-w-0">
                                        <ChecklistItem
                                          checked={item.checked}
                                          onCheckedChange={() => handleToggleItem(item.id)}
                                          color={category.color}
                                          className={
                                            item._syncStatus !== "synced"
                                              ? "border-primary ring-2 ring-primary/20"
                                              : undefined
                                          }
                                          label={
                                            <span className="flex items-center gap-2">
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.preventDefault();
                                                  handleOpenImageDialog(item);
                                                }}
                                                className="relative size-8 rounded-md shrink-0 overflow-hidden bg-muted/20"
                                                title={t("imageSearchTooltip")}
                                              >
                                                {item.image_url ? (
                                                  <img
                                                    src={item.image_url}
                                                    alt={item.name}
                                                    className="absolute inset-0 size-full object-cover object-center"
                                                    onError={(e) => {
                                                      (e.target as HTMLImageElement).style.display = "none";
                                                    }}
                                                  />
                                                ) : (
                                                  <span className="flex size-full items-center justify-center text-muted-foreground/50">
                                                    <Search className="size-4" strokeWidth={1.75} />
                                                  </span>
                                                )}
                                              </button>
                                              <span className="min-w-0 flex-1 truncate font-medium">
                                                {item.name}
                                              </span>
                                              {item.recipe_id && (
                                                <Tooltip>
                                                  <TooltipTrigger asChild>
                                                    <Badge variant="neutral" className="shrink-0 text-xs">
                                                      <ChefHat className="size-3 mr-1" strokeWidth={1.75} />
                                                      {t("recipeBadge")}
                                                    </Badge>
                                                  </TooltipTrigger>
                                                  <TooltipContent>{t("recipeTooltip")}</TooltipContent>
                                                </Tooltip>
                                              )}
                                            </span>
                                          }
                                          meta={
                                            <span className="flex items-center gap-2">
                                              {formatQuantity(item) && (
                                                <span className="font-mono tabular-nums text-xs">
                                                  {formatQuantity(item)}
                                                </span>
                                              )}
                                              {(() => {
                                                const person = personById(item.added_by);
                                                return person ? (
                                                  <PersonAvatar
                                                    name={person.name}
                                                    color={person.color}
                                                    avatarUrl={person.avatar_url}
                                                    size={24}
                                                  />
                                                ) : null;
                                              })()}
                                            </span>
                                          }
                                        />
                                      </div>

                                      {/* Quantity stepper — visible on mobile, hover on desktop */}
                                      <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="size-9"
                                          onClick={() => handleUpdateItemQuantity(item.id, -1)}
                                          aria-label={t("decreaseAria", { name: item.name })}
                                        >
                                          <Minus className="size-4" />
                                        </Button>
                                        <span
                                          className="w-6 text-center text-sm tabular-nums"
                                          aria-label={t("quantityAria", { count: item.quantity || 1 })}
                                        >
                                          {item.quantity || 1}
                                        </span>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="size-9"
                                          onClick={() => handleUpdateItemQuantity(item.id, 1)}
                                          aria-label={t("increaseAria", { name: item.name })}
                                        >
                                          <Plus className="size-4" />
                                        </Button>
                                      </div>

                                      {/* Edit menu popover */}
                                      <Popover
                                        open={editPopoverOpen === item.id}
                                        onOpenChange={(open) => {
                                          if (open) {
                                            handleOpenEditPopover(item);
                                          } else {
                                            setEditPopoverOpen(null);
                                          }
                                        }}
                                      >
                                        <PopoverTrigger asChild>
                                          <Button variant="ghost" size="icon" className="size-9 shrink-0 self-center">
                                            <MoreVertical className="size-4" />
                                          </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-72 p-3" align="end">
                                          <div className="flex flex-col gap-3">
                                            <div>
                                              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-1.5">
                                                <Tag className="size-3.5" />
                                                {t("editCategory")}
                                              </label>
                                              <Select value={editCategory} onValueChange={setEditCategory}>
                                                <SelectTrigger className="h-9">
                                                  <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  {Object.entries(CATEGORIES).map(([key, cat]) => {
                                                    const CatIcon = cat.icon;
                                                    return (
                                                      <SelectItem key={key} value={key}>
                                                        <div className="flex items-center gap-2">
                                                          <CatIcon className="size-4" style={{ color: cat.color }} />
                                                          {tCategories(cat.labelKey)}
                                                        </div>
                                                      </SelectItem>
                                                    );
                                                  })}
                                                </SelectContent>
                                              </Select>
                                            </div>
                                            <div>
                                              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-1.5">
                                                <Pencil className="size-3.5" />
                                                {t("editNotes")}
                                              </label>
                                              <Input
                                                placeholder={t("editNotesPlaceholder")}
                                                value={editNotes}
                                                onChange={(e) => setEditNotes(e.target.value)}
                                                className="h-9"
                                              />
                                            </div>
                                            <Separator />
                                            <div className="flex items-center gap-2 pt-2">
                                              <Button
                                                size="sm"
                                                className="flex-1"
                                                onClick={() => handleSaveItemEdits(item.id)}
                                              >
                                                <Check className="size-4 mr-1" />
                                                {t("editSave")}
                                              </Button>
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                                onClick={() => {
                                                  setEditPopoverOpen(null);
                                                  handleDeleteItem(item.id);
                                                }}
                                              >
                                                <Trash2 className="size-4" />
                                              </Button>
                                            </div>
                                          </div>
                                        </PopoverContent>
                                      </Popover>
                                    </motion.div>
                                  ))}
                              </AnimatePresence>
                            </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </AnimatePresence>
            </ScrollArea>
          </motion.div>

          {/* Progress indicator */}
          {totalItems > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="mt-6"
            >
              <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
                <span>{t("progressLabel")}</span>
                <span>{Math.round((checkedItems / totalItems) * 100)}%</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-success rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${(checkedItems / totalItems) * 100}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>
            </motion.div>
          )}
        </div>

      </main>

      {/* Image Search Dialog */}
      <Dialog open={imageDialogOpen} onOpenChange={(open) => {
        setImageDialogOpen(open);
        if (!open) {
          // Clean up state when dialog closes
          setImageSearchResults([]);
          setImageSearchQuery("");
          setEditingItemForImage(null);
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="size-5" />
              {t("imageDialogTitle", { name: editingItemForImage?.name ?? "" })}
            </DialogTitle>
          </DialogHeader>

          {/* Search input */}
          <div className="flex gap-2 mb-4">
            <Input
              placeholder={t("imageSearchInputPlaceholder")}
              value={imageSearchQuery}
              onChange={(e) => setImageSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleImageSearch(imageSearchQuery);
                }
              }}
              className="flex-1"
            />
            <Button
              onClick={() => handleImageSearch(imageSearchQuery)}
              disabled={imageSearchLoading || imageSearchQuery.length < 2}
            >
              {imageSearchLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
            </Button>
          </div>

          {/* Results grid */}
          <ScrollArea className="flex-1 -mx-6 px-6">
            {imageSearchLoading ? (
              <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                {[...Array(8)].map((_, i) => (
                  <Skeleton key={i} className="aspect-square rounded-lg" />
                ))}
              </div>
            ) : imageSearchResults.length > 0 ? (
              <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                {imageSearchResults.map((result, index) => (
                  <button
                    key={index}
                    onClick={() => handleSelectImage(result.thumbnail || result.url)}
                    className="relative aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-primary transition-colors focus:outline-none focus:border-primary bg-muted/20"
                  >
                    <img
                      src={result.thumbnail || result.url}
                      alt={result.title}
                      className="absolute inset-0 size-full object-cover object-center"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <ImageIcon className="size-12 mb-3 opacity-30" />
                <p>{t("imageNoResultsTitle")}</p>
                <p className="text-sm mt-1">{t("imageNoResultsDescription")}</p>
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
