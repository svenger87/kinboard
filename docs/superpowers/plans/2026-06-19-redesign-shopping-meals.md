# Plan 5 — Redesign: Shopping + Meal Plan (Salbei/Leinen)

For agentic workers: use superpowers:subagent-driven-development

## Goal
Bring `/shopping`, `/einkaufen` (kiosk), and `/meals` onto the shipped "Salbei/Leinen"
Foundation. Remove all glass/backdrop-blur from these app surfaces, swap `month-primary`
tokens for `primary`, adopt the shipped `ChecklistItem` for shopping rows, flatten the meal
board and `MealEntryCard`, add a voice (Web Speech) add affordance + mobile `FAB` to
shopping, restyle the offline indicator to the mockup's flat warning pill, and fix two
i18n bugs in the meal planner (`formatDate` hardcoded `de-DE`; a hardcoded German
`toast.error`). No new data model — visual layer + small a11y/i18n fixes only.

## Architecture
- **Reuse, don't rebuild.** `ChecklistItem`, `FAB`, `PersonAvatar`, `Card`/`CardContent`,
  `Badge`, `Checkbox`, `getDateFnsLocale` are all shipped on this branch (Foundation +
  Plans 2–4). This plan adopts them; it adds no new shared components.
- **Three surfaces, each edited in place.** The two page files (`shopping/page.tsx`,
  `meals/page.tsx`) are ~1300 and ~1780 lines. Edits are **localized replacement blocks**
  anchored to real text quoted below — never whole-file rewrites. `einkaufen/page.tsx` and
  `offline-banner.tsx` are smaller and get token/structure edits in place.
- **Tokens.** `month-primary` → `primary` everywhere on these three pages. Functional
  colors that encode data — shopping category colors (`CATEGORIES[x].color`) and meal-type
  accents — stay as inline `style={{}}` hex and are documented as intentional. Never
  hardcode the accent hex; never `text-white` on a primary surface (use
  `text-primary-foreground`).
- **Offline.** `OfflineBanner`/`OfflineIndicator` keep their existing state machine
  (`useOfflineQueueStatus`); only their markup/classes change to the flat warning pill.
  Per-item "syncing" ring uses `item._syncStatus !== "synced"` from `OfflineShoppingItem`.
- **Voice.** Web Speech API is feature-detected at runtime; the mic button only renders when
  `SpeechRecognition`/`webkitSpeechRecognition` exists. A minimal local TypeScript interface
  declares the shape — no `any`, no new dependency, graceful when unsupported.

## Tech Stack
Next.js 16 App Router · React 19 · Tailwind · shadcn/ui · framer-motion · next-intl
(EN+DE+FR parity is a CI gate) · date-fns · dnd-kit (meal board) · Web Speech API
(browser-native, feature-detected).

## Global Constraints
- No `next build` locally. Per-task gate: `cd webapp && npm run lint` and `npx tsc --noEmit`. No unit tests — verification = lint+tsc+structural self-review; live visual smoke deferred to the user. Do NOT write Jest/RTL/TDD steps.
- Reuse Foundation + Plan 2-4 components; never hardcode accent hex (primary/tints; functional category/meal colors may stay as inline styles, documented); `text-primary-foreground` not literal `text-white` on month/primary surfaces.
- NO glass/backdrop-blur on app surfaces (this plan REMOVES it from shopping/einkaufen/meals).
- Touch targets ≥44px (kiosk ≥56-64). Lucide stroke 1.75. Quantities/times `tabular-nums`/`font-mono`.
- Motion 120/220/320ms; respect `prefers-reduced-motion`; sparse on kiosk.
- next-intl EN/DE/FR parity (CI gate) — every new key in all three; the Web Speech voice feature degrades gracefully (hidden when unsupported), no console errors on unsupported browsers.
- Commits: Conventional Commits, NO `Co-Authored-By: Claude` trailer. One commit per task.

### Grounding facts (verified against the real files — do not re-derive)
- `ChecklistItem` props: `{ checked, onCheckedChange, label, meta?, color?, className? }`. The
  row is `min-h-[52px] … rounded-xl border bg-card px-4 elev-sm`, `checked` ⇒ `opacity-55` +
  the label gets `line-through`. The Foundation `Checkbox` renders the filled primary check
  when `checked`. So done-item styling (opacity, strikethrough, filled primary check) is
  **entirely handled by `ChecklistItem` + `Checkbox`** — do not re-implement it.
- `FAB` props: `{ icon, onClick, ariaLabel, className? }`. Fixed, `bg-primary`, `.fab-above-nav`.
- `PersonAvatar` props: `{ name, color, avatarUrl?, size?, ring?, className? }`. Use `size={24}`.
- `usePeople()` → `useQuery` returning `Person[]`; `Person = { id, name, color, avatar_url, is_child, family_id, created_at }`.
- `ShoppingItem.added_by: string | null`. It is **never currently populated from a person id**
  in the UI (no insert path sets it). Treat it as an optional person-id lookup: render the
  badge **only** when `added_by` resolves to a real `Person`. Otherwise render nothing.
- `useOfflineShopping()` returns `{ items, isLoading, error, isOnline, isSyncing, isFromCache,
  hasPendingSync, pendingCount, failedCount, createItem, updateItem, deleteItem, toggleItem,
  refetch, syncNow }`. `items` are `OfflineShoppingItem` = `ShoppingItem & { _syncStatus:
  "synced"|"pending"|"error"; _isLocal?: boolean }`.
- `OfflineBanner` / `OfflineIndicator` read `useOfflineQueueStatus()` → `{ isOnline,
  pendingCount, failedCount, hasPending }`. i18n namespace `components.offline`.
- `.page-gradient` is the shipped flat-gradient background div (used on calendar:
  `<div className="page-gradient" />`). It replaces the inline
  `bg-gradient-to-b from-background via-background to-month-primary/5` divs.
- `formatDate(dateStr)` in `use-meal-planner.ts` hardcodes `"de-DE"` (line ~45). `getWeekStart`,
  `getWeekDates`, `MEAL_TYPES` live in the same file.
- i18n: `shopping` (en.json ~701), `shoppingCategories` (~224), `einkaufen` (~2981), `meals`
  (~482), `mealHints`, `common`, `components.offline` (~29). `meals.moveFailed` already exists.
- Functional meal-type accent: there is no existing meal-type color map; the redesign keeps
  meal rows neutral (`text-muted-foreground` icons) — do NOT invent per-meal hex.

---

### Task 1 — Shopping: flat surfaces, tokens, category dot header

**Files**
- `webapp/src/app/shopping/page.tsx` (edit)

**Interfaces**
- Consumes: `Card`, `CardContent` from `@/components/ui/card`; existing `CATEGORIES`, `Badge`.
- Produces: shopping page with no `GlassCard`, no `month-primary`, `.page-gradient` background,
  category headers as a functional-color dot + mono label + count Badge. (Item rows are
  still the existing `motion.div` rows — Task 2 converts them; this task only touches
  containers, tokens, background, and the category header.)

**Steps**
- [ ] Replace the `GlassCard` import. Change line 25
  `import { GlassCard } from "@/components/ui/card";`
  to:
  ```ts
  import { Card, CardContent } from "@/components/ui/card";
  ```
- [ ] Replace the three background gradient divs. There are **three** identical lines (loading
  state ~550, error state ~588, main return ~616):
  `<div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none" />`
  Replace **each** with:
  ```tsx
  <div className="page-gradient" />
  ```
- [ ] Loading-state skeleton cards. Replace the add-form skeleton block (lines ~559-565):
  ```tsx
            <GlassCard className="p-4 mb-6">
              <div className="flex gap-3">
                <Skeleton className="h-10 flex-1" />
                <Skeleton className="h-10 w-24" />
                <Skeleton className="size-10" />
              </div>
            </GlassCard>
  ```
  with:
  ```tsx
            <Card className="mb-6">
              <CardContent className="p-4">
                <div className="flex gap-3">
                  <Skeleton className="h-10 flex-1" />
                  <Skeleton className="h-10 w-24" />
                  <Skeleton className="size-10" />
                </div>
              </CardContent>
            </Card>
  ```
- [ ] Loading-state category skeletons. Replace (lines ~567-575):
  ```tsx
              {[1, 2, 3].map((i) => (
                <GlassCard key={i} className="p-4">
                  <Skeleton className="h-5 w-32 mb-3" />
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                </GlassCard>
              ))}
  ```
  with:
  ```tsx
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
  ```
- [ ] Error-state card. Replace (lines ~596-605):
  ```tsx
            <GlassCard className="p-8 text-center">
              <ShoppingCart className="size-12 mx-auto mb-3 text-destructive opacity-50" />
              <p className="text-destructive font-medium">{t("errorTitle")}</p>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                {t("errorMessage")}
              </p>
              <Button variant="outline" onClick={() => refetch()}>
                {t("errorRetry")}
              </Button>
            </GlassCard>
  ```
  with:
  ```tsx
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
  ```
- [ ] Add-form card. Replace the opening `<GlassCard className="p-4">` (line ~684) with
  `<Card><CardContent className="p-4">` and its matching closing `</GlassCard>` (line ~874)
  with `</CardContent></Card>`. (The inner two-row form markup stays unchanged in this task;
  the `variant="month"` Add button and the suggestion-dropdown `month-primary` classes are
  retokenized in Task 3, which owns the add row.)
- [ ] Category group container + header. Replace the `GlassCard` block (lines ~946-967):
  ```tsx
                          <GlassCard
                            className={`p-4 transition-opacity ${
                              allChecked ? "opacity-50" : ""
                            }`}
                          >
                            {/* Category Header */}
                            <div className="flex items-center gap-2 mb-3">
                              <div
                                className="p-1.5 rounded-lg"
                                style={{ backgroundColor: `${category.color}20` }}
                              >
                                <Icon
                                  className="size-4"
                                  style={{ color: category.color }}
                                />
                              </div>
                              <h3 className="font-medium">{tCategories(category.labelKey)}</h3>
                              <Badge variant="outline" className="ml-auto">
                                {categoryItems.filter((i) => !i.checked).length}/
                                {categoryItems.length}
                              </Badge>
                            </div>
  ```
  with (dot + mono label per mockup; `Icon` is no longer rendered in the header — keep it
  imported, it is still used by the add-form/edit `Select`s and suggestion dropdown):
  ```tsx
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
  ```
  Then replace the matching closing `</GlassCard>` for this block (line ~1184) with:
  ```tsx
                            </CardContent>
                          </Card>
  ```
  Note: `Icon` (from `const Icon = category.icon;` at line ~935) stays declared — it is now
  unused in the header. To avoid an unused-var lint error, change line ~935 from
  `const Icon = category.icon;` to delete that line (the `category` const at ~933 is still
  used). Verify no other reference to `Icon` inside this `.map` exists (there is none).
- [ ] Image-search dialog hover border. In the Dialog results grid (line ~1276) replace
  `hover:border-month-primary` and `focus:border-month-primary` with `hover:border-primary`
  and `focus:border-primary` respectively:
  ```tsx
                    className="relative aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-primary transition-colors focus:outline-none focus:border-primary bg-muted/20"
  ```
- [ ] `cd webapp && npm run lint && npx tsc --noEmit`  (Expected: PASS)
- [ ] Commit:
  ```
  feat(shopping): flatten surfaces to Salbei foundation + dot category headers
  ```

---

### Task 2 — Shopping: item rows → ChecklistItem (+ optional person badge)

**Files**
- `webapp/src/app/shopping/page.tsx` (edit)

**Interfaces**
- Consumes: `ChecklistItem` from `@/components/ui/../checklist-item`; `PersonAvatar`;
  `usePeople()`; existing `formatQuantity`, `handleToggleItem`, `handleDeleteItem`,
  `handleUpdateItemQuantity`, edit `Popover`, image button.
- Produces: each item row built around `ChecklistItem` (check + label + meta), with the
  existing image button, qty stepper, and edit Popover preserved beside it inside a thin
  wrapper. Done items use `ChecklistItem`'s built-in `checked` styling. Person badge renders
  only when `added_by` resolves to a `Person`.

**Steps**
- [ ] Add imports. After the existing component imports (after line ~73
  `import { CATEGORIES, detectCategory } from "@/lib/shopping-categories";`) add:
  ```ts
  import { ChecklistItem } from "@/components/checklist-item";
  import { PersonAvatar } from "@/components/person-avatar";
  ```
  And in the hooks barrel import block (lines 57-67) the page already imports from
  `@/hooks`; add `usePeople` is exported from `@/hooks` (it re-exports use-supabase-queries).
  Verify `usePeople` is exported by `@/hooks`; if it is, add it to that destructured import
  list. If `@/hooks` does **not** re-export it, import directly:
  ```ts
  import { usePeople } from "@/hooks/use-supabase-queries";
  ```
  (Pick whichever resolves — `tsc` will tell you. Prefer the barrel if available.)
- [ ] Resolve people in the component body. After the `useOfflineShopping()` destructure
  (after line ~115) add:
  ```ts
  const { data: people = [] } = usePeople();
  const personById = (id: string | null | undefined) =>
    id ? people.find((p) => p.id === id) ?? null : null;
  ```
- [ ] Replace the entire item row `motion.div` (lines ~975-1180, the block starting
  `<motion.div key={item.id} layout …` and ending at its closing `</motion.div>` just before
  the `))}` of the `.map`). Replace with a wrapper that uses `ChecklistItem` for the
  check+label+meta and keeps the image button, qty stepper, and edit Popover beside it.
  New block:
  ```tsx
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
  ```
  Notes baked into the block: the old circular `<button>` check is gone (ChecklistItem owns
  it); the old name/qty/notes `div` is gone (now `label`/`meta`); the edit-popover save
  button changed from `variant="month"` to default (Foundation default = month accent); the
  `recipe` badge moved to `variant="neutral"`. The `item.notes` line that used to appear in
  the meta is **dropped from the row** (it is still editable in the Popover and was secondary
  per the mockup, which shows only qty + person badge). This is an intentional simplification
  — flag it in Self-Review.
- [ ] Confirm no now-unused imports remain. After this edit, still-used: `Minus`, `Plus`,
  `MoreVertical`, `Tag`, `Pencil`, `Check`, `Trash2`, `Search`, `ChefHat`, `Tooltip*`,
  `Popover*`, `Select*`, `Input`, `Badge`, `Separator`. `ImageIcon` is still used in the
  image dialog empty state. `Package` is still used in the suggestions dropdown. No import
  removals expected — let `tsc`/lint confirm.
- [ ] `cd webapp && npm run lint && npx tsc --noEmit`  (Expected: PASS)
- [ ] Commit:
  ```
  feat(shopping): adopt ChecklistItem rows with quantity + person badge
  ```

---

### Task 3 — Shopping: voice add button, mobile FAB, offline pill, add-row tokens

**Files**
- `webapp/src/app/shopping/page.tsx` (edit)
- `webapp/src/components/offline-banner.tsx` (edit)
- `webapp/messages/en.json`, `webapp/messages/de.json`, `webapp/messages/fr.json` (edit)

**Interfaces**
- Consumes: `FAB`; Web Speech API (feature-detected); `OfflineIndicator` (already imports
  `useOfflineQueueStatus`); `useLocale` from next-intl.
- Produces: a mic button beside the add input (only when supported), a mobile-only FAB that
  focuses the add input, an offline indicator restyled to the flat warning pill, and add-row
  `month-primary` tokens retokenized to `primary`.

**Steps**
- [ ] Restyle `OfflineIndicator` to the flat warning pill (this is what the desktop topbar
  shows; `/einkaufen` uses it in its header). In `offline-banner.tsx` replace the
  `OfflineIndicator` body (lines ~117-138, the returned JSX) with:
  ```tsx
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {!isOnline && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/14 px-3 py-1 text-xs font-semibold text-warning">
          <WifiOff className="size-3.5" strokeWidth={1.75} />
          {pendingCount > 0
            ? t("offlinePill", { count: pendingCount })
            : t("indicatorOffline")}
        </span>
      )}
      {isOnline && pendingCount > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-info/14 px-3 py-1 text-xs font-semibold text-info">
          <Loader2 className="size-3 animate-spin" />
          {pendingCount}
        </span>
      )}
      {failedCount > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/14 px-3 py-1 text-xs font-semibold text-destructive">
          <AlertCircle className="size-3" />
          {failedCount}
        </span>
      )}
    </div>
  );
  ```
  (`text-warning`/`bg-warning` already exist in the token system; the original used them.)
  Leave `OfflineBanner` and `SyncStatusIcon` unchanged — `OfflineBanner` is the mobile
  full-width banner per the mockup and is already warning-tinted.
- [ ] Render the offline pill on the desktop shopping topbar. In `shopping/page.tsx` import
  `OfflineIndicator` alongside the existing `OfflineBanner` import (line 70):
  ```ts
  import { OfflineBanner, OfflineIndicator } from "@/components/offline-banner";
  ```
  Then in the `PageHeader actions` (the `<>` at line ~636), add as the first child, before
  the `showChecked` toggle Button:
  ```tsx
                <OfflineIndicator className="mr-1" />
  ```
- [ ] Add Web Speech support. Near the top of `shopping/page.tsx`, after the imports, add a
  minimal type + helper (module scope, above `const UNITS`):
  ```ts
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
  ```
- [ ] Add `useLocale` to the next-intl import. Change line 7
  `import { useTranslations } from "next-intl";`
  to:
  ```ts
  import { useTranslations, useLocale } from "next-intl";
  ```
  And add `Mic` to the lucide import block (lines 8-24):
  ```ts
    Mic,
  ```
- [ ] Add voice state + handler in the component body, after the `personById` helper from
  Task 2 (or after the `useOfflineShopping` destructure if Task 2's lines are nearby):
  ```ts
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
  ```
- [ ] Add the Mic button + retokenize the Add button in the main input row. Replace the
  add `<Button variant="month" …>` block (lines ~805-815):
  ```tsx
                  <Button
                    variant="month"
                    onClick={handleAddItem}
                    disabled={!inputValue.trim() || createItem.isPending}
                  >
                    {createItem.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                  </Button>
  ```
  with:
  ```tsx
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
  ```
- [ ] Retokenize the suggestions dropdown `month-primary` classes (lines ~752-794). Replace
  the four occurrences inside the suggestion `button`:
  - `isQuickAdd ? "bg-month-primary/5" : ""` → `isQuickAdd ? "bg-primary/5" : ""`
  - `bg-month-primary/20` → `bg-primary/10`
  - `<Plus className="size-4 text-month-primary" />` → `text-primary`
  - `className={\`font-medium truncate ${isQuickAdd ? "text-month-primary" : ""}\`}` →
    `${isQuickAdd ? "text-primary" : ""}`
  Use Grep to find the exact lines and edit each; they are all within the dropdown `.map`.
- [ ] Retokenize the progress bar (lines ~1206-1212). It uses `bg-success` which is a status
  token, not month-primary — **leave it as `bg-success`** (the mockup's progress reads as a
  completion bar; success is correct). No change needed here; noted to avoid accidental edits.
- [ ] Add the mobile FAB. Import `FAB`:
  ```ts
  import { FAB } from "@/components/fab";
  ```
  Then add it just before the closing `</main>` (after the progress-indicator block, ~line
  1216, before `</main>`):
  ```tsx
          <FAB
            icon={Plus}
            ariaLabel={t("emptyAction")}
            onClick={() => inputRef.current?.focus()}
            className="md:hidden"
          />
  ```
- [ ] Add i18n keys. In `webapp/messages/en.json` under the `"shopping"` object add:
  ```json
      "voiceStart": "Add by voice",
      "voiceStop": "Stop listening",
  ```
  (insert after `"connectBring"` for tidiness; trailing commas must stay valid JSON).
  In the `"components"."offline"` object add:
  ```json
      "offlinePill": "Offline · {count} in queue",
  ```
  Repeat the three additions in `de.json`:
  ```json
      "voiceStart": "Per Sprache hinzufügen",
      "voiceStop": "Aufnahme stoppen",
  ```
  and offline:
  ```json
      "offlinePill": "Offline · {count} in Warteschlange",
  ```
  And in `fr.json`:
  ```json
      "voiceStart": "Ajouter à la voix",
      "voiceStop": "Arrêter l'écoute",
  ```
  and offline:
  ```json
      "offlinePill": "Hors ligne · {count} en file",
  ```
- [ ] `cd webapp && npm run lint && npx tsc --noEmit`  (Expected: PASS)
- [ ] Commit:
  ```
  feat(shopping): voice add, mobile FAB, flat offline pill
  ```

---

### Task 4 — Einkaufen kiosk: flatten header/bar, primary checks

**Files**
- `webapp/src/app/einkaufen/page.tsx` (edit)

**Interfaces**
- Consumes: existing structure (wake-lock, pull-to-refresh, haptics, collapsible categories).
- Produces: flat `bg-card border` header + bottom bar (no `backdrop-blur`), `month-primary`
  → `primary`, big circle checks filled `bg-primary` when checked.

**Steps**
- [ ] Loading skeleton header. Replace the `<header …>` opening (line ~309):
  ```tsx
        <header className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur border-b border-border/50 safe-area-top">
  ```
  with:
  ```tsx
        <header className="fixed top-0 left-0 right-0 z-50 bg-card border-b border-border safe-area-top">
  ```
- [ ] Loading skeleton bottom bar. Replace (line ~351):
  ```tsx
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur border-t border-border/50 p-4 safe-area-bottom">
  ```
  with:
  ```tsx
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border p-4 safe-area-bottom">
  ```
- [ ] Main header. Replace (line ~375):
  ```tsx
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur border-b border-border/50 safe-area-top">
  ```
  with:
  ```tsx
      <header className="fixed top-0 left-0 right-0 z-50 bg-card border-b border-border safe-area-top">
  ```
- [ ] Header icon tile. Replace (lines ~378-380):
  ```tsx
            <div className="p-2 rounded-xl bg-month-primary/20">
              <ShoppingCart className="size-5 text-month-primary" />
            </div>
  ```
  with:
  ```tsx
            <div className="p-2 rounded-xl bg-primary/10">
              <ShoppingCart className="size-5 text-primary" />
            </div>
  ```
- [ ] Progress bar (header). Replace (lines ~407-408):
  ```tsx
          <motion.div
            className={`h-full ${progress === 100 ? "bg-success shadow-[0_0_8px_hsl(var(--success)/0.6)]" : "bg-month-primary"}`}
  ```
  with:
  ```tsx
          <motion.div
            className={`h-full ${progress === 100 ? "bg-success shadow-[0_0_8px_hsl(var(--success)/0.6)]" : "bg-primary"}`}
  ```
- [ ] Pull-to-refresh icon color. Replace (line ~427):
  ```tsx
          <RefreshCw
            className="size-5 text-month-primary"
  ```
  with `text-primary`.
- [ ] Unchecked big-circle check button. Replace (lines ~525-531):
  ```tsx
                                <button
                                  onClick={() => handleToggleItem(item.id)}
                                  aria-label={t("checkAria", { name: item.name })}
                                  className="shrink-0 size-12 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center active:bg-month-primary/20 active:border-month-primary transition-colors"
                                >
                                  <div className="size-6 rounded-full border-2 border-current" />
                                </button>
  ```
  with:
  ```tsx
                                <button
                                  onClick={() => handleToggleItem(item.id)}
                                  aria-label={t("checkAria", { name: item.name })}
                                  className="shrink-0 size-12 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center active:bg-primary/15 active:border-primary transition-colors"
                                >
                                  <div className="size-6 rounded-full border-2 border-current" />
                                </button>
  ```
- [ ] Checked-section header icon + count badge. Replace (lines ~612-619):
  ```tsx
                      <div className="p-2 rounded-xl bg-month-primary/20">
                        <Check className="size-5 text-month-primary" />
                      </div>
                      <span className="font-medium flex-1 text-left">
                        {t("doneSection")}
                      </span>
                      <Badge variant="outline" className="mr-2 bg-month-primary/10">
                        {checkedCount}
                      </Badge>
  ```
  with:
  ```tsx
                      <div className="p-2 rounded-xl bg-primary/10">
                        <Check className="size-5 text-primary" />
                      </div>
                      <span className="font-medium flex-1 text-left">
                        {t("doneSection")}
                      </span>
                      <Badge variant="neutral" className="mr-2 bg-primary/10">
                        {checkedCount}
                      </Badge>
  ```
- [ ] Checked-item filled circle. Replace (lines ~657-663):
  ```tsx
                              <button
                                onClick={() => handleToggleItem(item.id)}
                                aria-label={t("uncheckAria", { name: item.name })}
                                className="shrink-0 size-12 rounded-full bg-month-primary flex items-center justify-center"
                              >
                                <Check className="size-6 text-primary-foreground" />
                              </button>
  ```
  with:
  ```tsx
                              <button
                                onClick={() => handleToggleItem(item.id)}
                                aria-label={t("uncheckAria", { name: item.name })}
                                className="shrink-0 size-12 rounded-full bg-primary flex items-center justify-center"
                              >
                                <Check className="size-6 text-primary-foreground" />
                              </button>
  ```
- [ ] Bottom input bar. Replace (line ~692):
  ```tsx
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur border-t border-border/50 p-4 safe-area-bottom">
  ```
  with:
  ```tsx
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border p-4 safe-area-bottom">
  ```
- [ ] Bottom-bar Add button. Replace (lines ~713-714):
  ```tsx
          <Button
            variant="month"
            size="icon"
  ```
  with (default variant = month accent on this branch):
  ```tsx
          <Button
            size="icon"
  ```
- [ ] Suggestions dropdown tokens (lines ~752-780): replace the three `month-primary`
  occurrences in the kiosk dropdown (`bg-month-primary/20`, `text-month-primary` on the Plus,
  and `text-month-primary` on the quick-add label) with `bg-primary/10` / `text-primary` /
  `text-primary` respectively, mirroring Task 3's dropdown retokenization.
- [ ] `cd webapp && npm run lint && npx tsc --noEmit`  (Expected: PASS)
- [ ] Commit:
  ```
  feat(einkaufen): flat kiosk header/bar + primary checks
  ```

---

### Task 5 — Meals: i18n fixes (formatDate locale + hardcoded toast)

**Files**
- `webapp/src/hooks/use-meal-planner.ts` (edit)
- `webapp/src/app/meals/page.tsx` (edit)

**Interfaces**
- Consumes: `getDateFnsLocale` (or `Intl.DateTimeFormat` with the intl locale); existing
  `t("moveFailed")`.
- Produces: `formatDate` accepts a locale; the meals page threads its `intlLocale`;
  the drag-end hardcoded German toast becomes `t("moveFailed")`.

**Steps**
- [ ] Change `formatDate` to accept a locale. In `use-meal-planner.ts` replace (lines ~42-50):
  ```ts
  export function formatDate(dateStr: string): string {
    // Parse as local date (add T12:00 to avoid timezone edge cases)
    const date = new Date(dateStr + "T12:00:00");
    return date.toLocaleDateString("de-DE", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }
  ```
  with:
  ```ts
  export function formatDate(dateStr: string, locale: string = "de-DE"): string {
    // Parse as local date (add T12:00 to avoid timezone edge cases)
    const date = new Date(dateStr + "T12:00:00");
    return date.toLocaleDateString(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }
  ```
  (Default keeps existing call sites working; we thread the real locale from the page.)
- [ ] Thread `intlLocale` at every `formatDate(...)` call in `meals/page.tsx`. There are
  these call sites — add `, intlLocale` as the second arg to each. Grep
  `formatDate(` in the file; the occurrences are:
  - grid header day cell: `<div className="text-sm">{formatDate(date)}</div>`
    → `{formatDate(date, intlLocale)}`
  - add dialog description: `{formatDate(selectedSlot.date)}` → `{formatDate(selectedSlot.date, intlLocale)}`
  - shopping dialog list: `{formatDate(entry.date)}` → `{formatDate(entry.date, intlLocale)}`
  - detail dialog: `{formatDate(detailEntry.date)}` → `{formatDate(detailEntry.date, intlLocale)}`
  `intlLocale` is already computed at line ~431 (`const intlLocale = getIntlLocale(locale);`).
- [ ] Fix the hardcoded German toast. In `meals/page.tsx` replace (line ~781):
  ```ts
      toast.error("Mahlzeit konnte nicht verschoben werden");
  ```
  with:
  ```ts
      toast.error(t("moveFailed"));
  ```
- [ ] `cd webapp && npm run lint && npx tsc --noEmit`  (Expected: PASS)
- [ ] Commit:
  ```
  fix(meals): localize formatDate + drag-move failure toast
  ```

---

### Task 6 — Meals: flat board, slots, MealEntryCard, tokens, topbar CTA

**Files**
- `webapp/src/app/meals/page.tsx` (edit)

**Interfaces**
- Consumes: `Card`, `CardContent`; existing DnD wiring; `MealSlot`, `MealEntryCard`.
- Produces: `.page-gradient` background; week-nav + board + entry cards as flat `Card`s;
  `month-primary` → `primary` (today highlight, drop targets, icon tiles, empty-state);
  `bg-white/[0.0x]` → `bg-muted/30` / `bg-accent/40`; topbar "Shopping" button restyled to
  the primary "Auf Liste" CTA; "Recipes" kept; DnD/dropdown logic untouched.

**Steps**
- [ ] Swap the import. Replace line 55
  `import { GlassCard } from "@/components/ui/card";`
  with:
  ```ts
  import { Card, CardContent } from "@/components/ui/card";
  ```
- [ ] `MealSlot` container tokens. Replace (lines ~155-176):
  ```tsx
    return (
      <div
        ref={setNodeRef}
        className={`min-h-[90px] min-w-0 p-2 rounded-lg border transition-colors ${
          isOver
            ? "bg-month-primary/20 border-month-primary border-solid"
            : slotEntries.length === 0
            ? "border-dashed border-border/30 hover:border-month-primary/40 hover:bg-white/[0.02]"
            : "border-solid border-border/50 bg-white/[0.02]"
        }`}
      >
        {slotEntries.length === 0 ? (
          <button
            onClick={onAddClick}
            aria-label={hint ? t("addHintAria", { hint }) : t("emptyAction")}
            className="size-full min-h-[60px] flex flex-col items-center justify-center gap-1.5 text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-month-primary/5 active:bg-month-primary/10 transition-all duration-200 group rounded-md"
          >
            <div className="flex items-center gap-1.5">
              <MealIcon className="size-3.5" />
              <Plus className="size-3.5 text-month-primary/50 group-hover:text-month-primary/70" />
            </div>
            {hint && <span className="text-[11px]">{hint}?</span>}
          </button>
  ```
  with:
  ```tsx
    return (
      <div
        ref={setNodeRef}
        className={`min-h-[90px] min-w-0 p-2 rounded-lg border transition-colors ${
          isOver
            ? "bg-primary/15 border-primary border-solid"
            : slotEntries.length === 0
            ? "border-dashed border-border/40 hover:border-primary/40 hover:bg-accent/40"
            : "border-solid border-border bg-muted/30"
        }`}
      >
        {slotEntries.length === 0 ? (
          <button
            onClick={onAddClick}
            aria-label={hint ? t("addHintAria", { hint }) : t("emptyAction")}
            className="size-full min-h-[60px] flex flex-col items-center justify-center gap-1.5 text-muted-foreground/50 hover:text-muted-foreground hover:bg-primary/5 active:bg-primary/10 transition-all duration-200 group rounded-md"
          >
            <div className="flex items-center gap-1.5">
              <MealIcon className="size-3.5" />
              <Plus className="size-3.5 text-primary/60 group-hover:text-primary" />
            </div>
            {hint && <span className="text-[11px]">{hint}?</span>}
          </button>
  ```
- [ ] `MealEntryCard` shell. Replace (lines ~269 the opening and ~373 the closing):
  opening `<GlassCard className="p-2 cursor-pointer hover:ring-1 hover:ring-month-primary/50 transition-all">`
  →
  ```tsx
        <Card className="cursor-pointer hover:ring-1 hover:ring-primary/50 transition-all">
          <CardContent className="p-2">
  ```
  and closing `</GlassCard>` →
  ```tsx
          </CardContent>
        </Card>
  ```
- [ ] Background gradient. Replace (line ~797):
  ```tsx
        <div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none" />
  ```
  with:
  ```tsx
        <div className="page-gradient" />
  ```
- [ ] Topbar "Shopping" CTA → primary "Auf Liste". Replace (lines ~826-833):
  ```tsx
                <Button
                  variant="outline"
                  onClick={() => setShowShoppingDialog(true)}
                  disabled={entriesWithRecipes.length === 0}
                >
                  <ShoppingCart className="size-4 mr-2" />
                  {t("shoppingButton")}
                </Button>
  ```
  with (default variant = primary accent; keeps existing `t("shoppingButton")` key):
  ```tsx
                <Button
                  onClick={() => setShowShoppingDialog(true)}
                  disabled={entriesWithRecipes.length === 0}
                >
                  <ShoppingCart className="size-4 mr-2" />
                  {t("shoppingButton")}
                </Button>
  ```
  (The "Recipes" outline button immediately after stays as-is. Do NOT add a "Vorschlagen"/
  suggest button — no backend; deferred, see Self-Review.)
- [ ] Week-nav card. Replace opening `<GlassCard className="p-4">` (line ~851) with
  `<Card><CardContent className="p-4">` and its closing `</GlassCard>` (line ~873) with
  `</CardContent></Card>`.
- [ ] Error-state card. Replace `<GlassCard className="p-4">` (line ~883) /closing ~889 with
  `<Card><CardContent className="p-4"> … </CardContent></Card>` wrapping the `ErrorState`.
- [ ] Loading-state grid card. Replace `<GlassCard className="p-4">` (line ~892) and its
  closing `</GlassCard>` (~907) with `<Card><CardContent className="p-4"> … </CardContent></Card>`.
- [ ] Loading-state list cards. Replace each `<GlassCard key={i} className="p-4">` (~911) /
  closing (~918) with `<Card key={i}><CardContent className="p-4"> … </CardContent></Card>`.
- [ ] Empty-state card (list view). Replace `<GlassCard className="p-8">` (line ~924) /closing
  (~949) with `<Card><CardContent className="p-8"> … </CardContent></Card>`, and inside it
  retokenize the icon tile (lines ~926-928):
  ```tsx
                    <div className="p-3 rounded-xl bg-month-primary/10 mb-4">
                      <ChefHat className="size-10 text-month-primary" strokeWidth={1.5} />
                    </div>
  ```
  →
  ```tsx
                    <div className="p-3 rounded-xl bg-primary/10 mb-4">
                      <ChefHat className="size-10 text-primary" strokeWidth={1.75} />
                    </div>
  ```
- [ ] Quick-suggestion cards (BOTH copies — the list-view block ~966-1005 and the grid-view
  block ~1099-1138). For each `<GlassCard key={recipe.id} className="group cursor-pointer
  hover:bg-white/[0.06] transition-all" onClick={…}>` … `</GlassCard>` pair, convert to:
  ```tsx
                          <Card
                            key={recipe.id}
                            className="group cursor-pointer hover:bg-accent/40 transition-all"
                            onClick={() => handleAddClick(today, "dinner")}
                          >
                            <CardContent className="p-4 flex items-center gap-3">
  ```
  removing the now-redundant inner `<div className="p-4 flex items-center gap-3">` wrapper
  (its content moves directly under `CardContent`), and closing with
  `</CardContent></Card>`. Inside, retokenize the placeholder icon tile:
  `bg-month-primary/10` → `bg-primary/10`, `text-month-primary` → `text-primary`.
- [ ] Board card. Replace `<GlassCard className="p-4 overflow-x-auto">` (line ~1018) with
  `<Card><CardContent className="p-4 overflow-x-auto">` and its closing `</GlassCard>`
  (line ~1069) with `</CardContent></Card>`.
- [ ] Grid today header cell. Replace (lines ~1028-1032):
  ```tsx
                          className={`text-center p-2 rounded-lg ${
                            isToday
                              ? "bg-month-primary/10 text-month-primary font-semibold"
                              : ""
                          }`}
  ```
  with:
  ```tsx
                          className={`text-center p-2 rounded-lg ${
                            isToday
                              ? "bg-primary/10 text-primary font-semibold"
                              : ""
                          }`}
  ```
- [ ] Meal-type row label cell. Replace (lines ~1049-1050):
  ```tsx
                        <div className="flex flex-col items-center justify-center p-2 gap-1.5 rounded-lg bg-white/[0.02]">
                          <RowIcon className="size-4 text-month-primary/40" />
  ```
  with:
  ```tsx
                        <div className="flex flex-col items-center justify-center p-2 gap-1.5 rounded-lg bg-muted/30">
                          <RowIcon className="size-4 text-muted-foreground/60" />
  ```
- [ ] List-view day cards. Replace (lines ~1155-1163):
  ```tsx
                    <GlassCard
                      key={date}
                      className={`p-3 ${isToday ? "ring-2 ring-month-primary/50" : ""}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h3
                          className={`font-semibold text-sm ${
                            isToday ? "text-month-primary" : ""
                          }`}
                        >
  ```
  with:
  ```tsx
                    <Card
                      key={date}
                      className={isToday ? "ring-2 ring-primary/50" : undefined}
                    >
                      <CardContent className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <h3
                          className={`font-semibold text-sm ${
                            isToday ? "text-primary" : ""
                          }`}
                        >
  ```
  and its matching closing `</GlassCard>` (line ~1223) with:
  ```tsx
                      </CardContent>
                    </Card>
  ```
- [ ] Dialog `month-primary` tokens (minimal restyle, do not redesign internals). Grep
  `month-primary` in `meals/page.tsx` and retokenize the remaining occurrences:
  - ingredient-dialog selected checkbox (lines ~1513-1516): `bg-month-primary border-month-primary text-white`
    → `bg-primary border-primary text-primary-foreground`
  - detail-dialog title icon (line ~1579): `text-month-primary` → `text-primary`
  - detail-dialog ingredient quantity (line ~1650): `text-month-primary` → `text-primary`
  - edit-note dialog title icon (line ~1719): `text-month-primary` → `text-primary`
  Leave all other dialog markup and the bare `<Button>` primary CTAs as default variant
  (already primary on this branch — no `variant="month"` exists in this file's dialogs).
- [ ] After edits, confirm `ListFilter`, `Grid3X3`, `List`, `CalendarDays` etc. are still
  used (they are — view toggle + dropdown). No import removals expected; let lint confirm.
- [ ] `cd webapp && npm run lint && npx tsc --noEmit`  (Expected: PASS)
- [ ] Commit:
  ```
  feat(meals): flatten week board, slots, and entry cards to Salbei foundation
  ```

---

### Task 7 — Changelog + i18n parity confirmation

**Files**
- `CHANGELOG.md` (edit)
- `webapp/messages/en.json`, `de.json`, `fr.json` (verify only)

**Interfaces**
- Consumes: the changes from Tasks 1-6.
- Produces: `[Unreleased]` changelog entries; confirmed EN/DE/FR key parity.

**Steps**
- [ ] Add to `CHANGELOG.md` under `[Unreleased]` → `Changed` (create the section if absent):
  ```markdown
  ### Changed
  - Shopping list redesigned onto the flat "Salbei/Leinen" surface: category headers as a colored dot + label, rows use the shared checklist component with quantity and (when known) a person badge, done items dim and strike through.
  - Shopping kiosk (`/einkaufen`) flattened — solid card header/footer (no glass blur), primary-colored checks.
  - Meal planner week board, slots, and meal cards flattened to the same surface; today is highlighted with the month/primary accent; "Shopping list" topbar action is now the primary call-to-action.
  ```
  And under `[Unreleased]` → `Added`:
  ```markdown
  ### Added
  - Voice input on the shopping list — a mic button (shown only on supported browsers) dictates an item via the Web Speech API.
  - Mobile add button (floating action button) on the shopping list.
  ```
  And under `[Unreleased]` → `Fixed`:
  ```markdown
  ### Fixed
  - Meal planner dates now follow the selected language instead of always German; the drag-to-move failure message is localized.
  ```
- [ ] Verify i18n parity. Run a parity check across the three message bundles for the keys
  added in Task 3 (`shopping.voiceStart`, `shopping.voiceStop`, `components.offline.offlinePill`):
  ```bash
  cd webapp && node -e "const en=require('./messages/en.json'),de=require('./messages/de.json'),fr=require('./messages/fr.json'); const get=(o,p)=>p.split('.').reduce((a,k)=>a&&a[k],o); for(const k of ['shopping.voiceStart','shopping.voiceStop','components.offline.offlinePill']){ for(const [n,b] of [['de',de],['fr',fr],['en',en]]) if(get(b,k)===undefined) throw new Error(n+' missing '+k); } console.log('parity OK');"
  ```
  (Expected: `parity OK`.)
- [ ] `cd webapp && npm run lint && npx tsc --noEmit`  (Expected: PASS)
- [ ] Commit:
  ```
  docs(changelog): shopping + meal-plan flat redesign, voice add, offline pill
  ```

---

## Self-Review

### Scope item → task mapping
| Scope item | Task |
|---|---|
| 1. `/shopping` flat surfaces, gradient, hover, tokens, dot category header | Task 1 |
| 2. `/shopping` rows → `ChecklistItem` (recipe badge, qty meta, person badge, done styling) | Task 2 |
| 3. `/shopping` add row + voice (Web Speech) + mobile FAB + offline pill + per-item sync ring | Task 3 |
| 4. `/einkaufen` flatten header/bar, primary checks, keep wake-lock/pull-to-refresh/haptics | Task 4 |
| 5. `/meals` flat surfaces, gradient, today cell, label/hover tokens | Task 6 |
| 6. Meal slot + `MealEntryCard` flat, drop target, today column | Task 6 |
| 7. `/meals` topbar "Auf Liste" primary CTA, keep Recipes, no Suggest button | Task 6 |
| 8. Dialogs (both pages) minimal token restyle | Task 1 (shopping image dialog) + Task 6 (meals dialogs) |
| 9. i18n: `formatDate` locale fix + hardcoded toast fix + new keys (parity) | Task 5 (fixes) + Task 3 (keys) |
| 10. Changelog `[Unreleased]` + i18n parity confirmation | Task 7 |

### Type-consistency check
- `ChecklistItem.color` is `string` → passing `category.color` (hex string) is valid.
- `PersonAvatar` requires `name: string`, `color: string`, accepts `avatarUrl?: string | null`
  → `Person.avatar_url` is `string | null`; valid. Rendered only when `personById` returns a
  non-null `Person`.
- `item._syncStatus` exists on `OfflineShoppingItem` (the type `useOfflineShopping().items`
  resolves to) → `item._syncStatus !== "synced"` is type-safe.
- `formatDate(dateStr, locale?)` — second param optional with default; all existing external
  callers (if any beyond `meals/page.tsx`) keep working; the page passes `intlLocale: string`.
- Web Speech: no DOM lib types relied on; `MinimalSpeechRecognition`/`SpeechRecognitionCtor`
  are locally declared; `window` access narrowed via `unknown` cast — no `any`.
- `Badge variant="neutral"` is a shipped variant (per the brief's Badge variant list).
- `Button` default variant = month/primary accent on this branch; dropping `variant="month"`
  is correct, not a regression.

### Deferred (flagged)
- **Meal "Vorschlagen"/suggest button** (mockup topbar) — no recommendation backend exists;
  intentionally NOT added (per scope item 7). Follow-up: build a suggestion endpoint first.
- **Shopping item `notes` in the row meta** — dropped from the inline row in Task 2 to match
  the mockup (qty + person badge only). Notes remain editable via the edit Popover. If users
  miss inline notes, re-add them to the `ChecklistItem` `label` as a muted second line.
- **`added_by` is never populated** today, so the person badge will not appear until a future
  change sets `added_by` to a person id on item creation. The badge code is defensive (renders
  only on a resolved `Person`), so this ships safely as latent capability.
- **Deeper kiosk polish** (distance-readability type scale tuning, larger touch targets beyond
  the existing 48-56px) is out of scope — this pass is flat/token + structure only.
- **`UNITS` array** stays hardcoded German per scope (not i18n'd).
