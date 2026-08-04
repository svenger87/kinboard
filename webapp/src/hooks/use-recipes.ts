"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamilyStore } from "@/stores/family-store";
import { requireFamilyId } from "./use-supabase-queries";
import type {
  Recipe,
  RecipeIngredient,
  RecipeTag,
  RecipeWithIngredients,
  RecipeInstruction,
} from "@/types/database";

// Query keys for recipes
export const recipeQueryKeys = {
  all: (familyId: string) => ["recipes", familyId] as const,
  detail: (familyId: string, recipeId: string) =>
    ["recipes", familyId, recipeId] as const,
  favorites: (familyId: string) => ["recipes", familyId, "favorites"] as const,
  tags: (familyId: string) => ["recipe-tags", familyId] as const,
  search: (familyId: string, query: string) =>
    ["recipes", familyId, "search", query] as const,
  externalSearch: (query: string) =>
    ["recipes", "external-search", query] as const,
};

// External recipe search result type
export interface ExternalRecipeResult {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  rating: number;
  ratingCount: number;
  difficulty: string;
  prepTime: number | null;
  sourceUrl: string;
  sourceDomain: string;
}

// Recipe input types
export interface CreateRecipeInput {
  title: string;
  description?: string;
  source_url?: string;
  source_domain?: string;
  image_url?: string;
  servings?: number;
  prep_time_minutes?: number;
  cook_time_minutes?: number;
  total_time_minutes?: number;
  difficulty?: "einfach" | "mittel" | "schwer";
  instructions: RecipeInstruction[];
  ingredients: Omit<RecipeIngredient, "id" | "recipe_id" | "created_at">[];
  tags?: string[];
}

export interface UpdateRecipeInput
  extends Omit<
    Partial<CreateRecipeInput>,
    | "description"
    | "image_url"
    | "prep_time_minutes"
    | "cook_time_minutes"
    | "total_time_minutes"
    | "source_url"
  > {
  id: string;
  is_favorite?: boolean;

  /**
   * Nullable columns have to be settable to null, or a field can never be
   * emptied. `undefined` looks like it would work and doesn't: supabase-js
   * serialises the update to JSON, which drops undefined keys, so the
   * column keeps its old value while the save reports success.
   */
  description?: string | null;
  image_url?: string | null;
  prep_time_minutes?: number | null;
  cook_time_minutes?: number | null;
  total_time_minutes?: number | null;
  source_url?: string | null;
}

// Fetch all recipes for the family
export function useRecipes(options?: { favorites?: boolean }) {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: options?.favorites
      ? recipeQueryKeys.favorites(family?.id ?? "")
      : recipeQueryKeys.all(family?.id ?? ""),
    queryFn: async (): Promise<RecipeWithIngredients[]> => {
       
      let query = (supabase as any)
        .from("recipes")
        .select(
          `
          *,
          ingredients:recipe_ingredients(*)
        `
        )
        .eq("family_id", requireFamilyId(family))
        .order("updated_at", { ascending: false });

      if (options?.favorites) {
        query = query.eq("is_favorite", true);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as RecipeWithIngredients[];
    },
    enabled: !!family?.id,
  });
}

// Fetch a single recipe with all details
export function useRecipe(recipeId: string | null) {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: recipeQueryKeys.detail(family?.id ?? "", recipeId ?? ""),
    queryFn: async (): Promise<RecipeWithIngredients | null> => {
      if (!recipeId) return null;

       
      const { data, error } = await (supabase as any)
        .from("recipes")
        .select(
          `
          *,
          ingredients:recipe_ingredients(*)
        `
        )
        .eq("id", recipeId)
        .eq("family_id", requireFamilyId(family))
        .single();

      if (error) throw error;
      return data as RecipeWithIngredients;
    },
    enabled: !!family?.id && !!recipeId,
  });
}

// Search recipes
export function useRecipeSearch(query: string) {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: recipeQueryKeys.search(family?.id ?? "", query),
    queryFn: async (): Promise<Recipe[]> => {
      if (!query || query.length < 2) return [];

       
      const { data, error } = await (supabase as any)
        .from("recipes")
        .select("*")
        .eq("family_id", requireFamilyId(family))
        .ilike("title", `%${query}%`)
        .order("updated_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      return data as Recipe[];
    },
    enabled: !!family?.id && query.length >= 2,
  });
}

// Fetch recipe tags
export function useRecipeTags() {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: recipeQueryKeys.tags(family?.id ?? ""),
    queryFn: async (): Promise<RecipeTag[]> => {
       
      const { data, error } = await (supabase as any)
        .from("recipe_tags")
        .select("*")
        .eq("family_id", requireFamilyId(family))
        .order("name");

      if (error) throw error;
      return data as RecipeTag[];
    },
    enabled: !!family?.id,
  });
}

// Create a new recipe
export function useCreateRecipe() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (input: CreateRecipeInput): Promise<Recipe> => {
      const { ingredients, tags, ...recipeData } = input;

      // Create the recipe
       
      const { data: recipe, error: recipeError } = await (supabase as any)
        .from("recipes")
        .insert({
          ...recipeData,
          family_id: requireFamilyId(family),
          // JSONB columns automatically serialize objects - don't stringify
          instructions: recipeData.instructions,
        })
        .select()
        .single();

      if (recipeError) throw recipeError;

      // Create ingredients
      if (ingredients && ingredients.length > 0) {
        const ingredientsWithRecipeId = ingredients.map((ing, index) => ({
          ...ing,
          recipe_id: recipe.id,
          sort_order: index,
        }));

         
        const { error: ingredientsError } = await (supabase as any)
          .from("recipe_ingredients")
          .insert(ingredientsWithRecipeId);

        if (ingredientsError) throw ingredientsError;
      }

      // Create or link tags
      if (tags && tags.length > 0) {
        for (const tagName of tags) {
          // Try to find or create the tag
           
          const { data: existingTag } = await (supabase as any)
            .from("recipe_tags")
            .select("id")
            .eq("family_id", requireFamilyId(family))
            .eq("name", tagName)
            .single();

          if (!existingTag) {
             
            const { error: tagError } = await (supabase as any).from("recipe_tags").insert({
              family_id: requireFamilyId(family),
              name: tagName,
            });
            if (tagError) throw tagError;
          }
        }
      }

      return recipe as Recipe;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.all(requireFamilyId(family)),
      });
      queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.tags(requireFamilyId(family)),
      });
    },
  });
}

// Update a recipe
export function useUpdateRecipe() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (input: UpdateRecipeInput): Promise<Recipe> => {
      const { id, ingredients, tags, ...updates } = input;

      // Prepare the update data
      const updateData: Record<string, unknown> = { ...updates };
      // JSONB columns automatically serialize objects - don't stringify
      updateData.updated_at = new Date().toISOString();

      // Update the recipe
       
      const { data: recipe, error: recipeError } = await (supabase as any)
        .from("recipes")
        .update(updateData)
        .eq("id", id)
        .eq("family_id", requireFamilyId(family))
        .select()
        .single();

      if (recipeError) throw recipeError;

      // Update ingredients if provided
      if (ingredients !== undefined) {
        // Delete existing ingredients
         
        const { error: deleteError } = await (supabase as any)
          .from("recipe_ingredients")
          .delete()
          .eq("recipe_id", id);
        if (deleteError) throw deleteError;

        // Insert new ingredients
        if (ingredients.length > 0) {
          const ingredientsWithRecipeId = ingredients.map((ing, index) => ({
            ...ing,
            recipe_id: id,
            sort_order: index,
          }));

           
          const { error: insertError } = await (supabase as any)
            .from("recipe_ingredients")
            .insert(ingredientsWithRecipeId);
          if (insertError) throw insertError;
        }
      }

      return recipe as Recipe;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.all(requireFamilyId(family)),
      });
      queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.detail(requireFamilyId(family), data.id),
      });
    },
  });
}

// Toggle recipe favorite status
export function useToggleRecipeFavorite() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      id,
      is_favorite,
    }: {
      id: string;
      is_favorite: boolean;
    }): Promise<Recipe> => {
       
      const { data, error } = await (supabase as any)
        .from("recipes")
        .update({ is_favorite, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("family_id", requireFamilyId(family))
        .select()
        .single();

      if (error) throw error;
      return data as Recipe;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.all(requireFamilyId(family)),
      });
      queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.favorites(requireFamilyId(family)),
      });
    },
  });
}

// Delete a recipe
export function useDeleteRecipe() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
       
      const { error } = await (supabase as any)
        .from("recipes")
        .delete()
        .eq("id", id)
        .eq("family_id", requireFamilyId(family));

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.all(requireFamilyId(family)),
      });
    },
  });
}

// Add recipe ingredients to shopping list
export function useAddRecipeToShoppingList() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family, device } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      recipeId,
      servings,
      ingredientIds,
    }: {
      recipeId: string;
      servings?: number;
      ingredientIds?: string[]; // Optional: only add specific ingredients
    }): Promise<void> => {
      // Fetch the recipe with ingredients
       
      const { data: recipe, error: recipeError } = await (supabase as any)
        .from("recipes")
        .select(
          `
          servings,
          ingredients:recipe_ingredients(*)
        `
        )
        .eq("id", recipeId)
        .single();

      if (recipeError) throw recipeError;

      const recipeServings = recipe.servings || 4;
      const targetServings = servings || recipeServings;
      const multiplier = targetServings / recipeServings;

      // Filter ingredients if specific ones are requested
      let ingredients = recipe.ingredients as RecipeIngredient[];
      if (ingredientIds && ingredientIds.length > 0) {
        ingredients = ingredients.filter((ing) =>
          ingredientIds.includes(ing.id)
        );
      }

      // Batch match ingredients against catalog for images and categories
      let catalogMatches: Record<string, {
        id: string | null;
        name: string;
        category: string | null;
        image_url: string | null;
        thumbnail_url: string | null;
      } | null> = {};

      try {
        const ingredientNames = ingredients.map((ing) => ing.name);
        const matchResponse = await fetch("/api/catalog/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            family_id: requireFamilyId(family),
            items: ingredientNames,
          }),
        });

        if (matchResponse.ok) {
          const data = await matchResponse.json();
          catalogMatches = data.matches || {};
        }
      } catch (err) {
        console.log("Could not match catalog items:", err);
        // Continue without catalog matching
      }

      // Create shopping items from ingredients with catalog data
      const shoppingItems = ingredients.map((ing) => {
        const catalogMatch = catalogMatches[ing.name.toLowerCase().trim()];
        return {
          family_id: requireFamilyId(family),
          name: ing.name,
          quantity: ing.quantity ? ing.quantity * multiplier : null,
          unit: ing.unit,
          notes: ing.notes,
          // Use catalog data if available, else fall back to recipe/default
          category: catalogMatch?.category || ing.category || "sonstiges",
          image_url: catalogMatch?.thumbnail_url || catalogMatch?.image_url || null,
          catalog_item_id: catalogMatch?.id || null,
          recipe_id: recipeId,
          source_device_id: device?.id || null,
        };
      });

      // Insert all shopping items
       
      const { error: insertError } = await (supabase as any)
        .from("shopping_items")
        .insert(shoppingItems);

      if (insertError) throw insertError;

    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["shopping_items", requireFamilyId(family)],
      });
    },
  });
}

// Parse-only result from POST /api/recipes/import (no DB write).
export interface ParsedRecipe {
  title: string;
  description: string | null;
  source_url: string;
  source_domain: string;
  image_url: string | null;
  servings: number;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  total_time_minutes: number | null;
  difficulty: "einfach" | "mittel" | "schwer" | null;
  instructions: RecipeInstruction[];
  ingredients: {
    name: string;
    quantity: number | null;
    unit: string | null;
    notes: string | null;
    category: string | null;
    sort_order: number;
  }[];
}

// Import recipe from URL and save to database
export function useImportRecipe() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (url: string): Promise<Recipe> => {
      // 1. Fetch and parse the recipe from the URL
      const response = await fetch("/api/recipes/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, family_id: requireFamilyId(family) }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to import recipe");
      }

      const parsed = await response.json();

      // 2. Save the recipe to the database
       
      const { data: recipe, error: recipeError } = await (supabase as any)
        .from("recipes")
        .insert({
          family_id: requireFamilyId(family),
          title: parsed.title,
          description: parsed.description,
          source_url: parsed.source_url,
          source_domain: parsed.source_domain,
          image_url: parsed.image_url,
          servings: parsed.servings || 4,
          prep_time_minutes: parsed.prep_time_minutes,
          cook_time_minutes: parsed.cook_time_minutes,
          total_time_minutes: parsed.total_time_minutes,
          difficulty: parsed.difficulty,
          // JSONB columns automatically serialize objects - don't stringify
          instructions: parsed.instructions,
        })
        .select()
        .single();

      if (recipeError) throw recipeError;

      // 3. Save the ingredients
      if (parsed.ingredients && parsed.ingredients.length > 0) {
        const ingredientsWithRecipeId = parsed.ingredients.map((ing: {
          name: string;
          quantity: number | null;
          unit: string | null;
          notes: string | null;
          category: string | null;
          sort_order: number;
        }) => ({
          recipe_id: recipe.id,
          name: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
          notes: ing.notes,
          category: ing.category,
          sort_order: ing.sort_order,
        }));

         
        const { error: ingredientsError } = await (supabase as any)
          .from("recipe_ingredients")
          .insert(ingredientsWithRecipeId);

        if (ingredientsError) throw ingredientsError;
      }

      return recipe as Recipe;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.all(requireFamilyId(family)),
      });
    },
  });
}

// Parse a recipe URL WITHOUT saving — powers the import detection preview.
export function useParseRecipeUrl() {
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (url: string): Promise<ParsedRecipe> => {
      const response = await fetch("/api/recipes/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, family_id: requireFamilyId(family) }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to parse recipe");
      }

      return (await response.json()) as ParsedRecipe;
    },
  });
}

// Create a recipe tag
export function useCreateRecipeTag() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      name,
      color,
    }: {
      name: string;
      color?: string;
    }): Promise<RecipeTag> => {
       
      const { data, error } = await (supabase as any)
        .from("recipe_tags")
        .insert({
          family_id: requireFamilyId(family),
          name,
          color: color || "#6b7280",
        })
        .select()
        .single();

      if (error) throw error;
      return data as RecipeTag;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.tags(requireFamilyId(family)),
      });
    },
  });
}

// Delete a recipe tag
export function useDeleteRecipeTag() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
       
      const { error } = await (supabase as any)
        .from("recipe_tags")
        .delete()
        .eq("id", id)
        .eq("family_id", requireFamilyId(family));

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.tags(requireFamilyId(family)),
      });
    },
  });
}

// Search external recipe sources (Chefkoch)
export function useExternalRecipeSearch(query: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: recipeQueryKeys.externalSearch(query),
    queryFn: async (): Promise<ExternalRecipeResult[]> => {
      if (!query || query.length < 2) return [];

      const params = new URLSearchParams({
        q: query,
        limit: "24",
      });

      const response = await fetch(`/api/recipes/search?${params}`);
      if (!response.ok) {
        throw new Error("Failed to search recipes");
      }

      const data = await response.json();
      return data.results;
    },
    enabled: (options?.enabled ?? true) && query.length >= 2,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}
