"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  ChefHat,
  Link as LinkIcon,
  Plus,
  Loader2,
  Trash2,
  GripVertical,
  CheckCircle2,
  Download,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/page-header";
import { RecipeImagePicker } from "@/components/recipe-image-picker";
import {
  useCreateRecipe,
  useImportRecipe,
  useParseRecipeUrl,
  useKeyboardShortcuts,
  useSwipeNavigation,
  type CreateRecipeInput,
  type ParsedRecipe,
} from "@/hooks";
import type { RecipeInstruction } from "@/types/database";

// Ingredient input type
interface IngredientInput {
  id: string;
  name: string;
  quantity: string;
  unit: string;
}

export default function NewRecipePage() {
  useKeyboardShortcuts();
  useSwipeNavigation();
  const router = useRouter();
  const t = useTranslations("recipes");

  // State for import mode
  const [importUrl, setImportUrl] = useState("");
  const [mode, setMode] = useState<"choose" | "import" | "manual">("choose");
  const [parsed, setParsed] = useState<ParsedRecipe | null>(null);

  // State for manual recipe creation
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [servings, setServings] = useState("4");
  const [prepTime, setPrepTime] = useState("");
  const [cookTime, setCookTime] = useState("");
  const [difficulty, setDifficulty] = useState<"einfach" | "mittel" | "schwer">("mittel");
  const [ingredients, setIngredients] = useState<IngredientInput[]>([
    { id: "1", name: "", quantity: "", unit: "" },
  ]);
  const [instructions, setInstructions] = useState<string[]>([""]);

  // Mutations
  const importRecipe = useImportRecipe();
  const createRecipe = useCreateRecipe();
  const parseRecipe = useParseRecipeUrl();

  // Handle parse (detect step — no DB write)
  const handleParse = async () => {
    if (!importUrl.trim()) return;
    try {
      const result = await parseRecipe.mutateAsync(importUrl.trim());
      setParsed(result);
    } catch {
      toast.error(t("importFailed"));
    }
  };

  // Handle save after detection (re-imports + inserts)
  const handleSaveParsed = async () => {
    if (!parsed) return;
    try {
      const recipe = await importRecipe.mutateAsync(importUrl.trim());
      router.push(`/recipes/${recipe.id}`);
    } catch {
      toast.error(t("new.saveFailed"));
    }
  };

  // Handle manual creation
  const handleCreate = async () => {
    if (!title.trim()) return;

    const recipeInput: CreateRecipeInput = {
      title: title.trim(),
      description: description.trim() || undefined,
      image_url: imageUrl || undefined,
      servings: parseInt(servings, 10) || 4,
      prep_time_minutes: prepTime ? parseInt(prepTime, 10) : undefined,
      cook_time_minutes: cookTime ? parseInt(cookTime, 10) : undefined,
      total_time_minutes:
        (prepTime ? parseInt(prepTime, 10) : 0) +
        (cookTime ? parseInt(cookTime, 10) : 0) || undefined,
      difficulty,
      ingredients: ingredients
        .filter((i) => i.name.trim())
        .map((i, idx) => ({
          name: i.name.trim(),
          quantity: i.quantity ? parseFloat(i.quantity) : null,
          unit: i.unit || null,
          group_name: null,
          notes: null,
          category: null,
          sort_order: idx,
        })),
      instructions: instructions
        .filter((s) => s.trim())
        .map((text, idx) => ({
          step: idx + 1,
          text: text.trim(),
        })) as RecipeInstruction[],
    };

    try {
      const recipe = await createRecipe.mutateAsync(recipeInput);
      router.push(`/recipes/${recipe.id}`);
    } catch {
      toast.error(t("new.saveFailed"));
    }
  };

  // Add ingredient row
  const addIngredient = () => {
    setIngredients([
      ...ingredients,
      { id: Date.now().toString(), name: "", quantity: "", unit: "" },
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

  return (
    <TooltipProvider>
      <main id="main-content" className="min-h-screen relative overflow-hidden">
        {/* Background */}
        <div className="page-gradient" />

        <div className="relative z-10 p-4 md:p-8 max-w-6xl mx-auto safe-area-inset">
          <PageHeader
            icon={Plus}
            title={t("new.title")}
            subtitle={t("new.subtitle")}
            backHref="/recipes"
            className="mb-6"
          />

          {/* Mode Selection */}
          {mode === "choose" && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid md:grid-cols-2 gap-4"
            >
              <Card
                className="p-6 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
                onClick={() => setMode("import")}
              >
                <LinkIcon className="size-8 text-primary mb-4" />
                <h2 className="text-lg font-semibold mb-2">{t("new.cardImportTitle")}</h2>
                <p className="text-sm text-muted-foreground">
                  {t("new.cardImportDescription")}
                </p>
              </Card>

              <Card
                className="p-6 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
                onClick={() => setMode("manual")}
              >
                <ChefHat className="size-8 text-primary mb-4" />
                <h2 className="text-lg font-semibold mb-2">{t("new.cardManualTitle")}</h2>
                <p className="text-sm text-muted-foreground">
                  {t("new.cardManualDescription")}
                </p>
              </Card>
            </motion.div>
          )}

          {/* Import Mode */}
          {mode === "import" && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <LinkIcon className="size-5 text-primary" />
                  <h2 className="text-lg font-semibold">{t("new.importHeading")}</h2>
                </div>

                <p className="text-sm text-muted-foreground mb-4">
                  {t("new.importIntro")}
                </p>

                <div className="flex gap-2">
                  <Input
                    placeholder={t("new.importPlaceholder")}
                    value={importUrl}
                    onChange={(e) => {
                      setImportUrl(e.target.value);
                      if (parsed) setParsed(null);
                    }}
                    className="flex-1 focus-visible:border-primary"
                  />
                  <Button
                    onClick={handleParse}
                    disabled={!importUrl.trim() || parseRecipe.isPending}
                  >
                    {parseRecipe.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      t("new.detectButton")
                    )}
                  </Button>
                </div>

                {parseRecipe.isError && (
                  <p className="text-sm text-destructive mt-2">
                    {t("new.importErrorMessage")}
                  </p>
                )}

                {parsed && (
                  <div className="mt-6 flex flex-col gap-4">
                    <Card className="overflow-hidden">
                      <div className="flex gap-4 p-4">
                        <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-muted">
                          {parsed.image_url ? (
                            <img src={parsed.image_url} alt={parsed.title} className="size-full object-cover" />
                          ) : (
                            <div className="flex size-full items-center justify-center">
                              <ChefHat className="size-8 text-muted-foreground/30" strokeWidth={1.75} />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <Badge variant="success" className="mb-1.5">
                            <CheckCircle2 className="size-3.5" strokeWidth={1.75} />
                            {t("new.detectedBadge")}
                          </Badge>
                          <h3 className="truncate font-semibold">{parsed.title}</h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {t("new.detectedMeta", {
                              ingredients: parsed.ingredients.length,
                              steps: parsed.instructions.length,
                              minutes: parsed.total_time_minutes ?? 0,
                            })}
                          </p>
                        </div>
                      </div>
                    </Card>

                    {parsed.ingredients.length > 0 && (
                      <div>
                        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                          {t("new.detectedIngredientsHeading")}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {parsed.ingredients.map((ing) => (
                            <Badge key={ing.sort_order} variant="neutral">
                              {ing.quantity != null ? `${ing.quantity}${ing.unit ? ` ${ing.unit}` : ""} ` : ""}{ing.name}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    <Button onClick={handleSaveParsed} disabled={importRecipe.isPending} className="w-full">
                      {importRecipe.isPending ? (
                        <>
                          <Loader2 className="size-4 mr-2 animate-spin" />
                          {t("importingLabel")}
                        </>
                      ) : (
                        <>
                          <Download className="size-4 mr-2" />
                          {t("new.saveButton")}
                        </>
                      )}
                    </Button>
                  </div>
                )}

                <div className="flex gap-2 mt-4">
                  <Button variant="outline" onClick={() => setMode("choose")}>
                    {t("new.backButton")}
                  </Button>
                  <Button variant="ghost" onClick={() => setMode("manual")}>
                    {t("new.switchToManual")}
                  </Button>
                </div>
              </Card>
            </motion.div>
          )}

          {/* Manual Mode */}
          {mode === "manual" && (
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
                  {ingredients.map((ing, index) => (
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
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeIngredient(ing.id)}
                        disabled={ingredients.length === 1}
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
                <Button variant="outline" onClick={() => setMode("choose")}>
                  {t("new.backButton")}
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={!title.trim() || createRecipe.isPending}
                  className="flex-1"
                >
                  {createRecipe.isPending ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <ChefHat className="size-4 mr-2" />
                  )}
                  {t("new.saveButton")}
                </Button>
              </div>
            </motion.div>
          )}
        </div>
      </main>
    </TooltipProvider>
  );
}
