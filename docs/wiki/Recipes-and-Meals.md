# Recipes & meal planning

Two related surfaces:

- **`/recipes`** — the family's cookbook
- **`/meals`** — a weekly meal-plan board

Tightly integrated: you plan a meal by dragging a recipe onto a day/slot; you generate a shopping list by selecting what's planned this week.

| Recipe library | Meal-plan board |
|---|---|
| ![/recipes — tile grid of saved recipes](images/recipes-library.png) | ![/meals — 14-day meal-plan board](images/meals-week-board.png) |

## Recipes

### Adding a recipe

Four paths:

1. **Manual entry** (`/recipes/new`)
   - Title, image, servings, total time, difficulty
   - Ingredients (free-form list with quantity + unit + name)
   - Instructions (numbered steps; markdown supported)
   - Tags (multi-select; auto-suggests existing tags)
   - Source URL (optional; links back if imported)

2. **Recipe image picker** in the new-recipe form (Search / Upload / Camera tabs):
   - **Search** — searches a recipe-image API for "recipe + your title" to auto-pick a hero photo
   - **Upload** — drag-drop or file-pick from disk; cropped server-side
   - **Camera** — uses the device camera to snap a photo of a paper recipe / cookbook page

3. **Chefkoch.de search & import** (`/recipes/search`) — searches the [Chefkoch.de](https://www.chefkoch.de/) recipe database (Germany's largest recipe site, ~340k recipes) by keyword and one-tap-imports the chosen result with title, ingredients, instructions, hero image, prep time, and source URL. Best path for German-language recipes.

4. **Import from any recipe URL (schema.org)** — paste a URL into the import dialog. Kinboard fetches the page, parses the embedded [schema.org/Recipe](https://schema.org/Recipe) JSON-LD, and creates a recipe entry from it. Works on any site that publishes structured recipe data: NYT Cooking, Serious Eats, Allrecipes, BBC Good Food, food blogs running standard recipe plugins, etc. Falls back gracefully if a site doesn't publish structured data — you get an error and can fall back to manual entry.

   Both import paths preserve the source URL on the recipe so you can jump back to the original later.

### Browsing recipes

`/recipes` is the cookbook view. Tile grid sorted by most-recent. Filter chips at the top:

- All / Favorites
- Per tag (vegetarian, quick, dessert, etc.)
- Search box (matches title + ingredients)

Tap a tile → the recipe detail page (`/recipes/[id]`).

### Recipe detail

Full ingredients list, full instructions (numbered, large readable type for kitchen-wall use), serving-size adjuster (auto-scales quantities), prep time. Quick actions:

- ⭐ Mark favorite
- 🛒 Add ingredients to shopping list
- 📋 Add to meal plan
- ✏️ Edit
- 🗑 Delete

The "Add to shopping list" pre-fills quantities by current serving size, so doubling the recipe doubles the list items.

### Tags

Each recipe can have multiple tags. Kinboard's catalog suggests common ones (`schnell`, `vegetarisch`, `kinderfreundlich`, etc.) but tags are free-form. Tag a recipe `meal-prep` and you can quick-filter to it later.

## Meal planning

`/meals` shows a 14-day calendar grid. Rows: meal types (breakfast, lunch, dinner, snack). Columns: days. Cells: planned meals.

### Filling cells

Three ways to fill a cell:

1. **Drag a recipe tile** from the right-hand sidebar onto the cell
2. **Tap an empty cell** → quick-add menu lets you choose a recipe or type a free-form name
3. **Right-click / long-press** an existing cell → quick options (move / clear / mark eaten)

Empty cells show a subtle "Try Pizza" or similar randomized hint based on the meal type to spark ideas — see [[mealHints translation namespace|Themes-and-Locales]] for the list.

### Sidebar: recipe quick-pick

The right sidebar lists your recipes. Filters mirror the cookbook view (favorites, tags, search). Drag any recipe onto any cell.

### Generate shopping list from the plan

The "Generate shopping list" button in the meal-plan toolbar collects all planned meals' ingredients (across the visible 14-day window), deduplicates by name, and adds them to the shopping list. Quantities scale based on each recipe's planned serving size.

A confirmation dialog lets you review what's about to be added before it lands on the shopping page.

### Weekly view vs. month view

The default is **2-week** because that matches typical "planning Sunday for the next two weeks" patterns. The view toggle in the toolbar switches to:

- **This week only** (compact, fewer cells)
- **2 weeks** (default)
- **Month** (4 weeks; tighter cells, harder to read on small screens)

## Free-form vs. recipe-linked entries

A meal plan cell can contain:

- A **recipe link** (cell shows recipe name + thumbnail + serving size; clicking opens the recipe)
- A **free-form name** ("Pizza takeaway", "Leftovers") — useful when the meal isn't in your cookbook

Free-form entries don't contribute to the shopping list (no ingredients to extract).

## Persistence

- Recipes live in `public.recipes` + `recipe_ingredients` + `recipe_tags`
- Meal plans live in `public.meal_plans` (one per family) + `meal_plan_entries` (one per cell)
- Real-time sync — adding a recipe on a phone shows up on the kitchen wall instantly

## Patterns that work well

- **Sunday planning ritual**: open `/meals`, drag-and-drop the week, click "Generate shopping list" → done
- **Kid-friendly menu picker**: filter recipes by tag `kinderfreundlich`, let the kids pick which meal to plan
- **"What can I make with what's in the fridge"**: search recipes by ingredient (in the cookbook search), pick one
- **Photographing handwritten recipes**: in `/recipes/new`, use the Camera tab to snap the recipe card and OCR is on the v1.2 wishlist (currently it's just an image)

## What's not supported

- **OCR / auto-extracting ingredients from a photo** — manual entry only (v1.2 wishlist)
- **Nutritional info** — no calorie / macro tracking
- **External recipe APIs** beyond Chefkoch + schema.org URL import (no Spoonacular / Edamam / etc. integration yet)
- **Per-person dietary preferences** (vegetarian, gluten-free) — handled via tags, not a structured filter
- **Bulk import from another cookbook app** — manual recipe re-entry

## Related

- [[Shopping]] — the list that meal-plan-generated ingredients land in
- [[Dashboard]] — meal-plan widget shows today's planned meals
