# Plan 4 — Redesign: Calendar Route ("Salbei/Leinen")

For agentic workers: use superpowers:subagent-driven-development.

## Goal
Reskin the calendar route (`/calendar`) to the "Salbei/Leinen" redesign: remove glassmorphism, flatten every surface to linen `Card`/tokens, restyle month-view day cells (flat `bg-card`, weekend `bg-muted/30`, dashed other-month, `border-2 border-primary` + ring + primary-circle for today) and week-view blocks via `EventPill`/person-color helpers, convert the sidebar to `EventPill variant="agenda"` cards, add a `PersonChip` person-filter row, **show waste-collection events** (currently filtered out) with a `Trash2` icon, swap `month-primary` tokens to `primary`/`ring`, add a mobile `FAB`, and verify the inset-segment view switcher. No data-model or hook changes; this is the visual layer plus one deliberate behavior change (waste events become visible).

## Architecture
- `webapp/src/app/calendar/page.tsx` — 1527-line `"use client"` route. Holds all state (`currentDate`/`selectedDate`/`view`/dialogs), the event-transform `useMemo`, the topbar, the monthly-stats bar, the `grid xl:grid-cols-4` (calendar + sidebar agenda), and three inline `Dialog`s (add/edit/detail). We add a `selectedPersonIds` filter set + `PersonChip` row, un-filter waste, swap glass/`month-primary` tokens, and add a mobile `FAB`.
- `webapp/src/components/calendar/month-view.tsx` — `MonthView`. KW col + 7-day grid; day cells + desktop event chips + mobile dots. We add `is_waste_collection` to its event interface, flatten the wrapper + cells, and render `EventPill` chips (with `Trash2` for waste).
- `webapp/src/components/calendar/week-view.tsx` — `WeekView`. All-day bar row + timed-block grid. We flatten the wrapper, replace `text-white` blocks with `personStrongTint`/`personText`, swap `month-primary` → `primary`.
- Reused (shipped, do NOT rebuild): `EventPill` (`@/components/event-pill`), `PersonChip` (`@/components/person-chip`), `FAB` (`@/components/fab`), `Card`/`CardContent` (`@/components/ui/card`), `Tabs` (`@/components/ui/tabs`, already inset-segment), person-color helpers (`@/lib/person-color`). Utilities `.page-gradient`, `.fab-above-nav`, `.elev-md`, `.safe-area-inset` from `globals.css`.

## Tech Stack
Next.js 16 App Router, React 19, TypeScript, Tailwind, shadcn/ui, framer-motion, next-intl (EN/DE/FR — key parity is a CI gate), date-fns.

## Global Constraints
- No `next build` locally. Per-task gate: `cd webapp && npm run lint` and `npx tsc --noEmit`. No unit tests — verification is lint+tsc+structural self-review; live visual smoke deferred to the user. Do NOT write Jest/RTL/TDD steps.
- Reuse Foundation + Plan 2/3 components; never hardcode accent hex (primary/tints or person-color via inline color-mix/personText helpers; functional colors like the red "now" line may stay if documented); `text-primary-foreground` not literal `text-white` on month/primary surfaces; person-colored event text uses `personText(color)`.
- NO glass/backdrop-blur on app surfaces (this plan REMOVES it from the calendar).
- Touch targets ≥44px (kiosk ≥56-64). Lucide stroke 1.75. Times/numbers `tabular-nums`/`font-mono`.
- Motion 120/220/320ms; respect `prefers-reduced-motion`; sparse on kiosk.
- next-intl EN/DE/FR parity (CI gate) — every new key in all three.
- Commits: Conventional Commits, NO `Co-Authored-By: Claude` trailer. One commit per task.

---

### Task 1 — Page-level glass removal, flat surfaces, token cleanup

**Files**
- Modify: `webapp/src/app/calendar/page.tsx`

**Interfaces**
- Consumes: `Card`, `CardContent` from `@/components/ui/card` (replace `GlassCard`); existing `Badge`; `.page-gradient` utility.
- Produces: page chrome with no glass and no `month-primary` literals; stat chips on `bg-muted`. (Sidebar internals are deferred to Task 4; this task only swaps its outer `GlassCard` wrapper + `month-primary` tokens in the now-line/now-badge/empty-icon.)

Steps:

- [ ] Change the import on line 42 from `GlassCard` to `Card` + `CardContent`:
  ```tsx
  import { Card, CardContent } from "@/components/ui/card";
  ```
- [ ] Replace the fixed background gradient (line 396) with the centralized utility:
  ```tsx
        {/* Background */}
        <div className="page-gradient" />
  ```
  (Replaces `<div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none" />`.)
- [ ] Replace the no-calendars banner `GlassCard` (lines 417–431). The exact block to replace:
  ```tsx
            {!loadingCalendars && !calendarsError && calendars && calendars.length === 0 && (
              <GlassCard className="p-4 mb-4 border-month-primary/30 bg-month-primary/5">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{t("noCalendarsBannerTitle")}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("noCalendarsBannerDescription")}
                    </p>
                  </div>
                  <Button variant="month" size="sm" asChild className="shrink-0">
                    <Link href="/settings/calendar">{t("noCalendarsBannerAction")}</Link>
                  </Button>
                </div>
              </GlassCard>
            )}
  ```
  with:
  ```tsx
            {!loadingCalendars && !calendarsError && calendars && calendars.length === 0 && (
              <Card className="mb-4 border-primary/30">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{t("noCalendarsBannerTitle")}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("noCalendarsBannerDescription")}
                    </p>
                  </div>
                  <Button size="sm" asChild className="shrink-0">
                    <Link href="/settings/calendar">{t("noCalendarsBannerAction")}</Link>
                  </Button>
                </CardContent>
              </Card>
            )}
  ```
- [ ] In the monthly-stats bar, replace the four `bg-white/5` / `bg-*-500/10` stat chips with `bg-muted` chips. Replace the block (lines 733–749) — the four chip `<div>`s — with:
  ```tsx
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-lg">
                  <CalendarIcon className="size-3" />
                  <span className="font-medium text-foreground tabular-nums">{regularEvents.length}</span> {t("statsEvents")}
                </div>
                {holidays.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-lg">
                    <span className="font-medium text-foreground tabular-nums">{holidays.length}</span> {t("statsHolidays")}
                  </div>
                )}
                {allDayEvents.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-lg">
                    <span className="font-medium text-foreground tabular-nums">{allDayEvents.length}</span> {t("statsAllDay")}
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-lg">
                  <span className="font-medium text-foreground tabular-nums">{uniqueDaysWithEvents}</span> {t("statsActiveDays")}
                </div>
  ```
- [ ] Replace the error-state `GlassCard` (lines 762–770). Replace:
  ```tsx
              {error ? (
                <GlassCard className="p-4">
                  <ErrorState
  ```
  with:
  ```tsx
              {error ? (
                <Card className="p-4">
                  <ErrorState
  ```
  and the matching close tag a few lines down — replace `</GlassCard>` (line 770) with `</Card>`.
- [ ] Replace the loading-state `GlassCard` (lines 772–774). Replace:
  ```tsx
              ) : isLoading ? (
                <GlassCard className="p-4">
                  <CalendarSkeleton view={view} />
                </GlassCard>
  ```
  with:
  ```tsx
              ) : isLoading ? (
                <Card className="p-4">
                  <CalendarSkeleton view={view} />
                </Card>
  ```
- [ ] Replace the sidebar wrapper `GlassCard` open tag (line 802):
  ```tsx
              <Card className="p-4 h-full">
  ```
  (replaces `<GlassCard className="p-4 h-full">`) and its closing `</GlassCard>` (line 1139) with `</Card>`.
- [ ] Within the sidebar, swap the remaining `month-primary` tokens to `primary` and the `bg-white/5` hover surfaces to `hover:bg-accent/50`. Specifically:
  - Line 883 now-line dot+line: replace `bg-month-primary` (both occurrences) with `bg-primary`:
    ```tsx
                                      <div className="size-2 rounded-full bg-primary -ml-1 shrink-0" />
                                      <div className="h-px bg-primary flex-1" />
    ```
  - Line 905 ongoing-block ring: replace `ring-1 ring-month-primary/60` with `ring-1 ring-primary/60`.
  - Line 951 empty-state icon: replace `text-month-primary/20` with `text-primary/20`.
  - Line 979 upcoming-preview hover: replace `hover:bg-white/5` with `hover:bg-accent/50`.
  - Line 1035 all-day card hover: replace `hover:bg-white/5` with `hover:bg-accent/50`.
  - Line 1088 timed-detail card hover: replace `hover:bg-white/5` with `hover:bg-accent/50`.
  - Line 1089 ongoing ring: replace `ring-1 ring-month-primary/40` with `ring-1 ring-primary/40`.
  - Lines 1099–1102 "Jetzt" live indicator: replace all four `month-primary` occurrences with `primary`:
    ```tsx
                                      <span className="flex items-center gap-1 text-xs text-primary shrink-0">
                                        <span className="relative flex size-2">
                                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                                          <span className="relative inline-flex rounded-full size-2 bg-primary" />
                                        </span>
                                        {t("nowBadge")}
                                      </span>
    ```
  (Detail-dialog cards in Task 4 are restyled fully; the per-event `EventPill`/agenda swap is Task 4. This task leaves the sidebar list markup intact apart from the token/glass swaps above.)
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected PASS.
- [ ] Commit: `git commit -m "refactor(calendar): flatten page surfaces, drop glass + month-primary tokens"`

---

### Task 2 — Month-view: flat cells, today ring, EventPill chips, waste icon

**Files**
- Modify: `webapp/src/components/calendar/month-view.tsx`

**Interfaces**
- Consumes: `EventPill` from `@/components/event-pill`; `Card`, `CardContent` from `@/components/ui/card`; `Trash2` from `lucide-react`.
- Produces: flat month grid. Adds `is_waste_collection?: boolean` to the local `CalendarEvent` interface so the page can pass the flag (waste un-filtered in Task 6). Holiday chips render neutral (no icon); waste chips render with `Trash2`.

Steps:

- [ ] Replace the `GlassCard` import (line 23) with flat card primitives and add `EventPill` + `Trash2`:
  ```tsx
  import { Card, CardContent } from "@/components/ui/card";
  import { Trash2 } from "lucide-react";
  import { EventPill } from "@/components/event-pill";
  ```
  (Remove the `import { GlassCard } from "@/components/ui/card";` line.)
- [ ] Extend the local `CalendarEvent` interface (lines 30–41) — add a waste flag after `is_holiday`:
  ```tsx
  interface CalendarEvent {
    id: string;
    title: string;
    start: Date;
    end: Date;
    allDay: boolean;
    color: string;
    location?: string;
    description?: string;
    person_id?: string;
    is_holiday?: boolean;
    is_waste_collection?: boolean;
  }
  ```
- [ ] Replace the wrapper open tag (line 113) `<GlassCard className="p-2 sm:p-4">` with:
  ```tsx
    <Card>
      <CardContent className="p-2 sm:p-4">
  ```
  and the matching close tag (line 274) `</GlassCard>` with:
  ```tsx
      </CardContent>
    </Card>
  ```
- [ ] Replace the day-cell `className` template (the `motion.button` `className`, lines 168–177) to use flat linen tokens, dashed other-month days, weekend darkening, and a primary today treatment. Replace:
  ```tsx
                    className={`
                      relative min-h-[3.5rem] sm:min-h-[5rem] p-0.5 sm:p-1 text-left transition-all overflow-hidden
                      ${dayIndex > 0 ? "border-l border-border/20" : ""}
                      ${isCurrentMonth ? "" : "opacity-25"}
                      ${isSelected && !isDayToday ? "ring-2 ring-inset ring-month-primary/50 bg-month-primary/5" : ""}
                      ${isSelected && isDayToday ? "ring-2 ring-inset ring-month-primary bg-month-primary/10" : ""}
                      ${!isSelected ? "hover:bg-white/[0.04]" : ""}
                      ${isDayToday && !isSelected ? "bg-month-primary/[0.08]" : ""}
                      ${dayIndex >= 5 && !isDayToday && !isSelected ? "bg-white/[0.02]" : ""}
                    `}
  ```
  with:
  ```tsx
                    className={`
                      relative min-h-[3.5rem] sm:min-h-[5rem] p-0.5 sm:p-1 text-left transition-all overflow-hidden
                      ${dayIndex > 0 ? "border-l border-border/20" : ""}
                      ${isCurrentMonth ? "" : "opacity-40 [&_span]:border-dashed"}
                      ${isDayToday ? "ring-2 ring-inset ring-primary bg-primary/[0.06]" : ""}
                      ${isSelected && !isDayToday ? "ring-2 ring-inset ring-primary/50 bg-primary/5" : ""}
                      ${!isSelected && !isDayToday ? "hover:bg-accent/50" : ""}
                      ${dayIndex >= 5 && !isDayToday && !isSelected ? "bg-muted/30" : ""}
                    `}
  ```
  Note: the mockup renders other-month days with a dashed *cell* border, but cell borders here are the shared grid `border-l`/`border-b`. To stay bounded we mark the day-number circle dashed + muted via `opacity-40`; document that the cell-level dashed border is approximated by muting (no new per-cell border element). The today ring replaces the old today/selected-today background.
- [ ] Replace the day-number `<span>` (lines 180–188) so today's number is a filled primary circle using `text-primary-foreground` (not literal white), with `tabular-nums`:
  ```tsx
                    {/* Day Number */}
                    <div className="flex items-center gap-0.5 mb-0.5">
                      <span
                        className={`
                          inline-flex items-center justify-center size-5 sm:size-6 rounded-full text-[10px] sm:text-xs font-medium tabular-nums shrink-0
                          ${isDayToday ? "bg-primary text-primary-foreground font-bold" : ""}
                        `}
                      >
                        {format(day, "d")}
                      </span>
                      {holidayEvent && (
                        <span className="hidden sm:inline text-[8px] text-muted-foreground truncate leading-none">
                          {holidayEvent.title}
                        </span>
                      )}
                    </div>
  ```
  (Holiday inline text switched from `text-destructive/60` to neutral `text-muted-foreground` per spec "Feiertage neutral".)
- [ ] Replace the desktop event-chip render (lines 199–247, the `<div className="hidden sm:flex sm:flex-col sm:gap-px">` block) to use `EventPill` wrapped in the tooltip + click handler. Replace:
  ```tsx
                      <div className="hidden sm:flex sm:flex-col sm:gap-px">
                        {visibleEvents.map((event) => {
                          const isMulti = isMultiDayOrAllDay(event);
                          return (
                            <Tooltip key={event.id}>
                              <TooltipTrigger asChild>
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectEvent(event);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      onSelectEvent(event);
                                    }
                                  }}
                                  className="text-xs leading-tight px-1.5 py-0.5 rounded truncate cursor-pointer hover:opacity-80 transition-opacity text-foreground/80"
                                  style={{
                                    backgroundColor: `${event.color}20`,
                                    borderLeft: `2px solid ${event.color}`,
                                  }}
                                >
                                  {event.title}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="font-medium">{event.title}</p>
                                <p className="text-xs opacity-70">
                                  {isMulti
                                    ? `${format(event.start, "d. MMM", { locale: dateLocale })} - ${format(event.end, "d. MMM", { locale: dateLocale })}`
                                    : `${format(event.start, "HH:mm")} - ${format(event.end, "HH:mm")}`}
                                </p>
                                {event.location && (
                                  <p className="text-xs opacity-70">{event.location}</p>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                        {overflowCount > 0 && (
                          <div className="text-[11px] text-muted-foreground/70 pl-1.5 font-medium">
                            {t("monthView.moreCount", { count: overflowCount })}
                          </div>
                        )}
                      </div>
  ```
  with:
  ```tsx
                      <div className="hidden sm:flex sm:flex-col sm:gap-px">
                        {visibleEvents.map((event) => {
                          const isMulti = isMultiDayOrAllDay(event);
                          return (
                            <Tooltip key={event.id}>
                              <TooltipTrigger asChild>
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectEvent(event);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      onSelectEvent(event);
                                    }
                                  }}
                                  className="cursor-pointer transition-opacity hover:opacity-80"
                                >
                                  <EventPill
                                    title={event.title}
                                    color={event.color}
                                    icon={event.is_waste_collection ? Trash2 : undefined}
                                  />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="font-medium">{event.title}</p>
                                <p className="text-xs opacity-70">
                                  {isMulti
                                    ? `${format(event.start, "d. MMM", { locale: dateLocale })} - ${format(event.end, "d. MMM", { locale: dateLocale })}`
                                    : `${format(event.start, "HH:mm")} - ${format(event.end, "HH:mm")}`}
                                </p>
                                {event.location && (
                                  <p className="text-xs opacity-70">{event.location}</p>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                        {overflowCount > 0 && (
                          <div className="text-[11px] text-muted-foreground/70 pl-1.5 font-medium">
                            {t("monthView.moreCount", { count: overflowCount })}
                          </div>
                        )}
                      </div>
  ```
  (The mobile dots block, lines 250–265, is unchanged — dots already use `event.color`, matching the mockup's person-colored dots.)
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected PASS.
- [ ] Commit: `git commit -m "feat(calendar): flat month-view cells with primary today ring and EventPill chips"`

---

### Task 3 — Week-view: flat container, token swap, legible person-colored blocks

**Files**
- Modify: `webapp/src/components/calendar/week-view.tsx`

**Interfaces**
- Consumes: `Card`, `CardContent` from `@/components/ui/card`; `personStrongTint`, `personText` from `@/lib/person-color`.
- Produces: flat week grid; today header in `text-primary`; all-day bars + timed blocks tinted via person-color helpers (no literal `text-white`). Current-time line stays `bg-red-500` (functional color, documented).

Steps:

- [ ] Replace the `GlassCard` import (line 22) and add person-color helpers:
  ```tsx
  import { Card, CardContent } from "@/components/ui/card";
  import { personStrongTint, personText } from "@/lib/person-color";
  ```
  (Remove `import { GlassCard } from "@/components/ui/card";`.)
- [ ] Replace the wrapper open tag (line 125) `<GlassCard className="p-4 overflow-hidden">` with:
  ```tsx
    <Card className="overflow-hidden">
      <CardContent className="p-4">
  ```
  and the matching close tag (line 338) `</GlassCard>` with:
  ```tsx
      </CardContent>
    </Card>
  ```
- [ ] Restyle the day-header button (lines 134–153): swap `bg-month-primary/10`/`hover:bg-white/5` to tokens, and the today number circle to `text-primary` + `bg-primary text-primary-foreground`. Replace:
  ```tsx
            <button
              key={day.toISOString()}
              onClick={() => onSelectDate(day)}
              className={`text-center py-2 rounded-lg transition-all ${
                isSelected ? "bg-month-primary/10" : "hover:bg-white/5"
              }`}
            >
              <div className="text-xs text-muted-foreground">
                {format(day, "EEE", { locale: dateLocale })}
              </div>
              <div
                className={`text-lg font-medium ${
                  isDayToday
                    ? "size-8 mx-auto flex items-center justify-center rounded-full bg-month-primary text-white"
                    : ""
                }`}
              >
                {format(day, "d")}
              </div>
            </button>
  ```
  with:
  ```tsx
            <button
              key={day.toISOString()}
              onClick={() => onSelectDate(day)}
              className={`text-center py-2 rounded-lg transition-all ${
                isSelected ? "bg-primary/10" : "hover:bg-accent/50"
              }`}
            >
              <div className={`text-xs ${isDayToday ? "text-primary font-medium" : "text-muted-foreground"}`}>
                {format(day, "EEE", { locale: dateLocale })}
              </div>
              <div
                className={`text-lg font-medium tabular-nums ${
                  isDayToday
                    ? "size-8 mx-auto flex items-center justify-center rounded-full bg-primary text-primary-foreground"
                    : ""
                }`}
              >
                {format(day, "d")}
              </div>
            </button>
  ```
- [ ] Restyle the all-day/multi-day bars (lines 187–198): remove `text-white`, tint via person-color helpers, keep the rounded-segment logic. Replace:
  ```tsx
                          className={`text-xs px-1.5 py-1 sm:py-0.5 truncate cursor-pointer hover:opacity-90 text-white font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 outline-none ${
                            isStart && isEnd ? "rounded" :
                            isStart ? "rounded-l -mr-1" :
                            isEnd ? "rounded-r -ml-1" :
                            "-mx-1"
                          }`}
                          style={{
                            backgroundColor: event.color,
                          }}
  ```
  with:
  ```tsx
                          className={`text-xs px-1.5 py-1 sm:py-0.5 truncate cursor-pointer hover:opacity-90 font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 outline-none ${
                            isStart && isEnd ? "rounded" :
                            isStart ? "rounded-l -mr-1" :
                            isEnd ? "rounded-r -ml-1" :
                            "-mx-1"
                          }`}
                          style={{
                            backgroundColor: personStrongTint(event.color),
                            color: personText(event.color),
                          }}
  ```
- [ ] Document the current-time indicator: it stays `bg-red-500` (lines 271–272). This is a functional "now" color (matches the sidebar previously, and is the universally-recognised current-time hue); the Global Constraints permit documented functional colors. No change.
- [ ] Restyle the timed event blocks (lines 296–317): remove `text-white`/`text-white/80`/`text-white/70`, tint via helpers, keep the 3px left border. Replace:
  ```tsx
                          className="absolute left-1 right-1 p-1 sm:p-1.5 rounded cursor-pointer hover:opacity-90 transition-opacity overflow-hidden z-10 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                          style={{
                            top,
                            height,
                            backgroundColor: `${event.color}90`,
                            borderLeft: `3px solid ${event.color}`,
                          }}
                        >
                          <p className="text-xs font-medium text-white truncate">
                            {event.title}
                          </p>
                          {height > 40 && (
                            <p className="text-[10px] text-white/80">
                              {format(event.start, "HH:mm")} -{" "}
                              {format(event.end, "HH:mm")}
                            </p>
                          )}
                          {height > 60 && event.location && (
                            <p className="text-[10px] text-white/70 truncate">
                              {event.location}
                            </p>
                          )}
  ```
  with:
  ```tsx
                          className="absolute left-1 right-1 p-1 sm:p-1.5 rounded cursor-pointer hover:opacity-90 transition-opacity overflow-hidden z-10 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                          style={{
                            top,
                            height,
                            backgroundColor: personStrongTint(event.color),
                            borderLeft: `3px solid ${event.color}`,
                            color: personText(event.color),
                          }}
                        >
                          <p className="text-xs font-semibold truncate">
                            {event.title}
                          </p>
                          {height > 40 && (
                            <p className="text-[10px] font-mono tabular-nums opacity-80">
                              {format(event.start, "HH:mm")} -{" "}
                              {format(event.end, "HH:mm")}
                            </p>
                          )}
                          {height > 60 && event.location && (
                            <p className="text-[10px] opacity-70 truncate">
                              {event.location}
                            </p>
                          )}
  ```
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected PASS.
- [ ] Commit: `git commit -m "feat(calendar): flat week-view with token colors and legible person-tinted blocks"`

---

### Task 4 — Sidebar agenda: EventPill agenda cards + token cleanup

**Files**
- Modify: `webapp/src/app/calendar/page.tsx`

**Interfaces**
- Consumes: `EventPill` from `@/components/event-pill`; existing `Badge`. The detail/edit/all-day-card click handlers stay; only the timed-event detail list (lines 1062–1133) is rewritten to use `EventPill variant="agenda"` (4px left person border + mono time + title), preserving keyboard handlers and the "Jetzt"/upcoming-soon indicators.
- Produces: flat agenda cards matching the mobile mockup (4px left person border, mono time). Holiday badge + "Jetzt" live indicator already retokenized to `primary` in Task 1.

Steps:

- [ ] Add the `EventPill` import next to the other `@/components/...` imports (after line 80, `import { PageHeader } from "@/components/page-header";`):
  ```tsx
  import { EventPill } from "@/components/event-pill";
  ```
- [ ] Replace the timed-event detail list (lines 1062–1134, the `{selectedDateEvents.filter(e => !e.allDay).length > 0 && (...)}` block) so each event renders an `EventPill variant="agenda"` with the person color, the start time as `time`, and `Trash2` for waste, while keeping the wrapping `motion.div` (which carries the click/keydown handlers and the ongoing/past styling) and the meta (location, person badge, Jetzt indicator) beneath. Replace:
  ```tsx
                        {/* Timed event details (shown below timeline) */}
                        {selectedDateEvents.filter(e => !e.allDay).length > 0 && (
                          <div className="flex flex-col gap-2">
                            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">{t("detailsHeading")}</p>
                            {selectedDateEvents.filter(e => !e.allDay).map((event, index) => {
                              const person = getPersonById(event.person_id);
                              const now = new Date();
                              const isOngoing = isWithinInterval(now, { start: event.start, end: event.end });
                              const isUpcomingSoon = !isOngoing && isBefore(now, event.start) && isSameDay(now, displayDate) && differenceInMinutes(event.start, now) <= 60;
                              const minutesUntil = isBefore(now, event.start) ? differenceInMinutes(event.start, now) : 0;
                              const isPast = isAfter(now, event.end) && isSameDay(now, displayDate);
                              return (
                                <motion.div
                                  key={event.id}
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: index * 0.05 }}
                                  role="button"
                                  tabIndex={0}
                                  aria-label={`${event.title}, ${format(event.start, "HH:mm")} - ${format(event.end, "HH:mm")}${event.location ? `, ${event.location}` : ""}${isOngoing ? `, ${t("ongoingAria")}` : ""}`}
                                  onClick={() => setSelectedEvent(event)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      setSelectedEvent(event);
                                    }
                                  }}
                                  className={`p-3 rounded-xl cursor-pointer hover:bg-accent/50 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                                    isOngoing ? "ring-1 ring-primary/40" : ""
                                  } ${isPast ? "opacity-50" : ""}`}
                                  style={{
                                    backgroundColor: `${event.color}15`,
                                    borderLeft: `3px solid ${event.color}`,
                                  }}
                                >
                                  <div className="flex items-center gap-2">
                                    <p className="font-medium flex-1 truncate">{event.title}</p>
                                    {isOngoing && (
                                      <span className="flex items-center gap-1 text-xs text-primary shrink-0">
                                        <span className="relative flex size-2">
                                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                                          <span className="relative inline-flex rounded-full size-2 bg-primary" />
                                        </span>
                                        {t("nowBadge")}
                                      </span>
                                    )}
                                    {isUpcomingSoon && minutesUntil > 0 && (
                                      <span className="text-xs text-amber-400 shrink-0">
                                        {t("inMinutes", { minutes: minutesUntil })}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                                    <span className="flex items-center gap-1">
                                      <Clock className="size-3" />
                                      {format(event.start, "HH:mm")} – {format(event.end, "HH:mm")}
                                    </span>
                                  </div>
                                  {event.location && (
                                    <p className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                                      <MapPin className="size-3" />
                                      {event.location}
                                    </p>
                                  )}
                                  {person && (
                                    <Badge variant="outline" className="mt-2 text-xs" style={{ borderColor: person.color, color: person.color }}>
                                      {person.name}
                                    </Badge>
                                  )}
                                </motion.div>
                              );
                            })}
                          </div>
                        )}
  ```
  with:
  ```tsx
                        {/* Timed event details (shown below timeline) */}
                        {selectedDateEvents.filter(e => !e.allDay).length > 0 && (
                          <div className="flex flex-col gap-2">
                            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">{t("detailsHeading")}</p>
                            {selectedDateEvents.filter(e => !e.allDay).map((event, index) => {
                              const person = getPersonById(event.person_id);
                              const now = new Date();
                              const isOngoing = isWithinInterval(now, { start: event.start, end: event.end });
                              const isUpcomingSoon = !isOngoing && isBefore(now, event.start) && isSameDay(now, displayDate) && differenceInMinutes(event.start, now) <= 60;
                              const minutesUntil = isBefore(now, event.start) ? differenceInMinutes(event.start, now) : 0;
                              const isPast = isAfter(now, event.end) && isSameDay(now, displayDate);
                              return (
                                <motion.div
                                  key={event.id}
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: index * 0.05 }}
                                  role="button"
                                  tabIndex={0}
                                  aria-label={`${event.title}, ${format(event.start, "HH:mm")} - ${format(event.end, "HH:mm")}${event.location ? `, ${event.location}` : ""}${isOngoing ? `, ${t("ongoingAria")}` : ""}`}
                                  onClick={() => setSelectedEvent(event)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      setSelectedEvent(event);
                                    }
                                  }}
                                  className={`cursor-pointer transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-xl ${
                                    isOngoing ? "ring-1 ring-primary/40" : ""
                                  } ${isPast ? "opacity-50" : ""}`}
                                >
                                  <EventPill
                                    variant="agenda"
                                    title={event.title}
                                    color={event.color}
                                    time={format(event.start, "HH:mm")}
                                    icon={event.is_waste_collection ? Trash2 : undefined}
                                  />
                                  <div className="flex flex-wrap items-center gap-2 px-4 pt-1.5">
                                    {isOngoing && (
                                      <span className="flex items-center gap-1 text-xs text-primary shrink-0">
                                        <span className="relative flex size-2">
                                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                                          <span className="relative inline-flex rounded-full size-2 bg-primary" />
                                        </span>
                                        {t("nowBadge")}
                                      </span>
                                    )}
                                    {isUpcomingSoon && minutesUntil > 0 && (
                                      <span className="text-xs text-primary shrink-0">
                                        {t("inMinutes", { minutes: minutesUntil })}
                                      </span>
                                    )}
                                    {event.location && (
                                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                        <MapPin className="size-3" />
                                        {event.location}
                                      </span>
                                    )}
                                    {person && (
                                      <Badge variant="outline" className="text-xs" style={{ borderColor: person.color, color: person.color }}>
                                        {person.name}
                                      </Badge>
                                    )}
                                  </div>
                                </motion.div>
                              );
                            })}
                          </div>
                        )}
  ```
  Note: `EventPill` already renders the mono time (via `personText(color)`) so the standalone `<Clock>` time row is dropped; the upcoming-soon "in N min" hint switches from `text-amber-400` to `text-primary` for token consistency. `Trash2` is already imported in `page.tsx` (line 15).
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected PASS.
- [ ] Commit: `git commit -m "feat(calendar): sidebar agenda cards via EventPill agenda variant"`

---

### Task 5 — Person-filter chips in the topbar

**Files**
- Modify: `webapp/src/app/calendar/page.tsx`

**Interfaces**
- Consumes: `PersonChip` from `@/components/person-chip`; existing `people` from `usePeople()`.
- Produces: a `selectedPersonIds: Set<string>` state (default = all person ids), a `PersonChip` toggle row in the view-switcher topbar, and a `visibleEvents` derived array (events filtered by `person_id ∈ selectedPersonIds`; person-less events always shown) passed to `MonthView`/`WeekView` and the sidebar instead of `events`.

Steps:

- [ ] Add the `PersonChip` import after the `EventPill` import added in Task 4:
  ```tsx
  import { PersonChip } from "@/components/person-chip";
  ```
- [ ] Add filter state after the `view` state (after line 181, `const [view, setView] = useState<"month" | "week">("month");`):
  ```tsx
  // Person filter — default: all selected (null = "all", lazily initialized once people load)
  const [selectedPersonIds, setSelectedPersonIds] = useState<Set<string> | null>(null);

  const togglePerson = (id: string) => {
    setSelectedPersonIds((prev) => {
      const all = new Set((people || []).map((p) => p.id));
      const base = prev ?? all;
      const next = new Set(base);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  ```
- [ ] Add a `visibleEvents` derived array immediately after the `events` `useMemo` closes (after line 284, the line ending `}, [eventsData, people]);`):
  ```tsx
  // Apply the person filter. null = no filter yet (show all). Person-less
  // events (no person_id) are always visible.
  const visibleEvents = useMemo(() => {
    if (!selectedPersonIds) return events;
    return events.filter((e) => !e.person_id || selectedPersonIds.has(e.person_id));
  }, [events, selectedPersonIds]);
  ```
- [ ] Point the day-event helpers at the filtered list: change `getEventsForDay` (line 348–350) to filter `visibleEvents`:
  ```tsx
  const getEventsForDay = (day: Date) => {
    return visibleEvents.filter((event) => eventOccursOnDay(event, day));
  };
  ```
- [ ] Pass `visibleEvents` to both views. In the `MonthView` JSX (line 779) change `events={events}` to `events={visibleEvents}`; in the `WeekView` JSX (line 787) change `events={events}` to `events={visibleEvents}`. (The monthly-stats bar at line 721 keeps using `events` — stats reflect the whole month regardless of filter; document this.)
- [ ] Add the `PersonChip` row to the topbar. Replace the view-switcher container (lines 700–718) so the person chips sit between the view tabs and the prev/today/next group, wrapping on small screens. Replace:
  ```tsx
          {/* View tabs + navigation — kept below PageHeader */}
          <div className="flex items-center justify-between gap-2 mb-6 sm:mb-8">
            <Tabs value={view} onValueChange={(v) => setView(v as "month" | "week")}>
              <TabsList className="h-8" aria-label={t("viewSwitcherAria")}>
                <TabsTrigger value="month" className="text-xs sm:text-sm px-2 sm:px-3">{t("viewMonth")}</TabsTrigger>
                <TabsTrigger value="week" className="text-xs sm:text-sm px-2 sm:px-3">{t("viewWeek")}</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="size-8" onClick={goToPrevious} aria-label={t("previousAria")}>
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs sm:text-sm px-2 sm:px-3" onClick={goToToday}>
                {t("todayButton")}
              </Button>
              <Button variant="outline" size="icon" className="size-8" onClick={goToNext} aria-label={t("nextAria")}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
  ```
  with:
  ```tsx
          {/* View tabs + person filter + navigation — kept below PageHeader */}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-3 mb-6 sm:mb-8">
            <Tabs value={view} onValueChange={(v) => setView(v as "month" | "week")}>
              <TabsList aria-label={t("viewSwitcherAria")}>
                <TabsTrigger value="month" className="text-xs sm:text-sm px-2 sm:px-3">{t("viewMonth")}</TabsTrigger>
                <TabsTrigger value="week" className="text-xs sm:text-sm px-2 sm:px-3">{t("viewWeek")}</TabsTrigger>
              </TabsList>
            </Tabs>
            {people && people.length > 0 && (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("personFilterAria")}>
                {people.map((person) => (
                  <PersonChip
                    key={person.id}
                    name={person.name}
                    color={person.color}
                    selected={!selectedPersonIds || selectedPersonIds.has(person.id)}
                    onClick={() => togglePerson(person.id)}
                  />
                ))}
              </div>
            )}
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="size-8" onClick={goToPrevious} aria-label={t("previousAria")}>
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs sm:text-sm px-2 sm:px-3" onClick={goToToday}>
                {t("todayButton")}
              </Button>
              <Button variant="outline" size="icon" className="size-8" onClick={goToNext} aria-label={t("nextAria")}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
  ```
  (The `h-8` override is dropped from `TabsList` so the Foundation inset-segment height — `h-10` — applies, per the spec's "verify/tweak (drop the `h-8`)". This is the switcher tweak called for in scope item 7.)
- [ ] Add the `personFilterAria` key to all three locale files. In `webapp/messages/en.json`, `de.json`, `fr.json` under `calendar`, add after `"viewSwitcherAria"`:
  - en: `"personFilterAria": "Filter by person",`
  - de: `"personFilterAria": "Nach Person filtern",`
  - fr: `"personFilterAria": "Filtrer par personne",`
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected PASS.
- [ ] Commit: `git commit -m "feat(calendar): person-filter chips in the topbar"`

---

### Task 6 — Show waste-collection events (behavior change)

**Files**
- Modify: `webapp/src/app/calendar/page.tsx`

**Interfaces**
- Consumes: existing `event.calendar?.is_waste_collection` flag (already mapped into the transform).
- Produces: waste events now appear on the calendar (month chips + week blocks + agenda cards) with a `Trash2` icon (the icon wiring landed in Tasks 2 and 4). **Deliberate behavior change.**

Steps:

- [ ] Remove the waste filter from the event transform. Change the closing of the `events` `useMemo` (line 283) from:
  ```tsx
      };
    }).filter((e) => !e.is_waste_collection);
  }, [eventsData, people]);
  ```
  to:
  ```tsx
      };
    });
  }, [eventsData, people]);
  ```
  (`is_waste_collection` is already set in the mapped object at line 281, so the views and agenda — which key off `event.is_waste_collection` for the `Trash2` icon, wired in Tasks 2 and 4 — light up automatically.)
- [ ] Confirm `is_waste_collection` flows to `MonthView`: it is part of the page's `CalendarEvent` type (line 112) and the `MonthView` interface (extended in Task 2), so passing `visibleEvents` carries it. No further change. (WeekView does not branch on the waste flag; waste events that are timed/all-day still render as normal blocks there — document: the `Trash2` waste affordance is month + agenda only, matching the mockup which shows waste in the month grid and the mobile agenda hint, not the week timeline.)
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected PASS.
- [ ] Commit: `git commit -m "feat(calendar): show waste-collection events with a trash icon"`

---

### Task 7 — Add-button cleanup + mobile FAB

**Files**
- Modify: `webapp/src/app/calendar/page.tsx`

**Interfaces**
- Consumes: `FAB` from `@/components/fab`; existing `Plus` icon; `openAddDialog` + `addDialogOpen` state.
- Produces: the desktop header "+" button uses the default (primary) `Button` variant (drops `variant="month"`); a mobile-only `FAB` (`md:hidden`) opens the add-event dialog.

Steps:

- [ ] Add the `FAB` import after the `PersonChip` import:
  ```tsx
  import { FAB } from "@/components/fab";
  ```
- [ ] Drop `variant="month"` from the header add button (lines 407–412). Replace:
  ```tsx
                <DialogTrigger asChild>
                  <Button variant="month" size="sm" className="gap-1 sm:gap-2" onClick={openAddDialog}>
                    <Plus className="size-4" />
                    <span className="hidden sm:inline">{t("newEventButton")}</span>
                  </Button>
                </DialogTrigger>
  ```
  with:
  ```tsx
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1 sm:gap-2" onClick={openAddDialog}>
                    <Plus className="size-4" />
                    <span className="hidden sm:inline">{t("newEventButton")}</span>
                  </Button>
                </DialogTrigger>
  ```
- [ ] Drop the remaining `variant="month"` literals on the add/edit submit buttons and the banner link (token cleanup so the calendar no longer uses the legacy `month` variant — the default Button is now the month accent). The banner button was already changed in Task 1. Change:
  - The add-event "Create" submit button (lines 680–684): replace `variant="month"` with no `variant` (default):
    ```tsx
                    <Button
                      className="w-full"
                      onClick={handleAddEvent}
                      disabled={!newEvent.title.trim() || !newEvent.calendar_id || createEvent.isPending}
                    >
    ```
  - The edit-dialog "Save" submit button (lines 1343–1346): replace `variant="month"` with no `variant`:
    ```tsx
                  <Button
                    className="flex-1"
                    disabled={!editForm.title.trim() || updateEvent.isPending}
                    onClick={async () => {
    ```
- [ ] Add the mobile FAB. Insert it just before the closing `</div>` of the inner container (before line 1523 `</div>` that closes `<div className="relative z-10 ...">`), after the Event Detail Dialog's closing `</Dialog>` (line 1521):
  ```tsx
          {/* Mobile add FAB — desktop uses the header button */}
          <FAB
            icon={Plus}
            onClick={openAddDialog}
            ariaLabel={t("newEventButton")}
            className="md:hidden"
          />
  ```
  (The FAB calls `openAddDialog` directly, which sets `addDialogOpen` true; the add `Dialog` is controlled by `addDialogOpen`/`setAddDialogOpen`, so it opens without needing a `DialogTrigger`.)
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected PASS.
- [ ] Commit: `git commit -m "feat(calendar): primary add button + mobile FAB"`

---

### Task 8 — Changelog

**Files**
- Modify: `CHANGELOG.md`

**Interfaces**
- Consumes: nothing. Produces: `[Unreleased]` entries for the self-hoster.

Steps:

- [ ] Under `## [Unreleased]`, add to the `Added` section (create it if absent, in Keep-a-Changelog order Added/Changed/Fixed):
  ```markdown
  - Calendar: person-filter chips in the topbar — toggle which family members' events are shown (person-less events always remain visible)
  ```
- [ ] Under `## [Unreleased]` → `Changed`:
  ```markdown
  - Calendar: waste-collection events now appear on the month grid and day agenda (with a trash icon) instead of being hidden
  - Calendar: redesigned to the flat "Salbei/Leinen" look — removed glassmorphism, flat linen day cells, primary "today" ring, person-tinted event pills and agenda cards
  ```
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected PASS (lint covers nothing in CHANGELOG, but run the gate for consistency).
- [ ] Commit: `git commit -m "docs(changelog): calendar redesign, person filter, waste events shown"`

---

## Self-Review

Scope item → task mapping:
1. Glass removal + flat surfaces + bg gradient + stat chips → **Task 1** (page) + **Task 2** (month-view wrapper) + **Task 3** (week-view wrapper).
2. Month-view day cells (flat, weekend, dashed other-month, today ring + primary circle, EventPill pills, waste icon, KW col, MAX 3, mobile dots) → **Task 2**.
3. Week-view (flat, EventPill-style tinted blocks via `personStrongTint`/`personText`, today header `text-primary`, current-time line documented as red) → **Task 3**.
4. Sidebar agenda → `EventPill variant="agenda"`; holiday badge + "Jetzt" indicator retokenized → **Task 1** (tokens) + **Task 4** (agenda cards).
5. Person-filter chips (Set state, PersonChip row, filter person events, person-less always shown) → **Task 5** (+ `personFilterAria` key ×3).
6. Waste events shown (un-filter transform) → **Task 6** (icon wiring in Tasks 2 + 4).
7. View switcher (drop `h-8`, inherit inset-segment) + add button (drop `variant="month"`) + mobile FAB → **Task 5** (TabsList) + **Task 7** (button + FAB).
8. Token cleanup (`month-primary` → `primary`/`ring`; `text-white` → `personText`/`text-primary-foreground`) → **Tasks 1, 2, 3, 4** (page tokens, month today circle, week blocks, agenda).
9. Changelog + new i18n keys → **Task 8** (changelog) + **Task 5** (`personFilterAria` in en/de/fr).

Mobile note: no separate mobile route. The responsive stack (`grid-cols-1 xl:grid-cols-4`) already collapses to mini-month dots (month-view `sm:hidden` dots) above the sidebar agenda (now `EventPill` agenda cards) below — this is the mockup's "mini-month + agenda" mobile layout. The waste "warning-tint hint" in the mockup's mobile agenda is approximated by the `Trash2`-iconed agenda card from Task 4 (a dedicated warning-tint variant is deferred — flagged below).

Type-consistency check:
- `EventPill` props (`title`, `color`, `icon?: LucideIcon`, `variant?`, `time?`, `className?`) — all call sites (Task 2 month chip, Task 4 agenda) pass `title`/`color`/optional `icon`; agenda also passes `variant="agenda"` + `time` string. Matches the shipped signature.
- `PersonChip` props (`name`, `color`, `selected?`, `onClick?`, `className?`) — Task 5 passes all but `className`. Matches.
- `FAB` props (`icon`, `onClick`, `ariaLabel`, `className?`) — Task 7 passes all four. Matches.
- `MonthView`/`WeekView` `events: CalendarEvent[]` — Task 5 passes `visibleEvents` (same element type as `events`). Task 2 extends `MonthView`'s local `CalendarEvent` with `is_waste_collection?: boolean`, which is a superset of what page.tsx passes (page's `CalendarEvent` already has the field, line 112), so assignment is structurally valid.
- `selectedPersonIds: Set<string> | null` — `togglePerson` always returns a `Set<string>`; `visibleEvents` and the `PersonChip selected` prop guard on `null` ("all"). No `any`.
- `personStrongTint`/`personText` return `string` — assigned to inline `style` `backgroundColor`/`color`. Matches.

Deferred / flagged for the controller:
- **Waste warning-tint agenda hint**: the mockup's mobile agenda shows waste as a distinct `warning`-tinted row with an icon-badge ("morgen früh rausstellen"). This plan renders waste as a normal `EventPill` agenda card with a `Trash2` icon (bounded reuse). A dedicated warning-tint waste card variant is out of scope — flagged.
- **Week-view waste icon**: `WeekView` does not branch on `is_waste_collection`, so waste events there render as plain timed/all-day blocks (no `Trash2`). The mockup only shows the trash affordance in the month grid + mobile agenda, so this matches the design; flagged for awareness.
- **Other-month dashed cell border**: approximated via `opacity-40` + dashed day-number border rather than a per-cell dashed border (the grid uses shared `border-l`/`border-b` dividers, not per-cell borders). Flagged as an intentional fidelity compromise to stay bounded.
