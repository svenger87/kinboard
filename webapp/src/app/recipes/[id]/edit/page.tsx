"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ChefHat,
  ArrowLeft,
  Plus,
  Loader2,
  Trash2,
  GripVertical,
  Save,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { RecipeImagePicker } from "@/components/recipe-image-picker";
import { PageHeader } from "@/components/page-header";
import {
  useRecipe,
  useUpdateRecipe,
  useKeyboardShortcuts,
  useSwipeNavigation,
} from "@/hooks";
import type { RecipeInstruction } from "@/types/database";

// Ingredient input type
interface IngredientInput {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  notes: string;
}

export default function EditRecipePage() {
  useKeyboardShortcuts();
  useSwipeNavigation();
  const t = useTranslations("recipes");
  const tCommon = useTranslations("common");
  const params = useParams();
  const router = useRouter();
  const recipeId = params.id as string;

  // Fetch existing recipe
  const { data: recipe, isLoading, error } = useRecipe(recipeId);
  const updateRecipe = useUpdateRecipe();

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [servings, setServings] = useState("4");
  const [prepTime, setPrepTime] = useState("");
  const [cookTime, setCookTime] = useState("");
  const [difficulty, setDifficulty] = useState<"einfach" | "mittel" | "schwer">("mittel");
  const [ingredients, setIngredients] = useState<IngredientInput[]>([
    { id: "1", name: "", quantity: "", unit: "", notes: "" },
  ]);
  const [instructions, setInstructions] = useState<string[]>([""]);
  const [initialized, setInitialized] = useState(false);

  // Initialize form with recipe data
  useEffect(() => {
    if (recipe && !initialized) {
      setTitle(recipe.title || "");
      setDescription(recipe.description || "");
      setImageUrl(recipe.image_url || null);
      setServings(String(recipe.servings || 4));
      setPrepTime(recipe.prep_time_minutes ? String(recipe.prep_time_minutes) : "");
      setCookTime(recipe.cook_time_minutes ? String(recipe.cook_time_minutes) : "");
      setDifficulty((recipe.difficulty as "einfach" | "mittel" | "schwer") || "mittel");

      // Initialize ingredients
      if (recipe.ingredients && recipe.ingredients.length > 0) {
        setIngredients(
          recipe.ingredients.map((ing) => ({
            id: ing.id,
            name: ing.name || "",
            quantity: ing.quantity ? String(ing.quantity) : "",
            unit: ing.unit || "",
            notes: ing.notes || "",
          }))
        );
      }

      // Initialize instructions
      const parsedInstructions: RecipeInstruction[] = recipe.instructions
        ? typeof recipe.instructions === "string"
          ? JSON.parse(recipe.instructions)
          : recipe.instructions
        : [];
      if (parsedInstructions.length > 0) {
        setInstructions(parsedInstructions.map((i) => i.text));
      }

      setInitialized(true);
    }
  }, [recipe, initialized]);

  // Handle save
  const handleSave = async () => {
    if (!title.trim()) return;

    try {
      await updateRecipe.mutateAsync({
        id: recipeId,
        title: title.trim(),
        // null, not undefined. supabase-js serialises the update to
        // JSON, which drops undefined keys — so emptying a field sent
        // nothing at all and the old value survived, while the save
        // reported success. `person_id` in this same form already sent
        // null correctly, which is why clearing the person worked and
        // clearing the description didn't.
        description: description.trim() || null,
        image_url: imageUrl || null,
        servings: parseInt(servings, 10) || 4,
        prep_time_minutes: prepTime ? parseInt(prepTime, 10) : null,
        cook_time_minutes: cookTime ? parseInt(cookTime, 10) : null,
        total_time_minutes:
          (prepTime ? parseInt(prepTime, 10) : 0) +
            (cookTime ? parseInt(cookTime, 10) : 0) || null,
        difficulty,
        ingredients: ingredients
          .filter((i) => i.name.trim())
          .map((i, idx) => ({
            name: i.name.trim(),
            quantity: i.quantity ? parseFloat(i.quantity) : null,
            unit: i.unit || null,
            group_name: null,
            notes: i.notes || null,
            category: null,
            sort_order: idx,
          })),
        instructions: instructions
          .filter((s) => s.trim())
          .map((text, idx) => ({
            step: idx + 1,
            text: text.trim(),
          })) as RecipeInstruction[],
      });
      router.push(`/recipes/${recipeId}`);
    } catch {
      toast.error(t("edit.updateFailed"));
    }
  };

  // Add ingredient row
  const addIngredient = () => {
    setIngredients([
      ...ingredients,
      { id: Date.now().toString(), name: "", quantity: "", unit: "", notes: "" },
    ]);
  };

  // Remove ingredient row
  const removeIngredient = (id: string) => {
    if (ingredients.length > 1) {
      setIngredients(ingredients.filter((i) => i.id !== id));
    }
  };

  // Update ingredient
  const updateIngredient = (
    id: string,
    field: keyof IngredientInput,
    value: string
  ) => {
    setIngredients(
      ingredients.map((i) => (i.id === id ? { ...i, [field]: value } : i))
    );
  };

  // Add instruction step
  const addInstruction = () => {
    setInstructions([...instructions, ""]);
  };

  // Remove instruction step
  const removeInstruction = (index: number) => {
    if (instructions.length > 1) {
      setInstructions(instructions.filter((_, i) => i !== index));
    }
  };

  // Update instruction
  const updateInstruction = (index: number, value: string) => {
    const newInstructions = [...instructions];
    newInstructions[index] = value;
    setInstructions(newInstructions);
  };

  // Loading state
  if (isLoading) {
    return (
      <TooltipProvider>
        <main id="main-content" className="min-h-screen relative overflow-hidden">
          <div className="page-gradient" />
          <div className="relative z-10 p-4 md:p-8 max-w-6xl mx-auto safe-area-inset">
            <div className="flex items-center gap-4 mb-6">
              <Skeleton className="size-10" />
              <Skeleton className="h-8 w-48" />
            </div>
            <div className="flex flex-col gap-6">
              <Card className="p-6">
                <Skeleton className="h-6 w-32 mb-4" />
                <div className="flex flex-col gap-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <div className="grid grid-cols-4 gap-4">
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </main>
      </TooltipProvider>
    );
  }

  // Error state
  if (error || !recipe) {
    return (
      <TooltipProvider>
        <main id="main-content" className="min-h-screen relative overflow-hidden">
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

  return (
    <TooltipProvider>
      <main id="main-content" className="min-h-screen relative overflow-hidden">
        {/* Background */}
        <div className="page-gradient" />

        <div className="relative z-10 p-4 md:p-8 max-w-6xl mx-auto safe-area-inset">
          <PageHeader
            icon={ChefHat}
            title={t("edit.title")}
            subtitle={recipe.title}
            backHref={`/recipes/${recipeId}`}
            className="mb-6"
          />

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-6"
          >
            {/* Basic Info */}
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">{t("form.sectionBasic")}</h2>

              <div className="flex flex-col gap-4">
                <div>
                  <Label htmlFor="title">{t("form.fieldTitle")}</Label>
                  <Input
                    id="title"
                    placeholder={t("form.fieldTitlePlaceholder")}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="description">{t("form.fieldDescription")}</Label>
                  <Textarea
                    id="description"
                    placeholder={t("form.fieldDescriptionPlaceholder")}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                  />
                </div>

                <div>
                  <Label>{t("form.fieldImage")}</Label>
                  <RecipeImagePicker
                    value={imageUrl}
                    onChange={setImageUrl}
                    recipeName={title}
                  />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <Label htmlFor="servings">{t("form.fieldServings")}</Label>
                    <Input
                      id="servings"
                      type="number"
                      min="1"
                      value={servings}
                      onChange={(e) => setServings(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="prepTime">{t("form.fieldPrepTime")}</Label>
                    <Input
                      id="prepTime"
                      type="number"
                      min="0"
                      placeholder="15"
                      value={prepTime}
                      onChange={(e) => setPrepTime(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="cookTime">{t("form.fieldCookTime")}</Label>
                    <Input
                      id="cookTime"
                      type="number"
                      min="0"
                      placeholder="30"
                      value={cookTime}
                      onChange={(e) => setCookTime(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="difficulty">{t("form.fieldDifficulty")}</Label>
                    <Select
                      value={difficulty}
                      onValueChange={(v) =>
                        setDifficulty(v as "einfach" | "mittel" | "schwer")
                      }
                    >
                      <SelectTrigger id="difficulty">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="einfach">{t("difficulty.einfach")}</SelectItem>
                        <SelectItem value="mittel">{t("difficulty.mittel")}</SelectItem>
                        <SelectItem value="schwer">{t("difficulty.schwer")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </Card>

            {/* Ingredients */}
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">{t("form.sectionIngredients")}</h2>

              <div className="flex flex-col gap-2">
                {ingredients.map((ing) => (
                  <div key={ing.id} className="flex items-center gap-2">
                    <GripVertical className="size-4 text-muted-foreground/50" />
                    <Input
                      placeholder={t("form.placeholderQuantity")}
                      value={ing.quantity}
                      onChange={(e) =>
                        updateIngredient(ing.id, "quantity", e.target.value)
                      }
                      className="w-20"
                    />
                    <Input
                      placeholder={t("form.placeholderUnit")}
                      value={ing.unit}
                      onChange={(e) =>
                        updateIngredient(ing.id, "unit", e.target.value)
                      }
                      className="w-20"
                    />
                    <Input
                      placeholder={t("form.placeholderIngredient")}
                      value={ing.name}
                      onChange={(e) =>
                        updateIngredient(ing.id, "name", e.target.value)
                      }
                      className="flex-1"
                    />
                    <Input
                      placeholder={t("form.placeholderNote")}
                      value={ing.notes}
                      onChange={(e) =>
                        updateIngredient(ing.id, "notes", e.target.value)
                      }
                      className="w-32"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeIngredient(ing.id)}
                      disabled={ingredients.length === 1}
                      aria-label={t("form.removeIngredientAria")}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={addIngredient}
                className="mt-3"
              >
                <Plus className="size-4 mr-2" />
                {t("form.addIngredient")}
              </Button>
            </Card>

            {/* Instructions */}
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">{t("form.sectionInstructions")}</h2>

              <div className="flex flex-col gap-3">
                {instructions.map((step, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                      <span className="text-sm font-semibold text-primary">
                        {index + 1}
                      </span>
                    </div>
                    <Textarea
                      placeholder={t("form.placeholderStep", { n: index + 1 })}
                      value={step}
                      onChange={(e) => updateInstruction(index, e.target.value)}
                      rows={2}
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeInstruction(index)}
                      disabled={instructions.length === 1}
                      aria-label={t("form.removeStepAria", { n: index + 1 })}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={addInstruction}
                className="mt-3"
              >
                <Plus className="size-4 mr-2" />
                {t("form.addStep")}
              </Button>
            </Card>

            {/* Actions */}
            <div className="flex gap-2">
              <Link href={`/recipes/${recipeId}`}>
                <Button variant="outline">{tCommon("cancel")}</Button>
              </Link>
              <Button
                onClick={handleSave}
                disabled={!title.trim() || updateRecipe.isPending}
                className="flex-1"
              >
                {updateRecipe.isPending ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Save className="size-4 mr-2" />
                )}
                {tCommon("save")}
              </Button>
            </div>
          </motion.div>
        </div>
      </main>
    </TooltipProvider>
  );
}
