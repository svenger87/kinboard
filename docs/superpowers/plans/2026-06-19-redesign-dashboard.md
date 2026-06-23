# Redesign Plan 3 — Dashboard Route ("Salbei/Leinen")

**Target file:** `docs/superpowers/plans/2026-06-19-redesign-dashboard.md`
**For agentic workers:** subagent-driven; each Task is independently dispatchable, self-contained, and ends with a lint+tsc gate and one Conventional Commit. No task depends on an uncommitted sibling.

**Goal:** Migrate the dashboard route to the flat warm-linen "Salbei/Leinen" look. Restyle the shell (page background, clock, family row, today strip), migrate all dashboard widgets to the `WidgetCard` flat-linen look (removing all remaining glass), and add a new Shopping widget. Reuse Foundation + Plan 2 components throughout; never hardcode accent hex.

**Architecture:** Next.js 16 App Router, React 19, Tailwind, shadcn/ui, framer-motion, next-intl (EN+DE+FR parity is a CI gate), date-fns. The dashboard is `webapp/src/app/page.tsx` rendering widgets from `webapp/src/components/widgets/` gated by `WidgetVisibility`. Plan 2 shipped reusable composites in `webapp/src/components/` (`person-avatar`, `widget-card`, `today-strip-pill`, `event-pill`, `checklist-item`, `person-chip`, `fab`) and `webapp/src/lib/person-color.ts` (`personTint`/`personStrongTint`/`personText`). Utilities live in `webapp/src/app/globals.css` (`.text-kiosk-hero`, `.text-kiosk-label`, `.icon-badge`, `.accent-border-top`, `.elev-*`, `.page-gradient`, `.scrollbar-hide`, `.fab-above-nav`, `.safe-area-inset`).

**Tech Stack:** TypeScript, React 19, Next 16, Tailwind, shadcn/ui, framer-motion, next-intl, date-fns.

## Global Constraints

- No `next build` locally. Per-task gate: `cd webapp && npm run lint` and `npx tsc --noEmit`. No unit tests — verification is lint+tsc+structural self-review; live visual smoke deferred to the controller/user on local dev. Do NOT write Jest/RTL/TDD steps.
- Reuse Foundation + Plan 2 components; never hardcode accent hex (primary/tints or person-color via inline color-mix); on month-colored surfaces use `text-primary-foreground`, never literal `text-white` (person-color avatars' white initial is fine).
- NO glass/backdrop-blur on app surfaces (this plan REMOVES the dashboard's remaining glass); glass only over photos.
- Touch targets ≥44px (kiosk ≥56-64; kiosk body text ≥20px, clock clamp(96,14vw,160)). Lucide stroke 1.75. Times/numbers `tabular-nums`/`font-mono`.
- Motion 120/220/320ms; respect `prefers-reduced-motion`; sparse on kiosk.
- next-intl EN/DE/FR parity (CI gate) — every new key in all three; French can mirror English if no translation, but the KEY must exist.
- Commits: Conventional Commits, NO `Co-Authored-By: Claude` trailer. One commit per task.
- Preserve the documented dashboard layout invariant: inner flex container uses `style minHeight: calc(100vh - var(--nav-spacing))` (NOT min-h-screen) so `mt-auto` widgets pin above the nav.

---

### Task 1 — Restyle `page.tsx` shell (flat linen background)

**Files**
- Modify `webapp/src/app/page.tsx`

**Interfaces**
- Consumes: existing widget components, `useSetting<WidgetVisibility>`, `.page-gradient` utility.
- Produces: flat linen dashboard background; no behavioral change to widget gating.

**Steps**
- [ ] Replace the two decorative `<div className="fixed … z-0 …">` blocks (lines 52-55) and the surrounding background with a single subtle `.page-gradient` div. Replace the `<main>` + inner `<div>` opening (lines 45-55) with:
```tsx
  return (
    <main id="main-content" className="relative min-h-screen overflow-hidden hide-status-bar">
      <div className="page-gradient pointer-events-none fixed inset-0 z-0" />
      <div
        className="relative z-10 flex flex-col p-4 md:p-6 lg:p-8 safe-area-inset"
        style={{ minHeight: "calc(100vh - var(--nav-spacing))" }}
      >
        <GettingStartedChecklist />
        <ShoppingInstallPrompt />
        {/* Top Section - Clock */}
        <section className="relative z-[1] flex-1 flex flex-col items-center justify-center" aria-label={t("ariaClock")}>
```
  (This deletes both fixed gradient/glow divs and the inline radial style, keeping the `minHeight` invariant and `mt-auto` grid below.)
- [ ] Keep the family/today-strip spacing but tighten to the mockup `gap-16` rhythm. Replace the `mt-12` / `mt-6 mb-12` wrappers (lines 61-71) with:
```tsx
          {/* Family Members below clock */}
          <div className="mt-10">
            <FamilyMembers />
          </div>

          {/* Today at a glance — horizontal pill row */}
          <div className="mt-6 mb-10 w-full">
            <TodayStrip />
          </div>
        </section>
```
- [ ] Leave the widget grid `<section>` (line 80) unchanged and `<FloatingLightsFab/>` (line 96) unchanged.
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` (Expected: PASS)
- [ ] Commit: `style(dashboard): flat linen page background, drop decorative glow divs`

---

### Task 2 — Clock kiosk-hero type

**Files**
- Modify `webapp/src/components/widgets/clock.tsx`

**Interfaces**
- Consumes: `useClock`, `getDateFnsLocale`, `.text-kiosk-hero`, `.text-kiosk-label`.
- Produces: clock with kiosk-hero clamp time, mono date eyebrow, no heavy light glow.

**Steps**
- [ ] Change the `xl` entry in `sizeClasses` (line 47) to use the kiosk-hero utility instead of fixed text sizes. Replace lines 43-48:
```tsx
const sizeClasses = {
  sm: "text-4xl",
  md: "text-6xl",
  lg: "text-8xl",
  xl: "text-kiosk-hero",
};
```
- [ ] In the three time `<span>`s (lines 114-128) replace `font-display font-extralight ${sizeClasses[size]} clock-display tracking-tighter` with `${sizeClasses[size]} clock-display tabular-nums` for the hour/minute spans, and `${sizeClasses[size]} text-muted-foreground/40 mx-1` for the colon span. (`.text-kiosk-hero` already supplies `font-display font-light leading-none tracking-tight tabular-nums`; for non-xl sizes keep `font-display font-extralight`.) Concretely, gate the font class so non-xl keeps its weight:
```tsx
                <span
                  className={`${size === "xl" ? "" : "font-display font-extralight"} ${sizeClasses[size]} clock-display tabular-nums tracking-tight`}
                >
                  {hours}
                </span>
                <span
                  className={`${size === "xl" ? "" : "font-display font-extralight"} ${sizeClasses[size]} text-muted-foreground/40 mx-1 clock-colon`}
                >
                  :
                </span>
                <span
                  className={`${size === "xl" ? "" : "font-display font-extralight"} ${sizeClasses[size]} clock-display tabular-nums tracking-tight`}
                >
                  {minutes}
                </span>
```
- [ ] Remove the heavy light-mode glow: change `className="flex items-baseline clock-glow"` (line 112) to `className="flex items-baseline dark:clock-glow"` so the glow only applies in dark.
- [ ] Convert the date eyebrow to a mono kiosk label. Replace the date `<p>` (lines 187-189):
```tsx
            <p className="text-kiosk-label text-base text-primary tabular-nums">
              {formattedDate}
            </p>
```
- [ ] Leave the greeting, week badge popover, and year-progress popover unchanged (greeting via `getGreetingKey` + `useTranslations("clock")` is preserved).
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` (Expected: PASS)
- [ ] Commit: `style(clock): kiosk-hero clamp time, mono date eyebrow, dark-only glow`

---

### Task 3 — Family row with `PersonAvatar`

**Files**
- Modify `webapp/src/components/widgets/family-members.tsx`

**Interfaces**
- Consumes: `PersonAvatar` (`@/components/person-avatar`), `usePeople`, `useTodos`, `useEvents`, `getMemberStatus`.
- Produces: 64px PersonAvatar + name + per-person daily status line; no glow; reduced-motion respected.

**Steps**
- [ ] Add the import after line 6: `import { PersonAvatar } from "@/components/person-avatar";`
- [ ] Add a per-person status line key to i18n (Task 12 handles the new Shopping keys; this status line reuses a new `familyMembers.statusLine` key). Add to all three message files under `"familyMembers"`:
  - en.json: `"statusLine": "{events, plural, =0 {} one {# event} other {# events}}{sep}{todos, plural, =0 {} one {# task} other {# tasks}}",` and `"statusNothing": "All clear",` plus `"sep": " · "` — to avoid plural-glue complexity, instead add two simple keys and compose in code (see next step).
  
  Use these exact keys instead (simpler, parity-safe). en.json:
```json
    "statusEvents": "{count, plural, one {# event} other {# events}}",
    "statusTasks": "{count, plural, one {# task} other {# tasks}}",
    "statusNothing": "All clear",
```
  de.json:
```json
    "statusEvents": "{count, plural, one {# Termin} other {# Termine}}",
    "statusTasks": "{count, plural, one {# Aufgabe} other {# Aufgaben}}",
    "statusNothing": "Alles erledigt",
```
  fr.json:
```json
    "statusEvents": "{count, plural, one {# événement} other {# événements}}",
    "statusTasks": "{count, plural, one {# tâche} other {# tâches}}",
    "statusNothing": "Rien à signaler",
```
- [ ] Replace the avatar render block. Replace lines 156-212 (the `<div className="relative">…</div>` Avatar block plus the count badges and the name `<span>`) with a flat PersonAvatar + name + status line:
```tsx
                  <PersonAvatar
                    name={member.name}
                    color={member.color}
                    avatarUrl={member.avatar_url}
                    size={64}
                    className="transition-transform duration-[120ms] group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  />
                  <span className="text-sm font-medium text-foreground/90 group-hover:text-foreground transition-colors">
                    {member.name}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {status.events === 0 && status.todos === 0
                      ? t("statusNothing")
                      : [
                          status.events > 0 ? t("statusEvents", { count: status.events }) : null,
                          status.todos > 0 ? t("statusTasks", { count: status.todos }) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                  </span>
```
- [ ] Remove the now-unused imports: `Avatar, AvatarFallback, AvatarImage` (line 7), `Badge` (line 9 — still used in `PersonDetailsDialog`, KEEP), and the `isEmojiAvatar`/`isImageAvatar`/`getInitials` helpers ONLY if no longer referenced. NOTE: `PersonDetailsDialog` (lines 243-381) still uses `Avatar`/`AvatarFallback`/`AvatarImage`, `getInitials`, `isEmojiAvatar`, `isImageAvatar`, and `Badge` — so KEEP all those imports and helpers. Only the inline family-row avatar is replaced.
- [ ] Soften the entrance variants for reduced motion. Replace the `item` variant (lines 126-129):
```tsx
  const item = {
    hidden: { opacity: 0, scale: 0.92 },
    show: { opacity: 1, scale: 1, transition: { duration: 0.22 } },
  };
```
  and on the per-member `motion.div` (line 145-147) drop the `whileHover={{ scale: 1.1 }}` (the avatar handles hover scale via CSS now) — replace `whileHover={{ scale: 1.1 }}` and `whileTap={{ scale: 0.95 }}` with `whileTap={{ scale: 0.97 }}`.
- [ ] Update `MemberSkeleton` (lines 50-57) to add a second text line so the skeleton matches the new status line:
```tsx
function MemberSkeleton() {
  return (
    <div className="flex flex-col items-center gap-2">
      <Skeleton className="size-16 rounded-full" />
      <Skeleton className="h-4 w-12" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}
```
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` (Expected: PASS)
- [ ] Commit: `feat(dashboard): family row uses PersonAvatar + status line, drop glow`

---

### Task 4 — Today strip as horizontal `TodayStripPill` row

**Files**
- Modify `webapp/src/components/widgets/today-strip.tsx`

**Interfaces**
- Consumes: `TodayStripPill` (`@/components/today-strip-pill`), `useEvents(todayStart,todayEnd)`, `usePeople`, `.scrollbar-hide`.
- Produces: flat horizontal scroll row of per-event pills (time mono in person color); empty state per components.md.

**Steps**
- [ ] Add imports after line 9: `import { TodayStripPill } from "@/components/today-strip-pill";` and `import { usePeople } from "@/hooks";`
- [ ] Add `const { data: people } = usePeople();` after the `useEvents` call (line 35).
- [ ] Add a person-color resolver and a timed-events list (sorted by start). After `todayEvents` (line 50) add:
```tsx
  const colorFor = (e: (typeof todayEvents)[number]) => {
    const personId = e.person_id || e.calendar?.person_id;
    const person = personId ? people?.find((p) => p.id === personId) : undefined;
    return person?.color || e.calendar?.color || "hsl(var(--primary))";
  };

  const timedToday = useMemo(
    () =>
      todayEvents
        .filter((e) => !e.all_day)
        .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()),
    [todayEvents]
  );
```
- [ ] Replace the entire returned `motion.div` (lines 85-158) with a flat scroll row. The wrapper drops `bg-white/[0.04] border border-white/[0.06]` (glass removal). New return:
```tsx
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: 0.4 }}
      className="scrollbar-hide flex w-full items-center gap-3 overflow-x-auto px-1 py-1"
      role="status"
      aria-label={t("ariaLabel")}
    >
      {timedToday.length > 0 ? (
        timedToday.map((e) => (
          <TodayStripPill
            key={e.id}
            time={format(new Date(e.start_at), "HH:mm")}
            title={e.title}
            color={colorFor(e)}
          />
        ))
      ) : (
        <span className="mx-auto text-sm italic text-muted-foreground/70">
          {t("emptyState")}
        </span>
      )}
    </motion.div>
  );
```
- [ ] Remove now-unused imports/vars: `Calendar, CheckSquare, Clock, ArrowRight, Cake, Trash2, Star` from the lucide import (line 5) — none are referenced anymore; remove the `tHolidays`, `holidayCountry`, `country`, `wasteToday`, `nextEvent`, `pendingTodos`, `birthdaysToday`, `upcomingHolidays`, `nextHoliday`, `holidayIsToday`, `holidayDaysAway`, `hasContent` computations (lines 22, 38-39, 53-83) AND their hooks `useTodos`, `useBirthdays`, `useSetting` and the `getUpcomingHolidays`/`CountryCode`/`getDaysUntilBirthday` helpers (lines 8-9, 11-18, 37-39). Keep `useEvents`, `usePeople`, `format`, `startOfDay`, `endOfDay`, `isAfter`, `useMemo`, `useEffect`, `useState`, `motion`, `useTranslations`.
  Final import block:
```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { format, startOfDay, endOfDay, isAfter } from "date-fns";
import { useTranslations } from "next-intl";
import { useEvents, usePeople } from "@/hooks";
import { TodayStripPill } from "@/components/today-strip-pill";
```
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` (Expected: PASS)
- [ ] Commit: `feat(dashboard): today strip becomes flat per-event pill row`

---

### Task 5 — Weather widget → `WidgetCard` shell, flat

**Files**
- Modify `webapp/src/components/widgets/weather.tsx`

**Interfaces**
- Consumes: `WidgetCard` (`@/components/widget-card`), `useWeather`, `useWeatherForecast`, `WeatherModal`.
- Produces: flat WidgetCard with `CloudSun` icon-badge + font-display title; gradient overlay removed; data + modal preserved.

**Steps**
- [ ] Add imports: `import { CloudSun } from "lucide-react";` (extend existing lucide import) and `import { WidgetCard } from "@/components/widget-card";`
- [ ] Replace the success-state `Card` wrapper (lines 187-332) so the card is a `WidgetCard` with header. Replace from `<Card className={...weatherGradient...}>` through its closing `</Card>` with a `WidgetCard` whose `onClick` opens the modal and whose children are the existing temp/details/forecast/sun blocks (drop the `bg-gradient-to-br ${weatherGradient}` and the standalone icon tile, since the icon-badge moves to the header). Concretely:
```tsx
        <WidgetCard
          icon={CloudSun}
          title={t("title")}
          onClick={() => setModalOpen(true)}
          className={`h-full ${className}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 sm:gap-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help">
                    <WeatherIcon className="size-10 text-primary" strokeWidth={1.75} />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{weatherData.condition}</p>
                </TooltipContent>
              </Tooltip>
              <div>
                <div className="flex items-baseline gap-2">
                  <p className="font-display text-5xl font-light tracking-tight tabular-nums">
                    {weatherData.temp}°
                  </p>
                  {weatherData.high && weatherData.low && (
                    <div className="text-sm text-muted-foreground tabular-nums">
                      <span className="text-foreground/70">{weatherData.high}°</span>
                      {" / "}
                      <span>{weatherData.low}°</span>
                    </div>
                  )}
                </div>
                <p className="text-sm font-medium text-muted-foreground">{weatherData.condition}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 text-right">
              <Badge variant="neutral" className="font-medium">{weatherData.location}</Badge>
              <div className="flex flex-col gap-1 text-sm text-muted-foreground tabular-nums">
                <span className="flex items-center justify-end gap-1"><Droplets className="size-3" />{weatherData.humidity}%</span>
                <span className="flex items-center justify-end gap-1"><Wind className="size-3" />{weatherData.windSpeed} km/h</span>
                {weatherData.feelsLike && (
                  <span className="flex items-center justify-end gap-1"><Thermometer className="size-3" />{t("feelsLike", { temp: weatherData.feelsLike })}</span>
                )}
              </div>
            </div>
          </div>
          {/* Mini Forecast + Sun times: keep the existing two blocks verbatim
              (lines 269-329 of the original), they reference upcomingDays /
              weatherData.sunrise/sunset and t(...) which all remain in scope. */}
        </WidgetCard>
```
  Preserve the existing "Mini Forecast" block (original lines 270-301) and "Sun times" block (original lines 304-329) exactly where the comment indicates, but change the forecast tooltip wrappers to keep working (they already are inside `TooltipProvider`). Replace `text-month-primary` occurrences in those blocks with `text-primary`.
- [ ] Update the `WeatherIcon` and forecast `DayIcon` strokeWidth from `1.5` to `1.75` (constraint: Lucide stroke 1.75).
- [ ] In `WeatherNotConfigured` and `WeatherError` (lines 106-145) replace `bg-month-primary/10`→`bg-primary/10`, `text-month-primary`→`text-primary`, `variant="month"`→`variant="secondary"` (Button), and keep the `/settings/weather` link. Keep using bare `Card` for these (acceptable; no glass).
- [ ] Keep `<WeatherModal open={modalOpen} onOpenChange={setModalOpen} />` after the WidgetCard, still wrapped in the `motion.div` + `TooltipProvider`. Remove the `getWeatherGradient` function (lines 68-78) and its call (line 168) since the gradient overlay is dropped.
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` (Expected: PASS)
- [ ] Commit: `style(weather): WidgetCard shell, flat linen, drop condition gradient`

---

### Task 6 — UpcomingEvents → `WidgetCard` + person-border rows

**Files**
- Modify `webapp/src/components/widgets/upcoming-events.tsx`

**Interfaces**
- Consumes: `WidgetCard`, `EventPill` (agenda variant), `useEvents`, `usePeople`.
- Produces: flat WidgetCard; day separators preserved; each event row = `EventPill agenda` (4px left person-color border + mono time + title).

**Steps**
- [ ] Add imports: `import { WidgetCard } from "@/components/widget-card";`, `import { EventPill } from "@/components/event-pill";`.
- [ ] Replace the success `Card`/`CardHeader`/`CardContent` (lines 142-300) with a `WidgetCard` (icon `Calendar`, title `t("title")`, `headerRight` = count Badge, `href="/calendar"` is NOT used because the row already links — instead keep a chevron link in `headerRight`). New body keeps the `ScrollArea` + day-separator logic but renders each event as an `EventPill variant="agenda"`:
```tsx
        <WidgetCard
          icon={Calendar}
          title={t("title")}
          headerRight={
            <Link href="/calendar" className="rounded-lg p-1 transition-colors hover:bg-accent/50" aria-label={t("viewAllAria")}>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          }
          className={`h-full ${className}`}
        >
          <ScrollArea className="max-h-[160px] pr-2 sm:max-h-[220px]">
            <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-1.5">
              {(() => {
                const sliced = displayEvents.slice(0, maxEvents);
                let lastDayLabel = "";
                return sliced.map((event) => {
                  const dayLabel = isToday(event.start)
                    ? t("today")
                    : isTomorrow(event.start)
                      ? t("tomorrow")
                      : format(event.start, "EEEE, d. MMM", { locale: dateLocale });
                  const showSeparator = dayLabel !== lastDayLabel;
                  lastDayLabel = dayLabel;
                  return (
                    <motion.div key={event.id} variants={item}>
                      {showSeparator && (
                        <div className="mb-1.5 mt-2 flex items-center gap-2 first:mt-0">
                          <span className="text-kiosk-label text-[11px]">{dayLabel}</span>
                          <div className="h-px flex-1 bg-border/40" />
                        </div>
                      )}
                      <EventPill
                        variant="agenda"
                        title={event.title}
                        color={event.color}
                        time={event.allDay ? undefined : format(event.start, "HH:mm")}
                      />
                    </motion.div>
                  );
                });
              })()}
              {displayEvents.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Calendar className="mb-2 size-10 text-primary/20" strokeWidth={1.75} />
                  <p className="text-sm">{t("emptyState")}</p>
                </div>
              )}
            </motion.div>
          </ScrollArea>
          {displayEvents.length > maxEvents && (
            <Link href="/calendar" className="mt-3 flex items-center justify-center gap-1 border-t border-border/40 pt-3 text-sm text-primary/70 transition-colors hover:text-primary">
              <span>{t("moreCount", { count: displayEvents.length - maxEvents })}</span>
              <ChevronRight className="size-4" />
            </Link>
          )}
        </WidgetCard>
```
- [ ] Update the error branch (lines 99-118) to drop `text-month-primary`→`text-primary`, `bg-month-primary/10`→`bg-primary/10`; it may stay a bare `Card`.
- [ ] Update `item` variant to `{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0, transition: { duration: 0.22 } } }` (no big x-slide; kiosk sparse).
- [ ] Remove now-unused imports: `CardHeader`, `CardTitle` (keep `Card`, `CardContent` only if still used by error branch — error branch uses `Card`+`CardHeader`+`CardContent`; simplest: rewrite error branch to bare `Card`+`CardContent` and a `font-display` title row, then drop `CardHeader`/`CardTitle`). Drop the per-event `MapPin`/now-badge/`differenceInMinutes`/`isWithinInterval` logic ONLY from the deleted block (the agenda EventPill shows time+title; location/now-badge are intentionally dropped for the flat row — note as follow-up). Remove unused `MapPin`, `Clock`, `Tooltip*`, `differenceInMinutes`, `isWithinInterval` imports.
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` (Expected: PASS)
- [ ] Commit: `style(upcoming-events): WidgetCard + agenda EventPill rows`

---

### Task 7 — TasksWidget → `WidgetCard` + person-colored checkbox rows

**Files**
- Modify `webapp/src/components/widgets/tasks-widget.tsx`

**Interfaces**
- Consumes: `WidgetCard`, `ChecklistItem`, `PersonAvatar`, `useTodos`, `useUpdateTodo`, `usePeople`.
- Produces: flat WidgetCard; rows use `ChecklistItem` with person-color checkbox + initial avatar meta; toggle behavior preserved.

**Steps**
- [ ] Add imports: `import { WidgetCard } from "@/components/widget-card";`, `import { ChecklistItem } from "@/components/checklist-item";`, `import { PersonAvatar } from "@/components/person-avatar";`, `import { Badge } from "@/components/ui/badge";` (already imported).
- [ ] Replace the success `Card`/header/content (lines 187-296) with a `WidgetCard` (icon `CheckSquare`, title `t("title")`, `headerRight` = `totalOpen>0` count Badge `variant="neutral"`), body = list of `ChecklistItem`s:
```tsx
      <WidgetCard
        icon={CheckSquare}
        title={t("title")}
        headerRight={totalOpen > 0 ? <Badge variant="neutral" className="tabular-nums">{t("openCount", { count: totalOpen })}</Badge> : undefined}
        className={`h-full ${className}`}
      >
        <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-2">
          {displayTodos.map((todo) => {
            const person = getPersonName(todo.person_id);
            const overdue = isOverdue(todo);
            const dueToday = isDueToday(todo);
            return (
              <ChecklistItem
                key={todo.id}
                checked={false}
                onCheckedChange={() => handleToggle(todo)}
                color={person?.color}
                label={
                  <span className="flex flex-col">
                    <span className="truncate leading-tight">{todo.title}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-[11px]">
                      {overdue && <span className="text-destructive">{t("overdue")}</span>}
                      {dueToday && !overdue && <span className="text-warning">{t("today")}</span>}
                    </span>
                  </span>
                }
                meta={person ? <PersonAvatar name={person.name} color={person.color} avatarUrl={person.avatar_url} size={24} /> : undefined}
              />
            );
          })}
          {displayTodos.length === 0 && (
            <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
              <CheckCircle2 className="mb-2 size-8 text-success/40" strokeWidth={1.75} />
              <p className="text-sm">{t("emptyState")}</p>
            </div>
          )}
        </motion.div>
        {totalOpen > maxItems && (
          <Link href="/todos" className="mt-3 flex w-full items-center justify-center gap-1 border-t border-border/40 pt-3 text-sm text-primary/70 transition-colors hover:text-primary">
            <span>{t("moreCount", { count: totalOpen - maxItems })}</span>
            <ChevronRight className="size-3" />
          </Link>
        )}
      </WidgetCard>
```
  (ChecklistItem always renders `checked={false}` because completing removes the item from `openTodos`; the 120ms fill is handled by the Checkbox primitive on tap before the list refetches.)
- [ ] Update the error branch (lines 147-166) `text-month-primary`→`text-primary`, `bg-month-primary/10`→`bg-primary/10`; rewrite to bare `Card`+`CardContent` with a `font-display` title so `CardHeader`/`CardTitle` imports can be dropped.
- [ ] Remove now-unused imports: `Circle`, `CheckCircle2` (keep — used in empty state), `Loader2`, `Repeat`, `AlertCircle` (overdue text replaces the icon — drop `AlertCircle`/`Repeat`/`Circle`/`Loader2`), `CardHeader`, `CardTitle`, `getPriorityColor` (no longer used — remove), `togglingId`/`setTogglingId` state (no longer used — remove), `useState` if now unused. Keep `useMemo`, `getPersonName` (now returns Person), `isOverdue`, `isDueToday`.
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` (Expected: PASS)
- [ ] Commit: `style(tasks): WidgetCard + ChecklistItem rows with person color`

---

### Task 8 — MealPlanWidget → `WidgetCard`

**Files**
- Modify `webapp/src/components/widgets/meal-plan-widget.tsx`

**Interfaces**
- Consumes: `WidgetCard`, `useMealPlan`, `getWeekStart`.
- Produces: flat WidgetCard (icon `Utensils`), recipe title + meal-type + prep time meta; data preserved.

**Steps**
- [ ] Add imports: `import { WidgetCard } from "@/components/widget-card";`, `import { Utensils } from "lucide-react";` (extend lucide import).
- [ ] Replace the success `Card`/header/content (lines 140-220) with a `WidgetCard` (icon `Utensils`, title `t("title")`, `headerRight` = chevron `Link` to `/meals` + count Badge `variant="neutral"`), body = the existing today-meals list but flat. Replace the per-meal row's `style={{ backgroundColor: ${color}10 }}` with `bg-card border border-border` (the meal-type colors `MEAL_TYPE_COLORS` are decorative non-person hex; keep them only on the small inner icon tile via inline style, which is allowed as these are functional category colors, not the month accent). Keep the empty-state `Link`. New body:
```tsx
        <WidgetCard
          icon={Utensils}
          title={t("title")}
          headerRight={
            <Link href="/meals" className="rounded-lg p-1 transition-colors hover:bg-accent/50" aria-label={t("weekplanLink")}>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          }
          className={`h-full ${className}`}
        >
          {todayMeals.length === 0 ? (
            <Link href="/meals" className="group flex flex-col items-center justify-center py-4 text-muted-foreground transition-colors hover:text-foreground">
              <Utensils className="mb-2 size-8 text-primary/20" strokeWidth={1.75} />
              <p className="text-sm">{t("emptyTitle")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground/60">{t("emptyDescription")}</p>
            </Link>
          ) : (
            <div className="flex flex-col gap-2">
              {todayMeals.map((entry) => {
                const mealType = entry.meal_type as MealType;
                const Icon = MEAL_TYPE_ICONS[mealType] || UtensilsCrossed;
                const color = MEAL_TYPE_COLORS[mealType] || "#6b7280";
                const title = entry.recipe?.title || entry.note || mealTypeLabels[mealType];
                const prepTime = entry.recipe?.total_time_minutes;
                return (
                  <div key={entry.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 elev-sm">
                    <span className="shrink-0 rounded-lg p-1.5" style={{ backgroundColor: `${color}22`, color }}>
                      <Icon className="size-4" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{title}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{mealTypeLabels[mealType]}</span>
                        {prepTime && (
                          <span className="flex items-center gap-0.5 tabular-nums">
                            <Clock className="size-2.5" />
                            {prepTime < 60 ? t("timeMinutes", { count: prepTime }) : prepTime % 60 > 0 ? t("timeHoursMinutes", { hours: Math.floor(prepTime / 60), minutes: prepTime % 60 }) : t("timeHoursOnly", { hours: Math.floor(prepTime / 60) })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </WidgetCard>
```
- [ ] Update error branch (lines 112-131) `text-month-primary`→`text-primary`, `bg-month-primary/10`→`bg-primary/10`; rewrite to bare `Card`+`CardContent` with a `font-display` title; drop `CardHeader`/`CardTitle` imports.
- [ ] Keep `TooltipProvider` wrapper + `motion.div` only if still needed; the only Tooltip was the chevron — replaced by `aria-label`, so remove `Tooltip*` imports and the `TooltipProvider`/`Tooltip` usage, keeping `motion.div`.
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` (Expected: PASS)
- [ ] Commit: `style(meal-plan): WidgetCard shell, flat rows`

---

### Task 9 — WasteCollectionWidget → `WidgetCard` (warning accent)

**Files**
- Modify `webapp/src/components/widgets/waste-collection-widget.tsx`

**Interfaces**
- Consumes: `WidgetCard`, `useEvents`.
- Produces: flat WidgetCard (icon `Trash2`), urgent items use `warning` Badge; logic preserved; renders null when empty (unchanged).

**Steps**
- [ ] Add import: `import { WidgetCard } from "@/components/widget-card";`.
- [ ] Replace the success `Card`/header/content (lines 200-284) with a `WidgetCard` (icon `Trash2`, title `t("title")`, `headerRight` = chevron `Link` to `/calendar`), body = the existing waste rows but flat (`bg-card border border-border elev-sm`, keep the functional bin color on the inner icon tile + left border via inline style). Replace the urgent `Badge variant="outline"` with `variant="warning"` for `daysUntil<=1`:
```tsx
        <WidgetCard
          icon={Trash2}
          title={t("title")}
          headerRight={
            <Link href="/calendar" className="rounded-lg p-1 transition-colors hover:bg-accent/50" aria-label={t("calendarTooltip")}>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          }
          className={`h-full ${className}`}
        >
          <div className="flex flex-col gap-2">
            {wasteEvents.map((event, index) => {
              const Icon = event.wasteType.icon;
              const isUrgent = event.daysUntil <= 1;
              return (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.06, duration: 0.22 }}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 elev-sm"
                  style={isUrgent ? { borderLeft: `4px solid ${event.wasteType.color}` } : undefined}
                  aria-label={t("itemAria", { label: wasteLabels[event.wasteType.id], when: formatDayLabel(event.date, event.daysUntil) })}
                >
                  <span className="shrink-0 rounded-lg p-2" style={{ backgroundColor: `${event.wasteType.color}22`, color: event.wasteType.color }}>
                    <Icon className="size-4" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{wasteLabels[event.wasteType.id]}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatDayLabel(event.date, event.daysUntil)}
                      {event.date.getHours() > 0 && ` ${format(event.date, "HH:mm")}`}
                    </p>
                  </div>
                  {isUrgent ? (
                    <Badge variant="warning" className="shrink-0">{event.daysUntil === 0 ? t("todayBadge") : t("tomorrowBadge")}</Badge>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{t("daysSuffix", { count: event.daysUntil })}</span>
                  )}
                </motion.div>
              );
            })}
          </div>
        </WidgetCard>
```
- [ ] Remove `Tooltip*` imports + `TooltipProvider` (chevron now uses `aria-label`); keep `motion.div`. Drop `CardHeader`/`CardTitle` imports (no error branch here). Keep `Card`/`CardContent`? — the skeleton (lines 83-99) still uses `Card`/`CardHeader`/`CardContent`, so KEEP those imports for the skeleton.
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` (Expected: PASS)
- [ ] Commit: `style(waste-collection): WidgetCard shell, warning badge, flat rows`

---

### Task 10 — BirthdayWidget → `WidgetCard` + `PersonAvatar`

**Files**
- Modify `webapp/src/components/widgets/birthday-widget.tsx`

**Interfaces**
- Consumes: `WidgetCard`, `PersonAvatar`, `useBirthdays`, `usePeople`.
- Produces: flat WidgetCard (icon `Cake`); each row = PersonAvatar (or Cake icon-badge when no person color) + name/age + countdown Badge.

**Steps**
- [ ] Add imports: `import { WidgetCard } from "@/components/widget-card";`, `import { PersonAvatar } from "@/components/person-avatar";`.
- [ ] The `displayBirthdays` mapping already exposes `personColor`. Extend it to also carry the person `name` + `avatar_url` for the avatar. In the `.map` (lines 98-108) add `const person = people?.find(...)` (already present) and return `personName: person?.name, personAvatar: person?.avatar_url` alongside `personColor`.
- [ ] Replace the success `Card`/header/content (lines 162-273) with a `WidgetCard` (icon `Cake`, title `t("title")`, `headerRight` = chevron `Link` to `/birthdays`), body = the existing list but each row leads with a `PersonAvatar` when `personColor` exists, else the existing `Cake`/`Gift`/`PartyPopper` icon tile. Countdown: today → `Badge variant="default"`; soon → `Badge variant="warning"`; else → `Badge variant="neutral"` (replaces the inline person-color border Badge to keep parity with the token system; person identity is already shown by the avatar). Concretely:
```tsx
                    {birthday.personColor ? (
                      <PersonAvatar name={birthday.personName ?? birthday.name} color={birthday.personColor} avatarUrl={birthday.personAvatar} size={40} />
                    ) : (
                      <span className={`rounded-lg p-2 ${isToday ? "bg-primary text-primary-foreground" : isSoon ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"}`}>
                        {isToday ? <PartyPopper className="size-4" strokeWidth={1.75} /> : isSoon ? <Gift className="size-4" strokeWidth={1.75} /> : <Cake className="size-4" strokeWidth={1.75} />}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{t("turnsAge", { name: birthday.name, age: calculateUpcomingAge(birthday.date) })}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">{format(birthday.date, "d. MMM", { locale: dateLocale })}</p>
                    </div>
                    {isToday ? (
                      <Badge variant="default" className="tabular-nums">{t("todayBadge")}</Badge>
                    ) : (
                      <Badge variant={isSoon ? "warning" : "neutral"} className="tabular-nums">{t("daysSuffix", { count: daysUntil })}</Badge>
                    )}
```
  Keep the outer row `motion.div` but drop `birthday-shimmer`/`bg-month-primary/[0.08]` for a flat `rounded-xl border border-border bg-card px-3 py-2 elev-sm` (today row gets `border-l-4 border-l-primary`).
- [ ] Update error branch (lines 121-140) `text-month-primary`→`text-primary`, `bg-month-primary/10`→`bg-primary/10`; rewrite to bare `Card`+`CardContent` font-display title; KEEP `Card`/`CardContent` (skeleton uses them) but drop `CardHeader`/`CardTitle`.
- [ ] Remove `Tooltip*`/`TooltipProvider` (chevron → aria-label); keep `motion.div`. Keep `Badge`.
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` (Expected: PASS)
- [ ] Commit: `style(birthday): WidgetCard + PersonAvatar rows, token badges`

---

### Task 11 — NEW ShoppingWidget + visibility wiring

**Files**
- Create `webapp/src/components/widgets/shopping-widget.tsx`
- Modify `webapp/src/types/widgets.ts`
- Modify `webapp/src/app/page.tsx`
- Modify `webapp/src/app/settings/widgets/page.tsx`
- Modify `webapp/messages/en.json`, `webapp/messages/de.json`, `webapp/messages/fr.json`

**Interfaces**
- Consumes: `WidgetCard`, `ChecklistItem`, `useShoppingItems`, `useUpdateShoppingItem`, `ShoppingItem`.
- Produces: a `shopping` widget showing the open (`!checked`) count as a header Badge + first few items as checkable rows; wired into visibility type/defaults/settings/grid.

**Steps**
- [ ] Add `shopping: boolean;` to `WidgetVisibility` (after `tasks` line 11) and `shopping: false,` to `DEFAULT_WIDGET_VISIBILITY` (after `notes: false,` line 33).
- [ ] Create `webapp/src/components/widgets/shopping-widget.tsx`:
```tsx
"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { ShoppingCart, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { WidgetCard } from "@/components/widget-card";
import { ChecklistItem } from "@/components/checklist-item";
import { useShoppingItems, useUpdateShoppingItem } from "@/hooks";
import { toast } from "sonner";

interface ShoppingWidgetProps {
  maxItems?: number;
  className?: string;
}

function ShoppingWidgetSkeleton() {
  const t = useTranslations("shoppingWidget");
  return (
    <Card aria-label={t("loadingAria")} aria-busy="true" className="accent-border-top h-full">
      <CardContent className="flex flex-col gap-2 p-[18px]">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-[52px] w-full rounded-xl" />
        <Skeleton className="h-[52px] w-full rounded-xl" />
        <Skeleton className="h-[52px] w-3/4 rounded-xl" />
      </CardContent>
    </Card>
  );
}

export function ShoppingWidget({ maxItems = 4, className = "" }: ShoppingWidgetProps) {
  const t = useTranslations("shoppingWidget");
  const { data: items, isLoading, isError } = useShoppingItems();
  const updateItem = useUpdateShoppingItem();

  const openItems = useMemo(
    () => (items || []).filter((i) => !i.checked),
    [items]
  );
  const displayItems = openItems.slice(0, maxItems);
  const totalOpen = openItems.length;

  const handleToggle = async (id: string) => {
    try {
      await updateItem.mutateAsync({ id, checked: true });
    } catch {
      toast.error(t("toastUpdateFailed"));
    }
  };

  if (isLoading) {
    return <ShoppingWidgetSkeleton />;
  }

  if (isError) {
    return (
      <Card className={`accent-border-top h-full ${className}`}>
        <CardContent className="flex flex-col gap-4 p-[18px]">
          <div className="flex items-center gap-3">
            <span className="icon-badge">
              <ShoppingCart className="size-5" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <h3 className="flex-1 font-display text-lg font-semibold leading-tight">{t("title")}</h3>
          </div>
          <p className="text-sm text-muted-foreground">{t("errorMessage")}</p>
        </CardContent>
      </Card>
    );
  }

  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.05 } },
  };
  const item = {
    hidden: { opacity: 0, y: 6 },
    show: { opacity: 1, y: 0, transition: { duration: 0.22 } },
  };

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.5 }}>
      <WidgetCard
        icon={ShoppingCart}
        title={t("title")}
        headerRight={
          totalOpen > 0 ? (
            <Badge variant="neutral" className="tabular-nums">{t("openCount", { count: totalOpen })}</Badge>
          ) : (
            <Link href="/shopping" className="rounded-lg p-1 transition-colors hover:bg-accent/50" aria-label={t("viewAllAria")}>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          )
        }
        className={`h-full ${className}`}
      >
        <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-2">
          {displayItems.map((it) => (
            <motion.div key={it.id} variants={item}>
              <ChecklistItem
                checked={false}
                onCheckedChange={() => handleToggle(it.id)}
                label={it.name}
                meta={it.quantity ? <span className="font-mono tabular-nums">{it.quantity}{it.unit ? ` ${it.unit}` : ""}</span> : undefined}
              />
            </motion.div>
          ))}
          {displayItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
              <ShoppingCart className="mb-2 size-8 text-primary/20" strokeWidth={1.75} />
              <p className="text-sm">{t("emptyState")}</p>
            </div>
          )}
        </motion.div>
        {totalOpen > maxItems && (
          <Link href="/shopping" className="mt-3 flex w-full items-center justify-center gap-1 border-t border-border/40 pt-3 text-sm text-primary/70 transition-colors hover:text-primary">
            <span>{t("moreCount", { count: totalOpen - maxItems })}</span>
            <ChevronRight className="size-3" />
          </Link>
        )}
      </WidgetCard>
    </motion.div>
  );
}

export { ShoppingWidgetSkeleton };
```
- [ ] In `page.tsx`: add `import { ShoppingWidget } from "@/components/widgets/shopping-widget";` after the `TasksWidget` import (line 14), and render `{w.shopping && <ShoppingWidget maxItems={4} />}` immediately after the `{w.tasks && <TasksWidget maxItems={4} />}` line (line 88).
- [ ] In `settings/widgets/page.tsx`: add `ShoppingCart` to the lucide import (line 5-19) and add a config entry after the `tasks` entry (line 45):
```tsx
  { key: "shopping", labelKey: "shoppingLabel", descriptionKey: "shoppingDescription", previewKeys: ["shoppingPreview1", "shoppingPreview2", "shoppingPreview3"], icon: ShoppingCart },
```
- [ ] Add the `shoppingWidget` block to all three message files (top-level, e.g. after `"tasksWidget"`). en.json:
```json
  "shoppingWidget": {
    "loadingAria": "Loading shopping list",
    "title": "Shopping",
    "openCount": "{count} open",
    "errorMessage": "Failed to load",
    "viewAllAria": "View shopping list",
    "emptyState": "Shopping list is empty",
    "toastUpdateFailed": "Failed to update",
    "moreCount": "+{count} more"
  },
```
  de.json:
```json
  "shoppingWidget": {
    "loadingAria": "Einkaufsliste wird geladen",
    "title": "Einkauf",
    "openCount": "{count} offen",
    "errorMessage": "Laden fehlgeschlagen",
    "viewAllAria": "Einkaufsliste ansehen",
    "emptyState": "Einkaufsliste ist leer",
    "toastUpdateFailed": "Aktualisierung fehlgeschlagen",
    "moreCount": "+{count} weitere"
  },
```
  fr.json:
```json
  "shoppingWidget": {
    "loadingAria": "Chargement de la liste de courses",
    "title": "Courses",
    "openCount": "{count} en cours",
    "errorMessage": "Échec du chargement",
    "viewAllAria": "Voir la liste de courses",
    "emptyState": "La liste de courses est vide",
    "toastUpdateFailed": "Échec de la mise à jour",
    "moreCount": "+{count} autres"
  },
```
- [ ] Add the settings preview keys under `settings.widgets` in all three files. en.json (after `notesPreview3`):
```json
      "shoppingLabel": "Shopping",
      "shoppingDescription": "Open items on the family shopping list",
      "shoppingPreview1": "○ Milk — 2 L",
      "shoppingPreview2": "○ Bread",
      "shoppingPreview3": "○ Apples — 1 kg",
```
  de.json:
```json
      "shoppingLabel": "Einkauf",
      "shoppingDescription": "Offene Artikel auf der Einkaufsliste",
      "shoppingPreview1": "○ Milch — 2 L",
      "shoppingPreview2": "○ Brot",
      "shoppingPreview3": "○ Äpfel — 1 kg",
```
  fr.json:
```json
      "shoppingLabel": "Courses",
      "shoppingDescription": "Articles à acheter de la liste de courses",
      "shoppingPreview1": "○ Lait — 2 L",
      "shoppingPreview2": "○ Pain",
      "shoppingPreview3": "○ Pommes — 1 kg",
```
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` (Expected: PASS)
- [ ] Commit: `feat(dashboard): add Shopping widget with visibility toggle`

---

### Task 12 — Secondary widgets to flat linen (schedule, week-overview, notes)

**Files**
- Modify `webapp/src/components/widgets/schedule-widget.tsx`
- Modify `webapp/src/components/widgets/week-overview-widget.tsx`
- Modify `webapp/src/components/widgets/notes-widget.tsx`

**Interfaces**
- Consumes: existing hooks; `WidgetCard` for headers.
- Produces: flat linen headers (icon-badge + font-display title), `text-month-primary`→`text-primary`, `hover:bg-white/5`→`hover:bg-accent/50`, no glass.

**Steps**
- [ ] schedule-widget.tsx: convert the header to the WidgetCard idiom is optional (the child-tabs in the header are bespoke). Minimal flat pass: in the `CardTitle` blocks (lines 178-184, 239-244) replace `text-xl font-medium` → `font-display text-lg font-semibold` and the icon tile `p-1.5 rounded-lg bg-month-primary/10` + `text-month-primary` → `icon-badge` span + `text-primary`. Replace every `text-month-primary`→`text-primary`, `bg-month-primary/`→`bg-primary/`, `hover:bg-white/5`→`hover:bg-accent/50`. The subject colors (`SUBJECT_CONFIG`) are functional category colors — keep as inline styles. Set the lucide icons to `strokeWidth={1.75}`.
- [ ] week-overview-widget.tsx: same header conversion (lines 145-150) to icon-badge + `font-display text-lg font-semibold`. Replace `text-month-primary`→`text-primary`, `bg-month-primary/`→`bg-primary/`, `bg-month-primary` (today circle, line 191) → `bg-primary text-primary-foreground`, `hover:bg-white/5` and `hover:bg-white/[0.03]` → `hover:bg-accent/50`. The activity-dot decorative colors (`bg-amber-400`, `bg-pink-400`) stay.
- [ ] notes-widget.tsx: convert header (lines 164-169) to icon-badge + `font-display text-lg font-semibold`. Replace `text-month-primary`→`text-primary`, `bg-month-primary/`→`bg-primary/`, `border-month-primary/30`→`border-primary/30`, `hover:bg-white/5`→`hover:bg-accent/50`. Keep the add-note flow and AlertDialog.
- [ ] All three: no glass was present (they use `Card`), so the change is purely header + token cleanup. Keep the bare `Card` (it already has `.elev-md` + rounded-2xl); add `accent-border-top` to the root `Card` if not present (week-overview/schedule/notes already have it).
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` (Expected: PASS)
- [ ] Commit: `style(widgets): flat linen headers for schedule, week-overview, notes`

---

### Task 13 — Plugin widgets glass removal (pocket-money) + settings page glass removal

**Files**
- Modify `webapp/src/components/widgets/pocket-money-widget.tsx`
- Modify `webapp/src/app/settings/widgets/page.tsx`

**Interfaces**
- Consumes: `Card` (replacing `GlassCard`).
- Produces: pocket-money widget + widgets-settings page on flat `Card` instead of `GlassCard`.

**Steps**
- [ ] pocket-money-widget.tsx: replace `import { GlassCard } from "@/components/ui/card";` (line 8) with `import { Card } from "@/components/ui/card";` and change `<GlassCard className="p-4 space-y-3 h-full">` (line 56) / `</GlassCard>` (line 78) to `<Card className="p-4 space-y-3 h-full accent-border-top">` / `</Card>`. The `AvatarDisplay`, tabs, and progress logic are preserved. (Vehicles/Stonks widgets delegate to plugin-owned `driver.WidgetCard`s and are out of scope — note as follow-up.)
- [ ] settings/widgets/page.tsx: replace `import { GlassCard } from "@/components/ui/card";` (line 21) with `import { Card } from "@/components/ui/card";` and change `<GlassCard className={...}>` (line 108) / `</GlassCard>` (line 151) to `<Card className={...}>` / `</Card>`. Replace `bg-month-primary/10`→`bg-primary/10`, `text-month-primary`→`text-primary`, `bg-background/30`→`bg-muted/40` (drop the translucent-over-background look). Keep the `Switch` + preview layout.
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` (Expected: PASS)
- [ ] Commit: `style(widgets): drop GlassCard from pocket-money + widget settings`

---

### Task 14 — Motion + reduced-motion pass; evening/dark note

**Files**
- Modify `webapp/src/components/widgets/clock.tsx` (entrance duration)
- (Documentation-only) note evening/dark variant handling in commit body.

**Interfaces**
- Consumes: framer-motion `transition`.
- Produces: durations aligned to 120/220/320ms; reduced-motion respected.

**Steps**
- [ ] In `clock.tsx` change the root `motion.div` transition (line 89) `{ duration: 0.8, ease: "easeOut" }` → `{ duration: 0.32, ease: "easeOut" }`; date `delay: 0.3, duration: 0.6` → `delay: 0.2, duration: 0.22`; greeting `delay: 0.5, duration: 0.6` → `delay: 0.32, duration: 0.22`. These align to the 320/220ms scale; framer-motion already disables transforms under `prefers-reduced-motion` via the browser when combined with `motion-reduce` utilities, and the opacity-only fades are acceptable on kiosk.
- [ ] Verify no widget uses `>0.32s` entrance durations introduced by this plan (Tasks 5-11 all use `0.22` or `0.5` delay with short durations — the `0.5` values are pre-existing delays, not durations; leave them).
- [ ] Evening/dark variant: the mockup "evening" frame is just dark mode + month theme, already handled by existing `next-themes` + `.theme-<month>`. No time-gated widget swap is built. (This is a documentation note in the commit body; no code.)
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` (Expected: PASS)
- [ ] Commit: `style(clock): align entrance motion to 320/220ms scale`

---

## Self-Review

| Scope item | Task | Notes |
|---|---|---|
| A1 page.tsx flat background, keep visibility + grid + minHeight invariant + FAB | Task 1 | `.page-gradient` replaces both glow divs; `minHeight` style preserved |
| A2 clock kiosk-hero + mono eyebrow + greeting + tabular-nums, no light glow | Task 2 | `.text-kiosk-hero`, `.text-kiosk-label`, `dark:clock-glow` |
| A3 family row PersonAvatar 64px + name + status, stagger + reduced-motion, no glow | Task 3 | new `statusEvents/statusTasks/statusNothing` keys ×3 locales; PersonDetailsDialog untouched |
| A4 today strip horizontal TodayStripPill row, flat, empty state | Task 4 | timed events sorted; person color resolved |
| B5 Weather WidgetCard, flat, keep data+modal | Task 5 | gradient dropped; stroke 1.75 |
| B6 UpcomingEvents WidgetCard + person-border (EventPill agenda) | Task 6 | location/now-badge dropped (follow-up flagged) |
| B7 Tasks WidgetCard + person Checkbox + initial avatar | Task 7 | ChecklistItem `color={person.color}`, PersonAvatar size 24 meta |
| B8 MealPlan WidgetCard (utensils) | Task 8 | meal-type colors kept as functional inline styles |
| B9 Waste WidgetCard warning + trash | Task 9 | `Badge variant="warning"`; renders null when empty (unchanged) |
| B10 Birthday WidgetCard + PersonAvatar + countdown | Task 10 | token badges (default/warning/neutral) |
| B11 NEW ShoppingWidget + type/default/page/settings/i18n ×3 | Task 11 | `shopping` added everywhere; `useUpdateShoppingItem({id,checked})` matches signature |
| B12 Secondary widgets (schedule/week-overview/notes) flat | Task 12 | token cleanup + font-display headers |
| B12/B13 Plugin widgets flat (pocket-money) + glass removal | Task 13 | GlassCard→Card; vehicles/stonks driver-owned (follow-up flagged) |
| B13 Motion pass + reduced-motion + evening/dark note | Task 14 | durations 320/220ms; dark variant = existing next-themes (no new code) |

**Type-consistency check:** `ShoppingItem` has `{id, name, quantity: number|null, unit: string|null, checked: boolean}` — ShoppingWidget reads `name/quantity/unit/checked` and calls `useUpdateShoppingItem.mutateAsync({id, checked:true})` matching `Partial<ShoppingItem> & {id}`. `Person` has `{id,name,color,avatar_url,is_child}` — PersonAvatar consumes `name/color/avatarUrl`. `WidgetVisibility` gains `shopping: boolean` in the interface, the default object, and the settings config (all `keyof WidgetVisibility`-typed). `EventPill` agenda accepts `{title,color,time?}`; `ChecklistItem` accepts `{checked,onCheckedChange,label,meta?,color?}` — all matched. `migrateLegacyWidgetVisibility` is unaffected (new optional field defaults via spread of `DEFAULT_WIDGET_VISIBILITY` at the read site in page.tsx, which already falls back to defaults when the saved blob lacks `shopping`). i18n: every new key added to en/de/fr.

---

### Author notes

- Task count: 14, each independently committable with a lint+tsc gate.
- Ambiguities resolved: (1) family per-person status — replaced count-badges with a composed status line using two plural keys + a "nothing" key (parity-safe, avoids ICU glue); (2) Tasks/Shopping rows render `checked={false}` since completing removes the item from the open list (the 120ms fill plays on tap before refetch); (3) meal/waste/subject functional category colors kept as inline styles (they are not the month accent, so the no-hardcoded-accent rule does not apply).
- Flagged for controller: UpcomingEvents agenda rows intentionally drop the inline location and "now" badge for the flat EventPill look — flagged as deeper-polish follow-up. Vehicles/Stonks widgets delegate to plugin-owned `driver.WidgetCard`s; their internal redesign is out of scope (only page-level wrapping touched).
- Deliberately deferred: time-gated evening widget swap (dark mode via existing next-themes covers the "evening" frame); deeper internal polish of secondary/plugin widgets beyond header + glass/token cleanup.