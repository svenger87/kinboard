# Plan 10 — Redesign: Notes + Birthdays (Salbei/Leinen)

For agentic workers: use superpowers:subagent-driven-development.

## Goal
Restyle the Notes and Birthdays surfaces to the "Salbei / Leinen" redesign target, removing all glassmorphism (`GlassCard`) from these app surfaces and replacing it with flat, theme-following elevation. Notes become a masonry sticky-note board (warm-pastel tinted cards, slight rotation, mono dates). Birthdays gain a restyled SVG year-ring that renders person **avatars** on the ring and a **next-birthday** center, plus flat cards everywhere and a person-colored hero. No new DB migrations, no fake features.

## Architecture
- **Notes** (`webapp/src/app/notes/page.tsx`): a CSS-columns masonry of flat tinted cards. Each note's pastel tint + rotation is derived deterministically from `note.id` via a new pure helper `webapp/src/lib/note-style.ts` (no DB column). Keeps existing hooks (`useNotes`/`useCreateNote`/`useUpdateNote`/`useDeleteNote`), search, inline add-panel, pin/edit/delete, and adds a mobile `FAB`.
- **BirthdayYearRing** (`webapp/src/components/birthday-year-ring.tsx`): restyled in place. Person avatars replace plain dots (color `<circle>` + white initial `<text>`, or clipped `<image>` when `avatarUrl` is http/data). Next birthday highlighted with `--primary`/`--ring`. New center shows the next birthday via new optional props. Month ticks/labels/today-marker and placement math preserved. Reduced-motion safe (no spin).
- **Birthdays page** (`webapp/src/app/birthdays/page.tsx`): all `GlassCard` → flat `Card`; year-strip flat; hero gradient derives from the linked person color via `personStrongTint`/`personTint` with a large `PersonAvatar`; ring gets the new center props + responsive ~420 size; upcoming/later lists flat with `font-mono` countdowns + decorative `Gift` icon. The duplicated date utils (`parseBirthdayDate`/`getNextBirthday`/`getDaysUntilBirthday`/`getAge`/`getUpcomingAge`) are extracted to `webapp/src/lib/birthday.ts` and imported by the page, the widget, and (where useful) the ring.
- **i18n** (`webapp/messages/{en,de,fr}.json`): new `components.birthdayYearRing` next-birthday center keys + a notes FAB aria key. EN/DE/FR parity (CI gate).

## Tech Stack
Next.js 16 App Router, React 19, Tailwind CSS, shadcn/ui, framer-motion, next-intl (EN+DE+FR parity is a CI gate), date-fns. Lucide stroke 1.75. Foundation + Plans 2–9 components available: `PersonAvatar`, `Card`/`CardContent` (flat), `Badge`, `FAB`, `PERSON_COLORS` + `personTint`/`personStrongTint`/`personText` from `@/lib/person-color`, `.icon-badge`, `.page-gradient`, `.elev-*`, `.text-kiosk-label`, `getDateFnsLocale(locale)`. `GlassCard` exists but MUST NOT be used on app surfaces.

## Global Constraints
- No `next build` locally. Per-task gate: `cd webapp && npm run lint` and `npx tsc --noEmit`. No unit tests — verification = lint+tsc+structural self-review; live smoke deferred. Do NOT write Jest/RTL/TDD steps.
- Reuse Foundation + Plan 2-9 components; never hardcode accent hex (primary/tints); person colors via the person row / PERSON_COLORS / inline; note pastel tints via a documented deterministic helper (warm soft values are OK as a presentational palette, document them); NO literal text-white except over photos/colored fills (SVG avatar initials over a color circle are fine). Lucide stroke 1.75. Dates/countdowns `font-mono`/`tabular-nums`.
- NO glass/backdrop-blur on app surfaces (removes GlassCard from notes/birthdays). NO fake features / NO unplanned DB migrations (author dot + gift ideas DEFERRED). Theme-following.
- Touch targets ≥44px. next-intl EN/DE/FR parity (CI gate). Reduced-motion respected (rotated notes are static; ring doesn't animate).
- Commits: Conventional Commits, NO `Co-Authored-By: Claude` trailer. One commit per task.

---

### Task 1 — Notes sticky-board restyle + deterministic note-style helper

**Files**
- Create: `webapp/src/lib/note-style.ts`
- Edit: `webapp/src/app/notes/page.tsx`

**Interfaces**
- Produces: `noteStyle(id: string): { tintVar: string; rotateDeg: number }` from `@/lib/note-style`.
- Consumes: `useNotes`/`useCreateNote`/`useUpdateNote`/`useDeleteNote` (unchanged), `Card`/`CardContent`, `FAB`, `getDateFnsLocale`, `format` (date-fns), next-intl `notes`/`common`.

**Steps**

- [ ] Create `webapp/src/lib/note-style.ts` with this COMPLETE content:

```ts
/**
 * Presentational sticky-note styling for the Notes board (Salbei/Leinen redesign).
 *
 * The `notes` table only stores { id, family_id, content, created_at, updated_at }
 * (+ an untyped `pinned` column). There is NO per-note color or rotation column,
 * and adding one is out of scope for a visual redesign (would need a DB migration).
 * So we DERIVE a stable warm-pastel tint + a small rotation deterministically from
 * the note id: same id always yields the same look, with no persistence required.
 *
 * Tints are returned as CSS color strings (warm soft pastels). They are mixed with
 * `transparent` so they sit gently over the page background and read in both light
 * and dark mode. Consumers apply them via an inline `backgroundColor` style.
 */

/** Warm-pastel base hues (HSL). Soft, family-friendly, deliberately low-chroma. */
const NOTE_HUES: readonly { h: number; s: number; l: number }[] = [
  { h: 45, s: 70, l: 72 }, // butter
  { h: 18, s: 65, l: 74 }, // peach
  { h: 340, s: 55, l: 78 }, // rose
  { h: 90, s: 45, l: 72 }, // sage-lime
  { h: 200, s: 55, l: 76 }, // sky
  { h: 280, s: 45, l: 80 }, // lilac
] as const;

/** djb2-style string hash → unsigned 32-bit int. Deterministic and dependency-free. */
function hashId(id: string): number {
  let hash = 5381;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 33) ^ id.charCodeAt(i);
  }
  return hash >>> 0;
}

export interface NoteStyle {
  /** Background color string (mixes the pastel with transparent for theme blending). */
  tintVar: string;
  /** Rotation in degrees, in [-1.5, 1.4]. */
  rotateDeg: number;
}

/**
 * Deterministic per-note presentational style. Stable for a given id.
 * - tint: one of NOTE_HUES, mixed ~45% with transparent so it tints rather than blocks.
 * - rotation: spread across [-1.5deg, 1.4deg] derived from a second hash slice.
 */
export function noteStyle(id: string): NoteStyle {
  const h = hashId(id);
  const hue = NOTE_HUES[h % NOTE_HUES.length];
  // Rotation: map another slice of the hash to [-1.5, 1.4].
  const rotBucket = (h >> 8) % 30; // 0..29
  const rotateDeg = Math.round((-1.5 + (rotBucket / 29) * 2.9) * 10) / 10;
  const tintVar = `color-mix(in srgb, hsl(${hue.h} ${hue.s}% ${hue.l}%), transparent 45%)`;
  return { tintVar, rotateDeg };
}
```

- [ ] In `webapp/src/app/notes/page.tsx`, replace the import of `GlassCard` and add the new imports. Replace:

```tsx
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
```

with:

```tsx
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FAB } from "@/components/fab";
import { noteStyle } from "@/lib/note-style";
```

- [ ] Replace the `NotesSkeleton` body (it uses `GlassCard`) with flat masonry skeleton. Replace:

```tsx
function NotesSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <GlassCard key={i} className="p-5">
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-3/4 mb-4" />
          <Skeleton className="h-3 w-1/3" />
        </GlassCard>
      ))}
    </div>
  );
}
```

with:

```tsx
function NotesSkeleton() {
  return (
    <div className="columns-1 sm:columns-2 lg:columns-3 gap-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Card key={i} className="break-inside-avoid mb-4 p-5">
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-3/4 mb-4" />
          <Skeleton className="h-3 w-1/3" />
        </Card>
      ))}
    </div>
  );
}
```

- [ ] Swap the page background from the custom `month-primary` gradient to `.page-gradient`. Replace:

```tsx
        <div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none" />
```

with:

```tsx
        <div className="page-gradient" />
```

- [ ] In the `PageHeader`, recolor the pinned subtitle accent and the New button from `month`→`primary`. Replace:

```tsx
                {pinnedCount > 0 && (
                  <span className="text-month-primary"> · {t("subtitlePinned", { count: pinnedCount })}</span>
                )}
```

with:

```tsx
                {pinnedCount > 0 && (
                  <span className="text-primary"> · {t("subtitlePinned", { count: pinnedCount })}</span>
                )}
```

and replace the header action Button:

```tsx
            actions={
              <Button
                variant="month"
                size="sm"
                className="gap-2"
                onClick={() => setIsAdding(true)}
              >
                <Plus className="size-4" />
                {t("newButton")}
              </Button>
            }
```

with:

```tsx
            actions={
              <Button
                variant="default"
                size="sm"
                className="gap-2"
                onClick={() => setIsAdding(true)}
              >
                <Plus className="size-4" />
                {t("newButton")}
              </Button>
            }
```

- [ ] Restyle the inline add-panel from `GlassCard`+`ring-month-primary` to flat `Card`+`ring-primary`, and recolor its Save button. Replace:

```tsx
                <GlassCard className="p-4 ring-2 ring-month-primary/30">
```

with:

```tsx
                <Card className="p-4 ring-2 ring-primary/30">
```

and within that panel replace its Save `<Button variant="month"` with `<Button variant="default"`, and replace the matching closing `</GlassCard>` (the one immediately before the add-panel's closing `</motion.div>`) with `</Card>`.

- [ ] Replace the three error/empty `GlassCard` wrappers with flat `Card`. Replace:

```tsx
          {error ? (
            <GlassCard className="p-8">
              <ErrorState
                onRetry={refetch}
                message={t("errorMessage")}
              />
            </GlassCard>
          ) : isLoading ? (
            <NotesSkeleton />
          ) : sortedNotes.length === 0 ? (
            <GlassCard className="p-8">
```

with:

```tsx
          {error ? (
            <Card className="p-8">
              <ErrorState
                onRetry={refetch}
                message={t("errorMessage")}
              />
            </Card>
          ) : isLoading ? (
            <NotesSkeleton />
          ) : sortedNotes.length === 0 ? (
            <Card className="p-8">
```

and replace the matching `</GlassCard>` that closes the empty-state branch (the one after the closing `)}` of the `searchQuery ?` ternary, immediately before `) : (`) with `</Card>`.

- [ ] Convert the notes grid to CSS masonry and the per-note card to a flat tinted sticky. Replace the entire results `motion.div` block:

```tsx
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
            >
              <AnimatePresence mode="popLayout">
                {sortedNotes.map((note, index) => {
                  const isEditing = editingId === note.id;

                  return (
                    <motion.div
                      key={note.id}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: index * 0.03 }}
                    >
                      <GlassCard
                        className={`group relative p-5 transition-all hover:bg-white/[0.06] ${
                          note.pinned ? "ring-1 ring-month-primary/20" : ""
                        } ${isEditing ? "ring-2 ring-month-primary/40" : ""}`}
                      >
                        {/* Pin indicator */}
                        {note.pinned && !isEditing && (
                          <div className="absolute top-3 right-3">
                            <Pin className="size-3.5 text-month-primary/60 fill-month-primary/60" />
                          </div>
                        )}
```

with:

```tsx
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="columns-1 sm:columns-2 lg:columns-3 gap-4"
            >
              <AnimatePresence mode="popLayout">
                {sortedNotes.map((note) => {
                  const isEditing = editingId === note.id;
                  const style = noteStyle(note.id);

                  return (
                    <div
                      key={note.id}
                      className="break-inside-avoid mb-4"
                      style={{ transform: isEditing ? undefined : `rotate(${style.rotateDeg}deg)` }}
                    >
                      <Card
                        className={`group relative border-transparent p-5 elev-md transition-shadow ${
                          note.pinned ? "ring-1 ring-primary/30" : ""
                        } ${isEditing ? "ring-2 ring-primary/40" : ""}`}
                        style={{ backgroundColor: isEditing ? undefined : style.tintVar }}
                      >
                        {/* Pin indicator */}
                        {note.pinned && !isEditing && (
                          <div className="absolute top-3 right-3">
                            <Pin className="size-3.5 text-primary/70 fill-primary/70" />
                          </div>
                        )}
```

  Note: `index` is dropped from the map signature because the staggered per-card `transition={{ delay: index * 0.03 }}` is removed (the outer `<div>` is no longer a motion element — masonry columns + per-card rotation don't compose with framer layout animation). This is intentional and reduced-motion-friendly.

- [ ] Recolor the pinned/edit action buttons inside the card from `month-primary`→`primary`. Replace:

```tsx
                                      className={`size-9 ${note.pinned ? "text-month-primary" : ""}`}
```

with:

```tsx
                                      className={`size-9 ${note.pinned ? "text-primary" : ""}`}
```

- [ ] Convert the note date to a flat mono date (replace the relative-distance span + tooltip with a `font-mono` formatted date; drop the now-unused tooltip wrapper for the date only). Replace:

```tsx
                            <div className="flex items-center justify-between">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-xs text-muted-foreground">
                                    {formatDistanceToNow(new Date(note.created_at), {
                                      addSuffix: true,
                                      locale: dateLocale,
                                    })}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{format(new Date(note.created_at), "PPPp", { locale: dateLocale })}</p>
                                </TooltipContent>
                              </Tooltip>
```

with:

```tsx
                            <div className="flex items-center justify-between">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                                    {format(new Date(note.created_at), "d. MMM yyyy", { locale: dateLocale })}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{format(new Date(note.created_at), "PPPp", { locale: dateLocale })}</p>
                                </TooltipContent>
                              </Tooltip>
```

- [ ] Close the per-note card wrapper. Replace the per-note closing tags:

```tsx
                      </GlassCard>
                    </motion.div>
                  );
                })}
```

with:

```tsx
                      </Card>
                    </div>
                  );
                })}
```

- [ ] Add a mobile FAB that opens the add-panel, placed just before the Delete confirmation `AlertDialog`. Insert immediately after the closing `</div>` of `<div className="relative z-10 ...">` (i.e. after the main content container, before `{/* Delete confirmation */}`):

```tsx
        {/* Mobile add FAB */}
        <FAB
          icon={Plus}
          onClick={() => setIsAdding(true)}
          ariaLabel={t("fabAria")}
          className="sm:hidden"
        />
```

- [ ] Remove the now-unused `formatDistanceToNow` import since only `format` is used. Replace:

```tsx
import { formatDistanceToNow, format } from "date-fns";
```

with:

```tsx
import { format } from "date-fns";
```

- [ ] Run the gate:

```bash
cd webapp && npm run lint && npx tsc --noEmit
```

Expected: PASS. (The `notes.fabAria` key is added in Task 4; if tsc/lint flags the missing key, it is a runtime-only next-intl key and will not fail tsc — but ensure Task 4 lands before the i18n CI parity job. For local iteration the key may be added now if desired; the canonical add is Task 4.)

- [ ] Commit:

```bash
git add webapp/src/lib/note-style.ts webapp/src/app/notes/page.tsx
git commit -m "feat(notes): sticky-board redesign — flat masonry, deterministic warm-pastel tints, mono dates, mobile FAB"
```

---

### Task 2 — Extract shared birthday date utils

**Files**
- Create: `webapp/src/lib/birthday.ts`
- Edit: `webapp/src/app/birthdays/page.tsx`
- Edit: `webapp/src/components/widgets/birthday-widget.tsx`

**Interfaces**
- Produces: `parseBirthdayDate`, `getNextBirthday`, `getDaysUntilBirthday`, `getAge`, `getUpcomingAge` from `@/lib/birthday`.
- Consumes (callers): birthdays page + birthday widget import these instead of redefining them. Behavior identical.

**Steps**

- [ ] Create `webapp/src/lib/birthday.ts` with this COMPLETE content (lifted verbatim from the page's inline utils so behavior is byte-identical):

```ts
import {
  differenceInDays,
  differenceInYears,
  setYear,
  addYears,
  parseISO,
  startOfDay,
} from "date-fns";

/**
 * Parse a "YYYY-MM-DD" birthday string as a LOCAL date (not UTC).
 * Appends T12:00:00 so timezone offsets never shift the calendar day.
 */
export function parseBirthdayDate(dateStr: string): Date {
  return parseISO(dateStr + "T12:00:00");
}

/** The next occurrence (this year, or next year if already past). */
export function getNextBirthday(date: Date): Date {
  const today = startOfDay(new Date());
  const thisYearBirthday = startOfDay(setYear(date, today.getFullYear()));
  if (differenceInDays(today, thisYearBirthday) > 0) {
    return addYears(thisYearBirthday, 1);
  }
  return thisYearBirthday;
}

/** Whole days from today until the next birthday. */
export function getDaysUntilBirthday(date: Date): number {
  const nextBirthday = getNextBirthday(date);
  return differenceInDays(startOfDay(nextBirthday), startOfDay(new Date()));
}

/** Current age in whole years. */
export function getAge(date: Date): number {
  return differenceInYears(startOfDay(new Date()), startOfDay(date));
}

/** Age the person turns on their next birthday. */
export function getUpcomingAge(date: Date): number {
  const nextBirthday = getNextBirthday(date);
  return differenceInYears(nextBirthday, startOfDay(date));
}
```

- [ ] In `webapp/src/app/birthdays/page.tsx`, delete the inline `parseBirthdayDate` definition (and its leading comment) and the `getNextBirthday`/`getDaysUntilBirthday`/`getAge`/`getUpcomingAge` definitions. Remove this block:

```tsx
// Parse date string safely without timezone issues
// "1990-01-28" should be January 28th, not January 27th due to UTC conversion
function parseBirthdayDate(dateStr: string): Date {
  // parseISO returns UTC, but we want local date
  // Add T12:00:00 to avoid timezone edge cases
  const date = parseISO(dateStr + "T12:00:00");
  return date;
}
```

and remove this block:

```tsx
function getNextBirthday(date: Date): Date {
  const today = startOfDay(new Date());
  const thisYearBirthday = startOfDay(setYear(date, today.getFullYear()));

  // If birthday already passed this year (not today), advance to next year
  if (differenceInDays(today, thisYearBirthday) > 0) {
    return addYears(thisYearBirthday, 1);
  }
  return thisYearBirthday;
}

function getDaysUntilBirthday(date: Date): number {
  const nextBirthday = getNextBirthday(date);
  // Use startOfDay to compare dates without time component
  return differenceInDays(startOfDay(nextBirthday), startOfDay(new Date()));
}

function getAge(date: Date): number {
  return differenceInYears(startOfDay(new Date()), startOfDay(date));
}

function getUpcomingAge(date: Date): number {
  const nextBirthday = getNextBirthday(date);
  return differenceInYears(nextBirthday, startOfDay(date));
}
```

- [ ] Trim the page's date-fns import to only what remains in use (`format` is still used; the moved helpers' imports `differenceInDays`, `differenceInYears`, `setYear`, `isPast`, `addYears`, `parseISO`, `startOfDay` are no longer referenced in the page). Replace:

```tsx
import { format, differenceInDays, differenceInYears, setYear, isPast, addYears, parseISO, startOfDay } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useTranslations, useLocale } from "next-intl";
```

with:

```tsx
import { format } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useTranslations, useLocale } from "next-intl";
import {
  parseBirthdayDate,
  getNextBirthday,
  getDaysUntilBirthday,
  getAge,
  getUpcomingAge,
} from "@/lib/birthday";
```

  Note: `isPast` was already imported but unused in the original (it appears in the import list but nowhere in the body); dropping it removes a latent unused import.

- [ ] In `webapp/src/components/widgets/birthday-widget.tsx`, delete the inline `parseBirthdayDate`, `getNextBirthday`, and `getDaysUntilBirthday` definitions (keep `calculateUpcomingAge`, which is widget-specific). Remove this block:

```tsx
// Parse date string safely without timezone issues
// "1990-01-28" should be January 28th, not January 27th due to UTC conversion
function parseBirthdayDate(dateStr: string): Date {
  const date = parseISO(dateStr + "T12:00:00");
  return date;
}
```

and remove this block:

```tsx
function getNextBirthday(date: Date): Date {
  const today = startOfDay(new Date());
  const thisYearBirthday = startOfDay(setYear(date, today.getFullYear()));

  // If birthday already passed this year (not today), advance to next year
  if (differenceInDays(today, thisYearBirthday) > 0) {
    return addYears(thisYearBirthday, 1);
  }
  return thisYearBirthday;
}

function getDaysUntilBirthday(date: Date): number {
  const nextBirthday = getNextBirthday(date);
  // Use startOfDay to compare dates without time component
  return differenceInDays(startOfDay(nextBirthday), startOfDay(new Date()));
}
```

  Note: `calculateUpcomingAge` calls `getNextBirthday`, so the import must include it.

- [ ] Update the widget's date-fns import and add the `@/lib/birthday` import. The widget still uses `format`. The moved helpers' bare imports (`differenceInDays`, `setYear`, `addYears`, `parseISO`, `startOfDay`) are still referenced by the surviving `calculateUpcomingAge`? — `calculateUpcomingAge` only uses `getNextBirthday`, so after the move it uses no date-fns directly. Replace:

```tsx
import { format, differenceInDays, setYear, addYears, parseISO, startOfDay } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useTranslations, useLocale } from "next-intl";
import { useMemo } from "react";
import { useBirthdays, usePeople } from "@/hooks";
```

with:

```tsx
import { format } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useTranslations, useLocale } from "next-intl";
import { useMemo } from "react";
import { useBirthdays, usePeople } from "@/hooks";
import {
  parseBirthdayDate,
  getNextBirthday,
  getDaysUntilBirthday,
} from "@/lib/birthday";
```

  Note: keep `calculateUpcomingAge` defined in the widget; it now reads `getNextBirthday` from the import.

- [ ] Run the gate:

```bash
cd webapp && npm run lint && npx tsc --noEmit
```

Expected: PASS. (tsc will flag any leftover unused date-fns import — if so, remove the offending name from the relevant import line. The intended end state: page imports only `format` from date-fns; widget imports only `format` from date-fns.)

- [ ] Commit:

```bash
git add webapp/src/lib/birthday.ts webapp/src/app/birthdays/page.tsx webapp/src/components/widgets/birthday-widget.tsx
git commit -m "refactor(birthdays): extract shared birthday date utils to lib/birthday.ts"
```

---

### Task 3 — BirthdayYearRing restyle (avatars + next-birthday center)

**Files**
- Edit: `webapp/src/components/birthday-year-ring.tsx`

**Interfaces**
- Consumes: `BirthdayDot` now optionally carries `avatarUrl?: string | null`. New optional props `nextName?`, `nextAge?`, `nextDaysUntil?`. next-intl `components.birthdayYearRing` gains center keys (added in Task 4).
- Produces: restyled ring (avatars on ring, next-birthday highlight, next-birthday center). Default `size` bumped to 360 (caller passes ~420 on desktop, smaller on mobile).

**Steps**

- [ ] Extend the props/interface. Replace:

```tsx
interface BirthdayDot {
  id: string;
  name: string;
  date: Date;
  daysUntil: number;
  color: string;
}

interface BirthdayYearRingProps {
  birthdays: BirthdayDot[];
  size?: number;
}
```

with:

```tsx
interface BirthdayDot {
  id: string;
  name: string;
  date: Date;
  daysUntil: number;
  color: string;
  avatarUrl?: string | null;
}

interface BirthdayYearRingProps {
  birthdays: BirthdayDot[];
  size?: number;
  /** Next-birthday person name for the center label. */
  nextName?: string;
  /** Age the next person turns (omit if year unknown). */
  nextAge?: number;
  /** Whole days until the next birthday. */
  nextDaysUntil?: number;
}
```

- [ ] Update the signature + radii. Replace:

```tsx
export function BirthdayYearRing({ birthdays, size = 280 }: BirthdayYearRingProps) {
  const t = useTranslations("components.birthdayYearRing");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);
  const center = size / 2;
  const ringRadius = size / 2 - 32;
  const labelRadius = size / 2 - 10;
  const dotRadius = 6;
```

with:

```tsx
export function BirthdayYearRing({
  birthdays,
  size = 360,
  nextName,
  nextAge,
  nextDaysUntil,
}: BirthdayYearRingProps) {
  const t = useTranslations("components.birthdayYearRing");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);
  const center = size / 2;
  const ringRadius = size / 2 - 40;
  const labelRadius = size / 2 - 14;
  const avatarRadius = 13;
  // The next birthday = the smallest daysUntil among the supplied dots.
  const nextId = useMemo(() => {
    if (birthdays.length === 0) return null;
    return birthdays.reduce((min, b) => (b.daysUntil < min.daysUntil ? b : min), birthdays[0]).id;
  }, [birthdays]);
```

- [ ] Update the `dots` memo to carry through `avatarUrl` and `id` (already present). No change needed beyond the `...b` spread already including `avatarUrl`. Confirm the existing memo:

```tsx
  const dots = useMemo(() => {
    return birthdays.map((b) => {
      const doy = getDayOfYear(b.date);
      const angle = dayToAngle(doy, daysInYear);
      const pos = angleToXY(angle, ringRadius, center);
      return { ...b, angle, pos };
    });
  }, [birthdays, daysInYear, ringRadius, center]);
```

  remains as-is (the `...b` spread carries `avatarUrl`).

- [ ] Recolor the background ring + month ticks from glass/`month-primary` tokens to theme tokens. Replace:

```tsx
        {/* Background ring */}
        <circle
          cx={center}
          cy={center}
          r={ringRadius}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="text-white/[0.06]"
        />

        {/* Month tick marks and labels */}
        {monthTicks.map((tick, i) => (
          <g key={`month-${i}`}>
            <line
              x1={tick.tickStart.x}
              y1={tick.tickStart.y}
              x2={tick.tickEnd.x}
              y2={tick.tickEnd.y}
              stroke="currentColor"
              strokeWidth={1}
              className={i === currentMonth ? "text-month-primary/60" : "text-white/20"}
            />
            <text
              x={tick.labelPos.x}
              y={tick.labelPos.y}
              textAnchor="middle"
              dominantBaseline="central"
              className={`text-[9px] font-medium ${
                i === currentMonth ? "fill-month-primary" : "fill-muted-foreground/60"
              }`}
            >
              {tick.label}
            </text>
          </g>
        ))}

        {/* Today marker */}
        <line
          x1={angleToXY(todayAngle, ringRadius - 12, center).x}
          y1={angleToXY(todayAngle, ringRadius - 12, center).y}
          x2={angleToXY(todayAngle, ringRadius + 12, center).x}
          y2={angleToXY(todayAngle, ringRadius + 12, center).y}
          stroke="hsl(var(--month-primary))"
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.8}
        />
```

with:

```tsx
        {/* Background ring */}
        <circle
          cx={center}
          cy={center}
          r={ringRadius}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="text-border"
        />

        {/* Month tick marks and labels */}
        {monthTicks.map((tick, i) => (
          <g key={`month-${i}`}>
            <line
              x1={tick.tickStart.x}
              y1={tick.tickStart.y}
              x2={tick.tickEnd.x}
              y2={tick.tickEnd.y}
              stroke="currentColor"
              strokeWidth={1}
              className={i === currentMonth ? "text-primary/60" : "text-foreground/15"}
            />
            <text
              x={tick.labelPos.x}
              y={tick.labelPos.y}
              textAnchor="middle"
              dominantBaseline="central"
              className={`text-[9px] font-medium ${
                i === currentMonth ? "fill-primary" : "fill-muted-foreground/60"
              }`}
            >
              {tick.label}
            </text>
          </g>
        ))}

        {/* Today marker */}
        <line
          x1={angleToXY(todayAngle, ringRadius - 12, center).x}
          y1={angleToXY(todayAngle, ringRadius - 12, center).y}
          x2={angleToXY(todayAngle, ringRadius + 12, center).x}
          y2={angleToXY(todayAngle, ringRadius + 12, center).y}
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.8}
        />
```

- [ ] Replace the birthday-dot rendering with avatar marks (color circle + white initial, or clipped image when `avatarUrl` is http/data), highlight the next birthday with a `--primary` ring, and make the marks static (no spring entrance) for reduced-motion safety. Replace:

```tsx
        {/* Birthday dots */}
        {dots.map((dot, i) => (
          <motion.g
            key={dot.id}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.3 + i * 0.05, type: "spring", stiffness: 200 }}
          >
            {/* Glow for nearby birthdays */}
            {dot.daysUntil <= 30 && (
              <circle
                cx={dot.pos.x}
                cy={dot.pos.y}
                r={dotRadius + 4}
                fill={dot.color}
                opacity={0.15}
              />
            )}
            {/* Dot */}
            <circle
              cx={dot.pos.x}
              cy={dot.pos.y}
              r={dot.daysUntil <= 7 ? dotRadius + 1 : dotRadius}
              fill={dot.color}
              stroke="hsl(var(--background))"
              strokeWidth={1.5}
              className="cursor-pointer"
            />
            {/* Name label for close birthdays */}
            {dot.daysUntil <= 30 && (
              <text
                x={dot.pos.x}
                y={dot.pos.y - dotRadius - 6}
                textAnchor="middle"
                className="fill-foreground/80 text-[8px] font-medium pointer-events-none"
              >
                {dot.name.split(" ")[0]}
              </text>
            )}
          </motion.g>
        ))}
```

with:

```tsx
        {/* Birthday avatar marks */}
        {dots.map((dot) => {
          const isNext = dot.id === nextId;
          const hasImage =
            !!dot.avatarUrl &&
            (dot.avatarUrl.startsWith("http") || dot.avatarUrl.startsWith("data:"));
          const clipId = `bday-clip-${dot.id}`;
          return (
            <g key={dot.id} className="cursor-pointer">
              {/* Next-birthday highlight ring */}
              {isNext && (
                <circle
                  cx={dot.pos.x}
                  cy={dot.pos.y}
                  r={avatarRadius + 4}
                  fill="none"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2.5}
                  opacity={0.9}
                />
              )}
              {/* Background contrast circle */}
              <circle
                cx={dot.pos.x}
                cy={dot.pos.y}
                r={avatarRadius + 1.5}
                fill="hsl(var(--background))"
              />
              {hasImage ? (
                <>
                  <clipPath id={clipId}>
                    <circle cx={dot.pos.x} cy={dot.pos.y} r={avatarRadius} />
                  </clipPath>
                  <image
                    href={dot.avatarUrl as string}
                    x={dot.pos.x - avatarRadius}
                    y={dot.pos.y - avatarRadius}
                    width={avatarRadius * 2}
                    height={avatarRadius * 2}
                    clipPath={`url(#${clipId})`}
                    preserveAspectRatio="xMidYMid slice"
                  />
                </>
              ) : (
                <>
                  <circle cx={dot.pos.x} cy={dot.pos.y} r={avatarRadius} fill={dot.color} />
                  <text
                    x={dot.pos.x}
                    y={dot.pos.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="text-[11px] font-bold pointer-events-none"
                    fill="#ffffff"
                  >
                    {(dot.name.trim()[0] ?? "?").toUpperCase()}
                  </text>
                </>
              )}
            </g>
          );
        })}
```

  Note: `text-white` is forbidden as a Tailwind class on app surfaces, but `fill="#ffffff"` over a colored `<circle>` is the SVG-avatar-initial case explicitly allowed by the constraints (white initials over a person-color fill, mirroring `PersonAvatar`).

- [ ] Replace the center text (count → next birthday, with fallback to count). Replace:

```tsx
        {/* Center text */}
        <text
          x={center}
          y={center - 8}
          textAnchor="middle"
          className="fill-foreground text-lg font-bold"
        >
          {birthdays.length}
        </text>
        <text
          x={center}
          y={center + 10}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px]"
        >
          {t("centerLabel")}
        </text>
```

with:

```tsx
        {/* Center text — next birthday, or fallback to count */}
        {nextName ? (
          <>
            <text
              x={center}
              y={center - 14}
              textAnchor="middle"
              className="fill-foreground text-lg font-display font-medium"
            >
              {nextName}
            </text>
            {typeof nextAge === "number" && (
              <text
                x={center}
                y={center + 6}
                textAnchor="middle"
                className="fill-primary text-[11px] font-medium"
              >
                {t("centerTurns", { age: nextAge })}
              </text>
            )}
            <text
              x={center}
              y={center + 24}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px] tabular-nums"
            >
              {t("centerInDays", { count: nextDaysUntil ?? 0 })}
            </text>
          </>
        ) : (
          <>
            <text
              x={center}
              y={center - 8}
              textAnchor="middle"
              className="fill-foreground text-lg font-bold"
            >
              {birthdays.length}
            </text>
            <text
              x={center}
              y={center + 10}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {t("centerLabel")}
            </text>
          </>
        )}
```

- [ ] Remove the now-unused `motion` import (the spring `motion.g` was the only usage). Replace:

```tsx
import { motion } from "framer-motion";
import { useTranslations, useLocale } from "next-intl";
```

with:

```tsx
import { useTranslations, useLocale } from "next-intl";
```

  Note: `useMemo` is still imported and now also used for `nextId`.

- [ ] Run the gate:

```bash
cd webapp && npm run lint && npx tsc --noEmit
```

Expected: PASS. (`centerTurns`/`centerInDays` keys are added in Task 4; next-intl runtime keys do not break tsc. If the i18n CI parity job runs before Task 4, sequence Task 4 immediately after.)

- [ ] Commit:

```bash
git add webapp/src/components/birthday-year-ring.tsx
git commit -m "feat(birthdays): year-ring renders person avatars + next-birthday center, flat theme tokens, static (reduced-motion safe)"
```

---

### Task 4 — Birthdays page restyle + i18n + changelog

**Files**
- Edit: `webapp/src/app/birthdays/page.tsx`
- Edit: `webapp/messages/en.json`
- Edit: `webapp/messages/de.json`
- Edit: `webapp/messages/fr.json`
- Edit: `CHANGELOG.md`

**Interfaces**
- Consumes: flat `Card`/`CardContent`, `PersonAvatar`, `personTint`/`personStrongTint` from `@/lib/person-color`, restyled `BirthdayYearRing` (new center props + avatarUrl dots), new i18n keys.
- Produces: glass-free, theme-following Birthdays page; new i18n keys; changelog entry.

**Steps**

- [ ] Add the needed imports to the birthdays page. Replace:

```tsx
import { GlassCard, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
```

with:

```tsx
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/person-avatar";
import { personTint, personStrongTint } from "@/lib/person-color";
```

- [ ] Recolor `CountdownRing`'s track from glass to a theme token. Replace:

```tsx
        className="text-white/10"
```

with:

```tsx
        className="text-border"
```

- [ ] Recolor `getCountdownColor`'s day-0 branch from `month-primary` to `primary`. Replace:

```tsx
    if (days === 0) return "hsl(var(--month-primary))";
```

with:

```tsx
    if (days === 0) return "hsl(var(--primary))";
```

- [ ] Recolor the header subtitle accent. Replace:

```tsx
                  {upcomingBirthdays.length > 0 && (
                    <span className="text-month-primary"> · {t("subtitleUpcoming", { count: upcomingBirthdays.length })}</span>
                  )}
```

with:

```tsx
                  {upcomingBirthdays.length > 0 && (
                    <span className="text-primary"> · {t("subtitleUpcoming", { count: upcomingBirthdays.length })}</span>
                  )}
```

- [ ] Recolor the unassigned-fallback color used for the ring dots from `month-primary` to `primary`. Replace:

```tsx
                            color: person?.color || "hsl(var(--month-primary))",
```

with:

```tsx
                            color: person?.color || "hsl(var(--primary))",
```

- [ ] Replace the empty-state `GlassCard` with flat `Card`. Replace:

```tsx
          ) : sortedBirthdays.length === 0 ? (
            <GlassCard>
              <CardContent className="p-0">
                <EmptyState
                  icon={Cake}
                  title={t("emptyTitle")}
                  description={t("emptyDescription")}
                  action={{
                    label: t("emptyAction"),
                    onClick: () => setIsAddOpen(true),
                  }}
                />
              </CardContent>
            </GlassCard>
```

with:

```tsx
          ) : sortedBirthdays.length === 0 ? (
            <Card>
              <CardContent className="p-0">
                <EmptyState
                  icon={Cake}
                  title={t("emptyTitle")}
                  description={t("emptyDescription")}
                  action={{
                    label: t("emptyAction"),
                    onClick: () => setIsAddOpen(true),
                  }}
                />
              </CardContent>
            </Card>
```

- [ ] Convert the year-strip `GlassCard` to flat `Card` and recolor its `month-primary` tokens to `primary`. Replace:

```tsx
                <GlassCard className="overflow-hidden">
                  <CardContent className="p-4 sm:p-5">
```

with:

```tsx
                <Card className="overflow-hidden">
                  <CardContent className="p-4 sm:p-5">
```

  then within that strip replace each `month-primary` occurrence. Replace:

```tsx
                                <span className={`text-[10px] sm:text-xs font-medium ${
                                  isCurrentMonth ? "text-month-primary" : "text-muted-foreground/60"
                                }`}>
                                  {monthsShort[month]}
                                </span>
                                <div className={`w-full h-1.5 rounded-full transition-colors ${
                                  isCurrentMonth
                                    ? "bg-month-primary/30"
                                    : "bg-muted/40"
                                }`}>
                                  {hasBirthdays && (
                                    <div
                                      className={`h-full rounded-full ${
                                        isCurrentMonth ? "bg-month-primary" : "bg-month-primary/60"
                                      }`}
                                      style={{ width: "100%" }}
                                    />
                                  )}
                                </div>
```

with:

```tsx
                                <span className={`text-[10px] sm:text-xs font-medium ${
                                  isCurrentMonth ? "text-primary" : "text-muted-foreground/60"
                                }`}>
                                  {monthsShort[month]}
                                </span>
                                <div className={`w-full h-1.5 rounded-full transition-colors ${
                                  isCurrentMonth
                                    ? "bg-primary/30"
                                    : "bg-muted/40"
                                }`}>
                                  {hasBirthdays && (
                                    <div
                                      className={`h-full rounded-full ${
                                        isCurrentMonth ? "bg-primary" : "bg-primary/60"
                                      }`}
                                      style={{ width: "100%" }}
                                    />
                                  )}
                                </div>
```

  and replace the dot fallback color. Replace:

```tsx
                                          backgroundColor: person?.color || "hsl(var(--month-primary))",
```

with:

```tsx
                                          backgroundColor: person?.color || "hsl(var(--primary))",
```

  and close the strip card — replace:

```tsx
                  </CardContent>
                </GlassCard>
              </motion.div>

              {/* Hero Card — Next Birthday */}
```

with:

```tsx
                  </CardContent>
                </Card>
              </motion.div>

              {/* Hero Card — Next Birthday */}
```

- [ ] Rebuild the hero card: flat `Card`, person-colored gradient, large `PersonAvatar`. Replace the entire hero block:

```tsx
                  <GlassCard className={`overflow-hidden ${nextDaysUntil === 0 ? "ring-2 ring-month-primary/50" : ""}`}>
                    <CardContent className="p-0">
                      <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-center gap-6">
                        {/* Decorative gradient */}
                        <div
                          className="absolute inset-0 opacity-10"
                          style={{
                            background: `radial-gradient(circle at 20% 50%, ${getCountdownColor(nextDaysUntil)}, transparent 70%)`,
                          }}
                        />
                        {/* Countdown Ring */}
                        <div className="relative shrink-0">
                          <CountdownRing
                            days={nextDaysUntil}
                            size={100}
                            strokeWidth={4}
                            color={getCountdownColor(nextDaysUntil)}
                            ariaLabel={t("daysSuffix", { count: nextDaysUntil })}
                          />
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            {nextDaysUntil === 0 ? (
                              <PartyPopper className="size-8 text-month-primary" />
                            ) : (
                              <>
                                <span className="text-kiosk-hero tabular-nums" style={{ color: getCountdownColor(nextDaysUntil) }}>
                                  {nextDaysUntil}
                                </span>
                                <span className="text-kiosk-label">
                                  {t("daysUnit", { count: nextDaysUntil })}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        {/* Info */}
                        <div className="relative text-center sm:text-left flex-1">
                          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                            {nextDaysUntil === 0 ? t("todayHero") : t("nextHero")}
                          </p>
                          <h2 className="text-2xl sm:text-3xl font-display font-light mb-1">
                            {nextBirthday.name}
                          </h2>
                          <div className="flex items-center justify-center sm:justify-start gap-3 text-muted-foreground">
                            <span className="flex items-center gap-1.5">
                              <Calendar className="size-3.5" />
                              {format(nextBirthdayDate, "d. MMMM", { locale: dateLocale })}
                            </span>
                            {nextBirthdayDate.getFullYear() < new Date().getFullYear() && (
                              <Badge variant="outline" className="text-xs">
                                {t("ageTurns", { age: nextUpcomingAge })}
                              </Badge>
                            )}
                            {nextPerson && (
                              <Badge
                                variant="outline"
                                className="text-xs"
                                style={{ borderColor: nextPerson.color, color: nextPerson.color }}
                              >
                                {nextPerson.name}
                              </Badge>
                            )}
                          </div>
                        </div>
                        {/* Gift icon */}
                        <div className="hidden sm:block relative">
                          {nextDaysUntil === 0 ? (
                            <PartyPopper className="size-12 text-month-primary/30" />
                          ) : (
                            <Gift className="size-12 text-white/10" />
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </GlassCard>
```

with:

```tsx
                  <Card className={`overflow-hidden ${nextDaysUntil === 0 ? "ring-2 ring-primary/50" : ""}`}>
                    <CardContent className="p-0">
                      <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-center gap-6">
                        {/* Person-colored gradient wash */}
                        <div
                          className="absolute inset-0 pointer-events-none"
                          style={{
                            background: `linear-gradient(135deg, ${personStrongTint(
                              nextPerson?.color || "hsl(var(--primary))",
                            )}, ${personTint(nextPerson?.color || "hsl(var(--primary))")} 70%, transparent)`,
                          }}
                        />
                        {/* Avatar / countdown */}
                        <div className="relative shrink-0">
                          {nextPerson ? (
                            <PersonAvatar
                              name={nextPerson.name}
                              color={nextPerson.color}
                              avatarUrl={nextPerson.avatar_url}
                              size={96}
                              ring
                            />
                          ) : (
                            <>
                              <CountdownRing
                                days={nextDaysUntil}
                                size={96}
                                strokeWidth={4}
                                color={getCountdownColor(nextDaysUntil)}
                                ariaLabel={t("daysSuffix", { count: nextDaysUntil })}
                              />
                              <div className="absolute inset-0 flex flex-col items-center justify-center">
                                {nextDaysUntil === 0 ? (
                                  <PartyPopper className="size-8 text-primary" strokeWidth={1.75} />
                                ) : (
                                  <>
                                    <span className="text-kiosk-hero tabular-nums" style={{ color: getCountdownColor(nextDaysUntil) }}>
                                      {nextDaysUntil}
                                    </span>
                                    <span className="text-kiosk-label">
                                      {t("daysUnit", { count: nextDaysUntil })}
                                    </span>
                                  </>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                        {/* Info */}
                        <div className="relative text-center sm:text-left flex-1">
                          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1 font-mono">
                            {nextDaysUntil === 0 ? t("todayHero") : t("nextHero")}
                          </p>
                          <h2 className="text-2xl sm:text-3xl font-display font-light mb-1">
                            {nextBirthday.name}
                          </h2>
                          <div className="flex items-center justify-center sm:justify-start gap-3 text-muted-foreground">
                            <span className="flex items-center gap-1.5 font-mono tabular-nums">
                              <Calendar className="size-3.5" strokeWidth={1.75} />
                              {format(nextBirthdayDate, "d. MMMM", { locale: dateLocale })}
                            </span>
                            {nextBirthdayDate.getFullYear() < new Date().getFullYear() && (
                              <Badge variant="outline" className="text-xs">
                                {t("ageTurns", { age: nextUpcomingAge })}
                              </Badge>
                            )}
                            {nextPerson && (
                              <Badge
                                variant="outline"
                                className="text-xs"
                                style={{ borderColor: nextPerson.color, color: nextPerson.color }}
                              >
                                {nextPerson.name}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-2 font-mono text-sm tabular-nums text-foreground">
                            {nextDaysUntil === 0 ? t("todayHero") : t("daysSuffix", { count: nextDaysUntil })}
                          </p>
                        </div>
                        {/* Gift icon (decorative) */}
                        <div className="hidden sm:block relative">
                          {nextDaysUntil === 0 ? (
                            <PartyPopper className="size-12 text-primary/30" strokeWidth={1.75} />
                          ) : (
                            <Gift className="size-12 text-muted-foreground/20" strokeWidth={1.75} />
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
```

- [ ] Convert the year-ring section: flat `Card`, pass new center props + responsive size, supply `avatarUrl`. Replace:

```tsx
                  <GlassCard>
                    <CardContent className="py-6 px-4">
                      <h3 className="text-kiosk-label mb-4 text-center">
                        {t("yearOverview")}
                      </h3>
                      <BirthdayYearRing
                        birthdays={sortedBirthdays.map((b) => {
                          const date = parseBirthdayDate(b.date);
                          const person = getPerson(b.person_id);
                          return {
                            id: b.id,
                            name: b.name,
                            date,
                            daysUntil: getDaysUntilBirthday(date),
                            color: person?.color || "hsl(var(--primary))",
                          };
                        })}
                      />
                    </CardContent>
                  </GlassCard>
```

with:

```tsx
                  <Card>
                    <CardContent className="py-6 px-4">
                      <h3 className="text-kiosk-label mb-4 text-center">
                        {t("yearOverview")}
                      </h3>
                      <div className="flex justify-center">
                        <div className="w-[300px] sm:w-[360px] lg:w-[420px]">
                          <BirthdayYearRing
                            size={420}
                            nextName={nextBirthday?.name}
                            nextAge={
                              nextBirthdayDate && nextBirthdayDate.getFullYear() < new Date().getFullYear()
                                ? nextUpcomingAge
                                : undefined
                            }
                            nextDaysUntil={nextDaysUntil}
                            birthdays={sortedBirthdays.map((b) => {
                              const date = parseBirthdayDate(b.date);
                              const person = getPerson(b.person_id);
                              return {
                                id: b.id,
                                name: b.name,
                                date,
                                daysUntil: getDaysUntilBirthday(date),
                                color: person?.color || "hsl(var(--primary))",
                                avatarUrl: person?.avatar_url,
                              };
                            })}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
```

  Note: the ring is given a fixed `size={420}` and wrapped in a responsive-width `<div>` whose `w-*` constrains the rendered SVG (the SVG has a `viewBox` so it scales to its container width). This delivers the ~420 desktop target and a smaller mobile footprint without changing the ring's internal placement math.

- [ ] Recolor the upcoming-list cards: flat `Card`, `primary` ring, `font-mono` date. Replace:

```tsx
                          <GlassCard className={`group hover:bg-white/[0.06] transition-all ${isToday ? "ring-1 ring-month-primary/40" : ""}`}>
                            <CardContent className="p-4">
                              <div className="flex items-center gap-3">
```

with:

```tsx
                          <Card className={`group hover:bg-accent/40 transition-colors ${isToday ? "ring-1 ring-primary/40" : ""}`}>
                            <CardContent className="p-4">
                              <div className="flex items-center gap-3">
```

  and make the upcoming-card date mono. Replace:

```tsx
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span>{format(date, "d. MMM", { locale: dateLocale })}</span>
                                    {date.getFullYear() < new Date().getFullYear() && (
                                      <span>{t("ageTurns", { age: upcomingAge })}</span>
                                    )}
                                  </div>
```

with:

```tsx
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="font-mono tabular-nums">{format(date, "d. MMM", { locale: dateLocale })}</span>
                                    {date.getFullYear() < new Date().getFullYear() && (
                                      <span>{t("ageTurns", { age: upcomingAge })}</span>
                                    )}
                                  </div>
```

  and close the upcoming card — replace:

```tsx
                            </CardContent>
                          </GlassCard>
                        </motion.div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* All Birthdays — Grouped by Month */}
```

with:

```tsx
                            </CardContent>
                          </Card>
                        </motion.div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* All Birthdays — Grouped by Month */}
```

- [ ] Recolor the later-by-month section: flat `Card`, `primary` month accents, mono date + decorative `Gift`. Replace the month-header accent block:

```tsx
                      <div className="flex items-center gap-3 mb-2 px-1">
                        <div className="flex items-center justify-center size-7 rounded-lg bg-month-primary/15">
                          <Cake className="size-3.5 text-month-primary" />
                        </div>
                        <span className="text-sm font-semibold text-month-primary">
                          {months[month]}
                        </span>
```

with:

```tsx
                      <div className="flex items-center gap-3 mb-2 px-1">
                        <div className="flex items-center justify-center size-7 rounded-lg bg-primary/15">
                          <Cake className="size-3.5 text-primary" strokeWidth={1.75} />
                        </div>
                        <span className="text-sm font-semibold text-primary">
                          {months[month]}
                        </span>
```

  and convert the month-list `GlassCard` + row hover. Replace:

```tsx
                      <GlassCard>
                        <CardContent className="p-0">
                          <AnimatePresence mode="popLayout">
                            <div className="divide-y divide-border">
```

with:

```tsx
                      <Card>
                        <CardContent className="p-0">
                          <AnimatePresence mode="popLayout">
                            <div className="divide-y divide-border">
```

  and recolor the row hover. Replace:

```tsx
                                    className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 hover:bg-white/[0.04] transition-all group"
```

with:

```tsx
                                    className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 hover:bg-accent/40 transition-colors group"
```

  and make the month-row date mono + add a decorative `Gift`. Replace:

```tsx
                                        <span className="flex items-center gap-1">
                                          <Calendar className="size-3 shrink-0" />
                                          <span className="whitespace-nowrap">
                                            {format(date, "d. MMM", { locale: dateLocale })}
                                          </span>
```

with:

```tsx
                                        <span className="flex items-center gap-1">
                                          <Gift className="size-3 shrink-0" strokeWidth={1.75} />
                                          <span className="whitespace-nowrap font-mono tabular-nums">
                                            {format(date, "d. MMM", { locale: dateLocale })}
                                          </span>
```

  and make the right-hand days label mono (already `tabular-nums`; add `font-mono`). Replace:

```tsx
                                    <div className="text-right shrink-0">
                                      <p className="text-sm text-muted-foreground tabular-nums">
                                        {t("daysSuffix", { count: daysUntil })}
                                      </p>
                                    </div>
```

with:

```tsx
                                    <div className="text-right shrink-0">
                                      <p className="text-sm text-muted-foreground tabular-nums font-mono">
                                        {t("daysSuffix", { count: daysUntil })}
                                      </p>
                                    </div>
```

  and close the month-list card. Replace:

```tsx
                          </AnimatePresence>
                        </CardContent>
                      </GlassCard>
                    </motion.div>
                  ))}
```

with:

```tsx
                          </AnimatePresence>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
```

- [ ] Add the new i18n keys. In `webapp/messages/en.json`, replace:

```json
    "birthdayYearRing": {
      "centerLabel": "Birthdays"
    }
```

with:

```json
    "birthdayYearRing": {
      "centerLabel": "Birthdays",
      "centerTurns": "turns {age}",
      "centerInDays": "{count, plural, one {in # day} other {in # days}}"
    }
```

  In `webapp/messages/de.json`, replace:

```json
    "birthdayYearRing": {
      "centerLabel": "Geburtstage"
    }
```

with:

```json
    "birthdayYearRing": {
      "centerLabel": "Geburtstage",
      "centerTurns": "wird {age}",
      "centerInDays": "{count, plural, one {in # Tag} other {in # Tagen}}"
    }
```

  In `webapp/messages/fr.json`, replace:

```json
    "birthdayYearRing": {
      "centerLabel": "Anniversaires"
    }
```

with:

```json
    "birthdayYearRing": {
      "centerLabel": "Anniversaires",
      "centerTurns": "aura {age} ans",
      "centerInDays": "{count, plural, one {dans # jour} other {dans # jours}}"
    }
```

- [ ] Add the notes FAB aria key. In `webapp/messages/en.json`, in the `"notes"` block replace:

```json
    "toastPinFailed": "Failed to change pin status"
  },
```

with:

```json
    "toastPinFailed": "Failed to change pin status",
    "fabAria": "New note"
  },
```

  In `webapp/messages/de.json`, find the `"notes"` block's last key (`"toastPinFailed"`) and append `"fabAria": "Neue Notiz"` the same way (add a comma to the prior line, then the new line before the block's closing `},`).

  In `webapp/messages/fr.json`, do the same with `"fabAria": "Nouvelle note"`.

- [ ] Add the changelog entry. In `CHANGELOG.md`, under `## [Unreleased]`, add to the `### Changed` section (create it if absent, keeping Keep-a-Changelog section order Added/Changed/Fixed):

```markdown
### Changed
- Notes page redesigned as a warm-pastel sticky-note board (flat masonry, slight per-note rotation, mono dates) following the Salbei/Leinen design; removed glassmorphism. Added a mobile add button.
- Birthdays year-ring now shows family-member avatars on the ring and the next birthday in its center ("Name · turns N · in X days"); the page is flat (no glass) and the next-birthday hero uses the linked person's color.
```

  and add a `### Notes` block (Keep-a-Changelog allows custom sections at the end of the release):

```markdown
### Notes
- Deferred: per-note author dot (needs a `notes.person_id` schema migration) and birthday gift-ideas list (needs a `gift_ideas` table). The Gift icon on birthdays is decorative only. Both require DB migrations and are out of scope for this visual redesign.
```

- [ ] Run the gate:

```bash
cd webapp && npm run lint && npx tsc --noEmit
```

Expected: PASS. (Also confirm EN/DE/FR key parity by eye — the i18n CI job compares key sets; the three files received identical key additions.)

- [ ] Commit:

```bash
git add webapp/src/app/birthdays/page.tsx webapp/messages/en.json webapp/messages/de.json webapp/messages/fr.json CHANGELOG.md
git commit -m "feat(birthdays): flat page redesign — person-colored hero, avatar year-ring, mono countdowns; i18n + changelog"
```

---

## Self-Review

**Scope-item → task mapping**
1. Notes restyle (masonry, deterministic tint+rotation helper, mono date, search/add/pin/edit/delete kept, `.page-gradient`, `month-primary`→`primary`, mobile FAB, author dot DEFERRED) → **Task 1** (+ `note-style.ts`). FAB aria key lands in **Task 4**.
2. BirthdayYearRing restyle (size bump, avatar marks, next-birthday highlight + center props, theme tokens, reduced-motion static) → **Task 3**.
3. Birthdays page restyle (GlassCard→Card everywhere, flat year-strip, person-colored hero with `PersonAvatar`, ring center props + ~420 responsive size + avatarUrl, mono countdowns + decorative `Gift`, `month-primary`→`primary`) → **Task 4**; duplicated date utils extracted to `lib/birthday.ts` and rewired in page + widget → **Task 2**.
4. i18n (`components.birthdayYearRing.centerTurns`/`centerInDays`, `notes.fabAria`) in EN/DE/FR parity + changelog (Changed + Notes deferral) → **Task 4**.

**Type-consistency check**
- `noteStyle(id)` returns `{ tintVar: string; rotateDeg: number }`; consumed via inline `style` `backgroundColor`/`transform` — both string/number, valid.
- `BirthdayDot.avatarUrl?: string | null`; page supplies `person?.avatar_url` (`string | null`) — matches. Ring guards with `startsWith` only when truthy.
- New ring props `nextName?: string`, `nextAge?: number`, `nextDaysUntil?: number` — page passes `nextBirthday?.name` (`string | undefined`), a conditional `number | undefined`, and `nextDaysUntil` (`number`) — all match. Center falls back to count when `nextName` is undefined.
- `PersonAvatar` `avatarUrl` accepts `string | null | undefined`; `nextPerson.avatar_url` is `string | null` — matches.
- `personTint`/`personStrongTint` take a hex/color string and return a `color-mix(...)` string; the hero passes `nextPerson?.color || "hsl(var(--primary))"` — both valid CSS color inputs to `color-mix`.
- `lib/birthday.ts` helpers are byte-identical to the originals (same date-fns calls), so refactor is behavior-preserving; `calculateUpcomingAge` (widget-only) still compiles against the imported `getNextBirthday`.
- Removed imports verified per task: `formatDistanceToNow` (notes), `motion` (ring), and the moved date-fns names (page + widget) — each removal paired with confirmation that no remaining reference exists.

**Deferrals (flagged)**
- **Note author dot** — DEFERRED. `notes` has no `person_id`/color; needs a schema migration + hook change. Sticky look built without it. Recorded in changelog `### Notes`.
- **Gift-ideas data feature** — DEFERRED. No `gift_ideas` table; `Gift` icon kept decorative only. Recorded in changelog `### Notes`.
- **i18n key-before-component sequencing** — new next-intl keys are added in Task 4 while consumed in Tasks 1/3. next-intl missing keys are a runtime warning, not a tsc/lint failure, so per-task gates still pass; the i18n CI parity job only checks key-set equality across locales, which Task 4 satisfies. Execute tasks in order (1→2→3→4) so the branch is parity-clean at the final commit.
