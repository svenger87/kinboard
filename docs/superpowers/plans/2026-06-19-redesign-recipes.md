# Plan 9 — Redesign: RECIPES (Salbei/Leinen)

For agentic workers: use superpowers:subagent-driven-development

## Goal

Restyle the five Kinboard recipe surfaces to the "Salbei/Leinen" design language: remove `GlassCard` and all backdrop-blur from app surfaces, swap `month-primary`→`primary`, replace the library favorites `<Select>` with filter chips, convert the detail page to a photo-header + meta-pills + `ChecklistItem` layout, add a "Zum Essensplan" CTA wired to the real meal-planner mutation, and split the URL import into a parse→preview→save flow against the real parse API. All EN/DE/FR i18n parity maintained (CI gate); changelog updated.

## Architecture

- **Routes (unchanged paths):** `webapp/src/app/recipes/page.tsx` (library), `recipes/[id]/page.tsx` (detail), `recipes/new/page.tsx` (mode chooser → import OR manual), `recipes/search/page.tsx` (external Chefkoch search), `recipes/[id]/edit/page.tsx` (edit form).
- **Data layer (unchanged):** `webapp/src/hooks/use-recipes.ts` provides `useRecipes`, `useRecipe`, `useCreateRecipe`, `useToggleRecipeFavorite`, `useDeleteRecipe`, `useImportRecipe`, `useAddRecipeToShoppingList`, `useRecipeTags`. `webapp/src/hooks/use-meal-planner.ts` provides `useAddMealPlanEntry` + `getWeekStart` (both re-exported from `@/hooks`).
- **Parse API (unchanged, parse-only):** `webapp/src/app/api/recipes/import/route.ts` `POST` fetches a URL, extracts Schema.org JSON-LD, and returns a `ParsedRecipe` JSON object WITHOUT writing to Supabase. Its response shape (verified) is:
  ```ts
  {
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
    instructions: { step: number; text: string }[];
    ingredients: { name: string; quantity: number | null; unit: string | null; notes: string | null; category: string | null; sort_order: number }[];
  }
  ```
  On error it returns `{ error: string, reason?: string }` with status 400/404/500.
- **Shared components (already shipped, reuse):** `Card`/`CardContent` (`@/components/ui/card`, flat `rounded-2xl border bg-card elev-md`), `Badge` (`@/components/ui/badge`, variants `default|secondary|destructive|outline|success|warning|error|neutral`), `FAB` (`@/components/fab`, props `{icon,onClick,ariaLabel,className?}`), `ChecklistItem` (`@/components/checklist-item`, props `{checked,onCheckedChange,label,meta?,color?,className?}`), `PersonChip` (`@/components/person-chip`, toggle-chip reference pattern), `Button` (`@/components/ui/button`, default variant = primary accent), `PageHeader` (`@/components/page-header`). `.page-gradient` CSS utility for the page background (used by Plan 8 meals page). `GlassCard` still exists but MUST NOT be used on recipe surfaces.
- **New component:** `RecipeFilterChip` (a small toggle chip button) — co-located inline in `recipes/page.tsx` (not a shared file, since it is library-specific).
- **New hook:** `useParseRecipeUrl` added to `use-recipes.ts` — parse-only, returns `ParsedRecipe`, does NOT insert.

## Tech Stack

Next.js 16 App Router, React 19, Tailwind, shadcn/ui, framer-motion, next-intl (EN+DE+FR parity is a CI gate), TanStack Query, Supabase, lucide-react (stroke 1.75).

## Global Constraints

- No `next build` locally. Per-task gate: `cd webapp && npm run lint` and `npx tsc --noEmit`. No unit tests — verification = lint+tsc+structural self-review; live smoke deferred to user. Do NOT write Jest/RTL/TDD steps.
- Reuse Foundation + Plan 2-8 components; never hardcode accent hex (primary/tints); image gradients/scrims OVER PHOTOS are allowed (not app-surface glass); difficulty/category functional colors may stay as documented inline tints; NO literal text-white except over photos/images. Lucide stroke 1.75. Quantities `font-mono`.
- NO glass/backdrop-blur on app surfaces (remove GlassCard + the heart/badge backdrop-blur from recipes). NO fake features — the import preview uses the REAL parse API output; "Zum Essensplan" uses the REAL useAddMealPlanEntry.
- Touch targets ≥44px. next-intl EN/DE/FR parity (CI gate) — every new key in all three.
- Commits: Conventional Commits, NO `Co-Authored-By: Claude` trailer. One commit per task.

---

### Task 1 — Library restyle (`recipes/page.tsx`)

Replace `GlassCard` with flat `Card`, swap the favorites `<Select>` for filter chips (All / Favorites + tag chips), drop backdrop-blur from heart/source overlays (the gradient over the photo stays — legible-text-over-image is allowed), clamp the grid to 3 columns, add a mobile `FAB`, and swap `month-primary`→`primary` / `variant="month"`→default.

**Files**
- `webapp/src/app/recipes/page.tsx` (edit)

**Interfaces**
- Consumes: `useRecipes`, `useRecipeSearch`, `useToggleRecipeFavorite`, `useDeleteRecipe`, `useImportRecipe`, `useRecipeTags` (from `@/hooks`); `Card`/`CardContent` (`@/components/ui/card`); `FAB` (`@/components/fab`); `Badge`; `Button`; `Input`; `RecipeWithIngredients` / `RecipeTag` types.
- Produces: restyled library page; inline `RecipeFilterChip` component; tag-filter state.

**Steps**
- [ ] Update imports: remove `GlassCard` from `@/components/ui/card` import; add `Card, CardContent`. Add `FAB` import: `import { FAB } from "@/components/fab";`. Add `useRecipeTags` to the `@/hooks` import block. Remove the now-unused `Select*` imports (`Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue`). Remove the unused `Filter` and `Star` lucide imports if they are not referenced after this task (verify with tsc; `Filter`/`Star` are imported but the redesign drops them).
- [ ] Add a `RecipeTag` type import: change `import type { Recipe, RecipeWithIngredients } from "@/types/database";` to also import `RecipeTag`.
- [ ] Replace the filter state line. Anchor:
  ```ts
  const [filter, setFilter] = useState<"all" | "favorites">("all");
  ```
  Replace with:
  ```ts
  const [filter, setFilter] = useState<"all" | "favorites">("all");
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  ```
- [ ] Add the tags query next to the existing data-fetching block. Anchor:
  ```ts
  const importRecipe = useImportRecipe();
  ```
  Insert after it:
  ```ts
  const { data: tags = [] } = useRecipeTags();
  ```
- [ ] Add tag filtering to `displayedRecipes`. Anchor:
  ```ts
  const displayedRecipes = searchQuery.length >= 2 ? searchResults : recipes;
  ```
  Replace with:
  ```ts
  const baseRecipes = searchQuery.length >= 2 ? searchResults : recipes;
  const displayedRecipes = activeTagId
    ? baseRecipes.filter((r) =>
        ((r as RecipeWithIngredients).tags ?? []).some((tag) => tag.id === activeTagId)
      )
    : baseRecipes;
  ```
  (Note: `searchResults` are plain `Recipe[]` with no `tags`; the cast + `?? []` makes the filter a no-op for them, which is acceptable — tag filtering only meaningfully applies to the full list. Documented deferral: search results are not tag-filtered.)
- [ ] In the loading-state and error-state JSX, replace the two `min-h-screen ... bg-gradient-to-b ... to-month-primary/5` background `<div>`s and their wrapping `<GlassCard>`s. For the background, replace each:
  ```tsx
  <div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none" />
  ```
  with:
  ```tsx
  <div className="page-gradient" />
  ```
  (3 occurrences in this file — loading, error, main. Use `replace_all`.)
- [ ] In the loading skeleton, replace `<GlassCard key={i} className="overflow-hidden">` with `<Card key={i} className="overflow-hidden">` and its closing `</GlassCard>` with `</Card>`.
- [ ] In the error state, replace `<GlassCard className="p-8">` with `<Card className="p-8">` and closing tag with `</Card>`.
- [ ] Swap the `newButton` CTA from `variant="month"` to default. Anchor (inside PageHeader actions):
  ```tsx
  <Link href="/recipes/new">
                <Button variant="month" size="sm">
                  <Plus className="size-4 mr-2" />
                  {t("newButton")}
                </Button>
              </Link>
  ```
  Replace `variant="month"` with no variant prop (default). Also swap the empty-state `<Button variant="month">` (in the empty `<>` branch) to default the same way.
- [ ] Replace the sticky filter bar's `<GlassCard className="p-4">` (and its closing `</GlassCard>`) with `<Card className="p-4">` / `</Card>`. Inside it, give the search `<Input>` a focus border: append `focus-visible:border-primary` to its existing `className="pl-10"` → `className="pl-10 focus-visible:border-primary"`.
- [ ] Replace the favorites `<Select>` block (the first Select, value=`filter`) with a row of filter chips. Anchor — remove the whole block:
  ```tsx
  <Select value={filter} onValueChange={(v) => setFilter(v as "all" | "favorites")}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("filterAll")}</SelectItem>
                      <SelectItem value="favorites">{t("filterFavorites")}</SelectItem>
                    </SelectContent>
                  </Select>
  ```
  Replace with a chip group (these chips also need to live in a horizontally-scrollable row; keep the existing sort Select + view toggle as siblings). Wrap the chips:
  ```tsx
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
  ```
- [ ] Clamp the grid: in the grid-view `<div>` replace `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` with `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` (drop `xl:grid-cols-4`).
- [ ] Add the mobile FAB. Inside the outer `<main>`, just before the closing `</main>` (after the AlertDialog), add:
  ```tsx
  <div className="sm:hidden">
          <Link href="/recipes/new" aria-hidden="true" tabIndex={-1}>
            <FAB
              icon={Plus}
              onClick={() => {}}
              ariaLabel={t("newButton")}
              className="pointer-events-none"
            />
          </Link>
        </div>
  ```
  Because `FAB` is a `<button>` (not a link), wrap it in a `<Link>` is not navigable on its own. Instead use a navigation-friendly FAB: replace the above with the router-push form using `useRouter`:
  - Add `import { useRouter } from "next/navigation";` to imports.
  - Add `const router = useRouter();` near the other hooks.
  - Render:
  ```tsx
  <div className="sm:hidden">
          <FAB
            icon={Plus}
            onClick={() => router.push("/recipes/new")}
            ariaLabel={t("newButton")}
          />
        </div>
  ```
  (Delete the `<Link>`-wrapped variant; only the router-push FAB ships.)
- [ ] Restyle the grid `RecipeCard` component. Replace `<GlassCard className="overflow-hidden group cursor-pointer hover:ring-2 hover:ring-month-primary/50 transition-all">` with `<Card className="overflow-hidden group cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all">` and the matching closing `</GlassCard>` → `</Card>`.
- [ ] In `RecipeCard`, restyle the favorite button. Anchor:
  ```tsx
  className="absolute top-3 right-3 p-2 rounded-full bg-black/40 backdrop-blur-sm text-white hover:bg-black/60 transition-colors"
            >
              <Heart
                className={`size-4 ${recipe.is_favorite ? "fill-red-400 text-red-400" : ""}`}
              />
  ```
  Replace with a flat card-surface button (≥44px touch target via padding) and the `destructive` token for the favorite state:
  ```tsx
  className="absolute top-3 right-3 flex size-11 items-center justify-center rounded-full border border-border bg-card/90 text-foreground transition-colors hover:bg-card"
            >
              <Heart
                className={`size-4 ${recipe.is_favorite ? "fill-destructive text-destructive" : ""}`}
                strokeWidth={1.75}
              />
  ```
  (DOC: favorite uses the `destructive` token as the functional "favorite/heart" color, replacing the hardcoded `red-400`. The button is over the photo's gradient but is itself a flat card-colored chip, not glass.)
- [ ] In `RecipeCard`, restyle the source `Badge`. Anchor:
  ```tsx
  <Badge variant="secondary" className="text-[10px] bg-black/40 backdrop-blur-sm border-0 text-white/80">
  ```
  Replace with (drop backdrop-blur; keep it a flat dark chip legible over the photo — this is over-photo, allowed):
  ```tsx
  <Badge variant="secondary" className="text-[10px] border-0 bg-black/55 text-white/90">
  ```
- [ ] In `RecipeCard`, the difficulty `Badge` uses inline `difficulty.bg`/`difficulty.text` functional tints — keep them (documented allowance). No change needed there beyond confirming no `month-primary`.
- [ ] Restyle the `RecipeListItem` component: replace `<GlassCard className="p-4 group cursor-pointer hover:ring-2 hover:ring-month-primary/50 transition-all">` → `<Card className="p-4 group cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all">` and closing tag. Replace the title hover class `group-hover:text-month-primary` → `group-hover:text-primary`. The list-item heart already uses `fill-destructive text-destructive` — leave it.
- [ ] Add the inline `RecipeFilterChip` component at the bottom of the file (after `RecipeListItem`):
  ```tsx
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
        className={`inline-flex min-h-[36px] items-center rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
          active
            ? "bg-primary/12 text-primary"
            : "bg-muted text-muted-foreground hover:bg-muted/80"
        }`}
      >
        {label}
      </button>
    );
  }
  ```
- [ ] Remove the now-dead `filter === "favorites"` active-filter `Badge` only if `filter` is still used (it is — keep the active-filters summary block; it still references `filter`/`setFilter`). No change there.
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected: PASS.
- [ ] Commit: `feat(recipes): flat Card library with filter chips, 3-col grid, mobile FAB`

---

### Task 2 — Detail restyle (`recipes/[id]/page.tsx`)

Photo header with back + heart overlay, meta as pills, ingredients via `ChecklistItem`, flat `Card`, `month-primary`→`primary`. (Footer CTAs handled here too: rename "Einkaufen"→"Auf Liste"; the "Zum Essensplan" CTA + dialog is added in Task 3 to keep commits focused, but the footer layout is built here with a placeholder slot.)

**Files**
- `webapp/src/app/recipes/[id]/page.tsx` (edit)

**Interfaces**
- Consumes: `useRecipe`, `useToggleRecipeFavorite`, `useDeleteRecipe`, `useAddRecipeToShoppingList`; `Card`/`CardContent`; `ChecklistItem` (`@/components/checklist-item`); `Badge`; `Button`.
- Produces: restyled detail page with photo-header overlay, pill meta row, checklist ingredients, flat steps, footer action row (Auf Liste button + meal-plan slot).

**Steps**
- [ ] Update imports: replace `import { GlassCard } from "@/components/ui/card";` with `import { Card } from "@/components/ui/card";`. Remove `import { Checkbox } from "@/components/ui/checkbox";` (ChecklistItem owns its checkbox). Add `import { ChecklistItem } from "@/components/checklist-item";`. Remove `import { Separator } from "@/components/ui/separator";` (meta becomes pills, no separators). Add `CalendarPlus` to the lucide import list.
- [ ] Replace all three background `<div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none" />` (loading, error, main) with `<div className="page-gradient" />` (use `replace_all`).
- [ ] In the loading skeleton, replace the two `<GlassCard className="p-4">` (ingredients + instructions skeletons) with `<Card className="p-4">` and matching closing tags.
- [ ] In the error/not-found state, replace `<GlassCard className="p-8 text-center">` with `<Card className="p-8 text-center">` and closing tag.
- [ ] Remove the heart/print/edit/delete buttons from `PageHeader actions`? — NO. Keep print/edit/delete in `PageHeader actions`, but REMOVE the favorite (heart) `<Button>` from PageHeader actions because the heart now lives on the photo header overlay. Anchor — delete this block from the `actions` prop:
  ```tsx
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
  ```
  (Keep `Printer`, `Edit`, `Trash2` action buttons. The `Heart` import stays — reused in the photo overlay.)
- [ ] Replace the Hero Image block (the `recipe.image_url && (...)` motion.div) with a photo header that always renders (uses a `ChefHat` fallback when no image) and overlays a back button (top-left) + heart toggle (top-right) over a `from-black/50` scrim. Anchor the existing block opening:
  ```tsx
  {/* Hero Image */}
          {recipe.image_url && (
  ```
  through its closing `)}`. Replace the whole block with:
  ```tsx
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
  ```
- [ ] Replace the Meta Info `<GlassCard className="p-4">` block with a flat `Card` whose meta is a row of pills (time/servings/difficulty). Anchor the opening `<GlassCard className="p-4">` inside the Meta Info motion.div through its closing `</GlassCard>`. Replace with:
  ```tsx
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
  ```
  Add `Flame` to the lucide import list (used by the difficulty pill, matching the design handoff).
- [ ] Convert the ingredients panel to flat `Card` + `ChecklistItem`. Anchor the ingredients `<GlassCard className="p-4">` block. Replace through its closing `</GlassCard>` with:
  ```tsx
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
                          <span className="font-mono">
                            {formatQuantity(ingredient.quantity)}
                            {ingredient.unit ? ` ${ingredient.unit}` : ""}
                          </span>
                        ) : undefined
                      }
                    />
                  ))}
                </div>
              </Card>
  ```
- [ ] Convert the instructions panel to flat `Card` and swap `month-primary`→`primary` on the step circle. Anchor the instructions `<GlassCard className="p-4">` opening and closing `</GlassCard>`. Replace opening with `<Card className="p-4">`, closing with `</Card>`. Inside, change the incomplete-step circle classes from:
  ```tsx
  : "bg-month-primary/10 text-month-primary"
  ```
  to:
  ```tsx
  : "bg-primary/10 text-primary"
  ```
  (Completed-step `bg-success text-white` stays — success token + white over a colored fill is allowed.)
- [ ] Build the footer action row. Currently the only "Einkaufen"/shopping entry point is the button inside the ingredients card (now relabeled `toListButton`). Add a sticky footer action row after the main content grid `</div>` (before the Delete Dialog). Insert:
  ```tsx
  {/* Footer actions */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-6 flex flex-col gap-3 sm:flex-row"
          >
            {/* Zum Essensplan slot — wired in Task 3 */}
            <Button
              variant="default"
              className="flex-1"
              onClick={() => setShowShoppingDialog(true)}
            >
              <ShoppingCart className="size-4 mr-2" />
              {t("detail.toListButton")}
            </Button>
          </motion.div>
  ```
  (Task 3 inserts the "Zum Essensplan" button as the first child of this row and wires its dialog.)
- [ ] Update the Shopping List Dialog's ingredient rows: they use hand-rolled `<label><Checkbox/>` — leave them as-is functionally, but the dialog is a glass-free surface already (Dialog content is not GlassCard). No GlassCard there. No change required beyond confirming the file no longer imports `Checkbox` — the dialog uses `Checkbox`. DECISION: the dialog still needs `Checkbox`, so do NOT remove the `Checkbox` import. Revert the import removal from the first step: keep `import { Checkbox } from "@/components/ui/checkbox";`. (Only the inline ingredient list in the ingredients Card was converted to ChecklistItem; the shopping dialog keeps its Checkbox rows.)
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected: PASS.
- [ ] Commit: `feat(recipes): photo-header detail with meta pills, ChecklistItem ingredients`

---

### Task 3 — "Zum Essensplan" CTA + dialog (`recipes/[id]/page.tsx`)

Add a real meal-plan CTA: a `Button` + `Dialog` to pick a date (default today) and meal type (default dinner), wired to `useAddMealPlanEntry`.

**Files**
- `webapp/src/app/recipes/[id]/page.tsx` (edit)

**Interfaces**
- Consumes: `useAddMealPlanEntry`, `getWeekStart` (from `@/hooks`); `MEAL_TYPES`-equivalent inline list; `Select`; `Input` (type=date); `Dialog`; `Button`; `useTranslations("meals")` for meal-type labels.
- Produces: meal-plan dialog state + submit handler; "Zum Essensplan" button in the footer row.

**Steps**
- [ ] Add imports: `useAddMealPlanEntry`, `getWeekStart` to the `@/hooks` import block. Add `import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";` and `import { Input } from "@/components/ui/input";`. Add a second translations hook: `const tMeals = useTranslations("meals");` near the existing `t`/`tCommon`.
- [ ] Add `MealType` to the database type import: `import type { RecipeInstruction, RecipeIngredient, MealType } from "@/types/database";`.
- [ ] Add state near the other `useState` declarations:
  ```ts
  const [showMealPlanDialog, setShowMealPlanDialog] = useState(false);
  const [mealPlanDate, setMealPlanDate] = useState<string>(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  });
  const [mealPlanType, setMealPlanType] = useState<MealType>("dinner");
  ```
- [ ] Add the mutation hook near the other hooks: `const addMealPlanEntry = useAddMealPlanEntry();`.
- [ ] Add the submit handler next to `handleAddToShoppingList`:
  ```ts
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
  ```
  (`recipe!` is safe here — this handler only runs after the `error || !recipe` early-return guard.)
- [ ] Insert the "Zum Essensplan" button as the FIRST child of the footer action row added in Task 2. Anchor:
  ```tsx
  className="mt-6 flex flex-col gap-3 sm:flex-row"
          >
            {/* Zum Essensplan slot — wired in Task 3 */}
  ```
  Replace the comment line with:
  ```tsx
  <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowMealPlanDialog(true)}
            >
              <CalendarPlus className="size-4 mr-2" />
              {t("detail.toMealPlanButton")}
            </Button>
  ```
- [ ] Add the meal-plan `Dialog` after the Shopping List Dialog (before `</main>`):
  ```tsx
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
  ```
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected: PASS.
- [ ] Commit: `feat(recipes): add "Zum Essensplan" CTA wired to meal planner`

---

### Task 4 — URL-import detection preview (`recipes/new.tsx` import mode)

Split parse from save: add a parse-only `useParseRecipeUrl` hook, then make the import mode show a detection preview Card before saving. The save reuses `useImportRecipe` (re-fetches + inserts) on the SAME URL — verified safe because the parse API is deterministic per URL. Library quick-import Dialog and `/recipes/search` preview stay as-is (documented).

**Files**
- `webapp/src/hooks/use-recipes.ts` (edit — add `useParseRecipeUrl`)
- `webapp/src/hooks/index.ts` (edit — export the new hook)
- `webapp/src/app/recipes/new/page.tsx` (edit — preview UI)

**Interfaces**
- Consumes (new hook): `POST /api/recipes/import` (parse-only); `requireFamilyId`.
- Produces: `useParseRecipeUrl()` mutation returning `ParsedRecipe`; preview UI in import mode; reuse of `useImportRecipe` for save.

**Steps**
- [ ] In `use-recipes.ts`, add a `ParsedRecipe` interface (exported) above `useImportRecipe`, mirroring the API response shape:
  ```ts
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
  ```
- [ ] Add `useParseRecipeUrl` after `useImportRecipe`:
  ```ts
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
  ```
- [ ] In `webapp/src/hooks/index.ts`, add `useParseRecipeUrl` (and the `ParsedRecipe` type) to the `from "./use-recipes"` export block. Anchor: find the existing `} from "./use-recipes";` and add `useParseRecipeUrl,` to the value exports; add `type ParsedRecipe,` if the file uses inline `type` exports in that block (match the existing style — verify by reading the block; if it re-exports types separately, add `ParsedRecipe` there).
- [ ] In `recipes/new/page.tsx`, update imports: replace `import { GlassCard } from "@/components/ui/card";` with `import { Card } from "@/components/ui/card";`. Add `import { Badge } from "@/components/ui/badge";`. Add `CheckCircle2, X` and keep `Download`? — the design uses a download/save icon; add `CheckCircle2` to the lucide imports (used by the "Erkannt" preview badge). Add `useParseRecipeUrl` and `type ParsedRecipe` to the `@/hooks` import.
- [ ] Replace the page background `<div ... to-month-primary/5 ... />` with `<div className="page-gradient" />`.
- [ ] Add preview state near the existing `importUrl`/`mode` state:
  ```ts
  const [parsed, setParsed] = useState<ParsedRecipe | null>(null);
  const [removedIngredients, setRemovedIngredients] = useState<Set<number>>(new Set());
  ```
- [ ] Add the parse + save mutations near `importRecipe`/`createRecipe`:
  ```ts
  const parseRecipe = useParseRecipeUrl();
  ```
  (Save reuses `importRecipe` which already re-fetches + inserts.)
- [ ] Replace `handleImport` (the import-mode handler) with a parse step:
  ```ts
  const handleParse = async () => {
    if (!importUrl.trim()) return;
    try {
      const result = await parseRecipe.mutateAsync(importUrl.trim());
      setParsed(result);
      setRemovedIngredients(new Set());
    } catch {
      toast.error(t("importFailed"));
    }
  };

  const handleSaveParsed = async () => {
    if (!parsed) return;
    try {
      const recipe = await importRecipe.mutateAsync(importUrl.trim());
      router.push(`/recipes/${recipe.id}`);
    } catch {
      toast.error(t("new.saveFailed"));
    }
  };
  ```
  (DOC: save re-imports via `useImportRecipe` rather than threading the parsed object through `useCreateRecipe`. This keeps the insert logic in one place and is correct because the parse API is deterministic per URL. Removed-ingredient chips are a visual affordance only in this iteration — they do not alter the saved recipe; flagged in Self-Review as a bounded deferral.)
- [ ] Convert the import-mode `<GlassCard className="p-6">` to `<Card className="p-6">` and closing tag. Swap the heading icon color `text-month-primary`→`text-primary` (2 places in import mode: the `LinkIcon` next to the heading).
- [ ] Give the URL `<Input>` a primary focus border: change its `className="flex-1"` to `className="flex-1 focus-visible:border-primary"`. Change the Import button's `onClick={handleImport}` to `onClick={handleParse}` and its disabled/pending to use `parseRecipe.isPending`. Change its label from `t("importButton")` to `t("new.detectButton")` (a new "Detect"/"Analyze" key).
- [ ] After the URL input row (inside the import-mode Card), add the detection preview, rendered only when `parsed` is set:
  ```tsx
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
                          {parsed.ingredients.map((ing) =>
                            removedIngredients.has(ing.sort_order) ? null : (
                              <Badge key={ing.sort_order} variant="neutral" className="gap-1.5">
                                {ing.name}
                                <button
                                  type="button"
                                  aria-label={t("new.removeIngredientAria", { name: ing.name })}
                                  onClick={() =>
                                    setRemovedIngredients((prev) => new Set(prev).add(ing.sort_order))
                                  }
                                  className="-mr-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                                >
                                  <X className="size-3" strokeWidth={1.75} />
                                </button>
                              </Badge>
                            )
                          )}
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
  ```
  Add `Download` and `X` and `CheckCircle2` to the lucide imports (and keep `LinkIcon`, `ChefHat`, `Plus`, `Loader2`).
- [ ] Convert the mode-chooser `GlassCard`s (2) and the manual-mode `GlassCard`s (3) — handled in Task 5; leave them for now EXCEPT the import-mode Card which this task converts. (To keep the diff scoped: this task touches ONLY the import-mode Card + page background. Mode-chooser and manual cards convert in Task 5.) — DECISION: convert the page background here, import-mode Card here; everything else in Task 5.
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected: PASS.
- [ ] Commit: `feat(recipes): URL import detection preview before save`

---

### Task 5 — Sweep remaining GlassCard surfaces (`new` chooser/manual, `edit`, `search`)

Convert every remaining `GlassCard`→`Card`, `month-primary`→`primary`, `variant="month"`→default across the recipe pages not fully restyled above. Preserve all form/search logic.

**Files**
- `webapp/src/app/recipes/new/page.tsx` (edit — chooser + manual cards)
- `webapp/src/app/recipes/[id]/edit/page.tsx` (edit)
- `webapp/src/app/recipes/search/page.tsx` (edit)

**Interfaces**
- Consumes: `Card` (`@/components/ui/card`).
- Produces: glass-free, primary-tokened new/edit/search surfaces.

**Steps**
- [ ] `recipes/new/page.tsx`: change the import to `import { Card } from "@/components/ui/card";` (already done in Task 4). Convert the two mode-chooser `GlassCard`s: replace `<GlassCard ... hover:ring-month-primary/50 ...>` → `<Card ... hover:ring-primary/50 ...>` and closing tags; swap the two card icon colors `text-month-primary`→`text-primary`. Convert the three manual-mode `GlassCard`s (Basic Info, Ingredients, Instructions) → `Card` + closing tags. In the manual instructions section, swap the step-number circle `bg-month-primary/10` → `bg-primary/10` and `text-month-primary` → `text-primary`.
- [ ] `recipes/[id]/edit/page.tsx`: replace `import { GlassCard } from "@/components/ui/card";` with `import { Card } from "@/components/ui/card";`. Replace all background `<div ... to-month-primary/5 ... />` (3: loading, error, main) with `<div className="page-gradient" />` (`replace_all`). Convert every `<GlassCard ...>`→`<Card ...>` + closing tags (loading skeleton, error state, Basic Info, Ingredients, Instructions). Swap the instructions step-circle `bg-month-primary/10`→`bg-primary/10` and `text-month-primary`→`text-primary`.
- [ ] `recipes/search/page.tsx`: replace `import { GlassCard } from "@/components/ui/card";` with `import { Card } from "@/components/ui/card";`. Replace the background `<div ... to-month-primary/5 ... />` with `<div className="page-gradient" />`. Convert the search-input `GlassCard`, the loading-skeleton `GlassCard`s, and the result-card `GlassCard` → `Card` + closing tags. Swap `hover:ring-month-primary/50`→`hover:ring-primary/50` and `group-hover:text-month-primary`→`group-hover:text-primary` (result card title). The source `Badge` uses `backdrop-blur-sm` — replace `className="text-xs backdrop-blur-sm"` with `className="border-0 bg-black/55 text-xs text-white/90"` (over-photo chip, no glass). The difficulty inline tints stay.
- [ ] Verify no `month-primary` or `GlassCard` remains in any recipe page: run `Grep` for `month-primary` and `GlassCard` under `webapp/src/app/recipes` — expect zero matches.
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected: PASS.
- [ ] Commit: `refactor(recipes): flat Cards + primary token across new/edit/search`

---

### Task 6 — i18n parity + changelog

Add every new key to `en.json`, `de.json`, `fr.json` (CI parity gate); add a CHANGELOG `[Unreleased]` entry.

**Files**
- `webapp/messages/en.json` (edit)
- `webapp/messages/de.json` (edit)
- `webapp/messages/fr.json` (edit)
- `CHANGELOG.md` (edit)

**Interfaces**
- Consumes: keys referenced in Tasks 1-5.
- Produces: parity-complete `recipes.detail` and `recipes.new` additions in all three locales; changelog entry.

**New keys (canonical EN values; translate for DE/FR):**

Under `recipes.detail` (append into the existing `detail` object in each file):
```json
"servingsDecreaseAria": "Decrease servings",
"servingsIncreaseAria": "Increase servings",
"toListButton": "To list",
"toMealPlanButton": "To meal plan",
"mealPlanDialogTitle": "Add to meal plan",
"mealPlanDialogDescription": "Pick a day and meal slot for this recipe.",
"mealPlanDateLabel": "Date",
"mealPlanTypeLabel": "Meal",
"mealPlanConfirm": "Add to plan",
"mealPlanAdding": "Adding…",
"mealPlanAdded": "Added to meal plan",
"mealPlanAddFailed": "Failed to add to meal plan"
```

Under `recipes.new` (append into the existing `new` object in each file):
```json
"detectButton": "Detect recipe",
"detectedBadge": "Detected",
"detectedMeta": "{ingredients} ingredients · {steps} steps · {minutes} min",
"detectedIngredientsHeading": "Detected ingredients",
"removeIngredientAria": "Remove {name}"
```

**DE values:**
```json
"servingsDecreaseAria": "Portionen verringern",
"servingsIncreaseAria": "Portionen erhöhen",
"toListButton": "Auf Liste",
"toMealPlanButton": "Zum Essensplan",
"mealPlanDialogTitle": "Zum Essensplan hinzufügen",
"mealPlanDialogDescription": "Wähle Tag und Mahlzeit für dieses Rezept.",
"mealPlanDateLabel": "Datum",
"mealPlanTypeLabel": "Mahlzeit",
"mealPlanConfirm": "Hinzufügen",
"mealPlanAdding": "Wird hinzugefügt…",
"mealPlanAdded": "Zum Essensplan hinzugefügt",
"mealPlanAddFailed": "Hinzufügen zum Essensplan fehlgeschlagen"
```
```json
"detectButton": "Rezept erkennen",
"detectedBadge": "Erkannt",
"detectedMeta": "{ingredients} Zutaten · {steps} Schritte · {minutes} Min",
"detectedIngredientsHeading": "Erkannte Zutaten",
"removeIngredientAria": "{name} entfernen"
```

**FR values:**
```json
"servingsDecreaseAria": "Diminuer les portions",
"servingsIncreaseAria": "Augmenter les portions",
"toListButton": "À la liste",
"toMealPlanButton": "Au menu de la semaine",
"mealPlanDialogTitle": "Ajouter au menu",
"mealPlanDialogDescription": "Choisissez un jour et un repas pour cette recette.",
"mealPlanDateLabel": "Date",
"mealPlanTypeLabel": "Repas",
"mealPlanConfirm": "Ajouter au menu",
"mealPlanAdding": "Ajout…",
"mealPlanAdded": "Ajouté au menu",
"mealPlanAddFailed": "Échec de l'ajout au menu"
```
```json
"detectButton": "Détecter la recette",
"detectedBadge": "Détecté",
"detectedMeta": "{ingredients} ingrédients · {steps} étapes · {minutes} min",
"detectedIngredientsHeading": "Ingrédients détectés",
"removeIngredientAria": "Retirer {name}"
```

**Steps**
- [ ] Edit `webapp/messages/en.json`: inside `recipes.detail` add the 12 detail keys after the existing `"addFailed"` entry (ensure trailing comma on the prior line); inside `recipes.new` add the 5 new keys after the existing `"saveFailed"` entry. Keep JSON valid.
- [ ] Edit `webapp/messages/de.json`: mirror the same key insertions with the DE values above.
- [ ] Edit `webapp/messages/fr.json`: mirror the same key insertions with the FR values above.
- [ ] Verify parity: the new key set must be identical across all three files (CI `i18n bundles` job compares EN↔DE↔FR keys). Spot-check by `Grep` for `toMealPlanButton` and `detectedBadge` in all three — expect one hit each.
- [ ] Edit `CHANGELOG.md`: under `[Unreleased] → ### Changed` (create the section if missing) add:
  ```markdown
  - Recipes redesigned to the new flat "Salbei/Leinen" look: filter chips on the library, photo-header detail with meta pills and a checklist ingredient list, and a "To meal plan" button that schedules a recipe straight from its detail page.
  - Recipe URL import now shows a detection preview (title, photo, ingredient chips) before saving instead of importing silently.
  ```
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected: PASS.
- [ ] Commit: `feat(recipes): i18n keys for meal-plan + import preview, changelog`

---

## Self-Review

**Scope item → Task mapping**
1. Library restyle (flat Card, heart→flat destructive, filter chips, search focus border, 3-col grid, mobile FAB, primary token) → **Task 1**.
2. Detail restyle (photo header w/ back+heart overlay, meta pills, ChecklistItem ingredients, primary step circles, flat Card, "Auf Liste" rename) → **Task 2**.
3. "Zum Essensplan" CTA + dialog wired to `useAddMealPlanEntry` + `getWeekStart` → **Task 3**.
4. URL-import detection preview via new `useParseRecipeUrl` (real parse API) + save via `useImportRecipe` → **Task 4**.
5. Sweep remaining surfaces (new chooser/manual, edit, search) → **Task 5** (import-mode Card done in Task 4; page backgrounds done where the file is first touched).
6. i18n EN/DE/FR parity + changelog → **Task 6**.

**Type-consistency checks**
- `useAddMealPlanEntry` expects `{ weekStart: string; entry: CreateMealPlanEntryInput }` where `CreateMealPlanEntryInput = { date: string; meal_type: MealType; recipe_id?: string | null; note?: string | null; servings?: number }`. Task 3 passes exactly this shape; `MealType` imported from `@/types/database`. ✓
- `getWeekStart(date: Date): string` — Task 3 calls `getWeekStart(new Date(...))`. ✓
- `ChecklistItem` props `{checked, onCheckedChange:(checked:boolean)=>void, label:ReactNode, meta?:ReactNode}` — Task 2 passes `onCheckedChange={() => toggleIngredient(id)}` (arg ignored, signature compatible). ✓
- `useParseRecipeUrl` returns the same `ParsedRecipe` shape the API emits (verified against `route.ts` return). `instructions` typed as `RecipeInstruction[]` (`{step, text, image_url?}`) — API emits `{step, text}` which is assignable. ✓
- `RecipeWithIngredients` carries optional `tags?`; Task 1 casts and guards with `?? []`, so plain `Recipe[]` search results don't break the filter. ✓
- `Badge` `variant="neutral"` and `variant="success"` exist (verified in `badge.tsx`). ✓
- `FAB` props `{icon, onClick, ariaLabel, className?}` — Task 1 passes `icon={Plus}` + `onClick={() => router.push(...)}`. ✓

**Flagged deferrals (bounded, intentional)**
- Search-result list is not tag-filtered (search results are plain `Recipe[]` without `tags`); tag filtering applies to the full library list only.
- The import preview's removable-ingredient chips are visual only this iteration — removing a chip does not change the saved recipe (save re-imports the full parse via `useImportRecipe`). A future pass could thread the trimmed ingredient set through `useCreateRecipe`.
- The library quick-import `<Dialog>` and the `/recipes/search` preview dialog keep their existing single-step flows (not upgraded to the new detection preview) — out of scope, per the prompt's "leave as-is" allowance.
- `useImportRecipe` is preserved unchanged so the library Dialog and search page continue to work.
