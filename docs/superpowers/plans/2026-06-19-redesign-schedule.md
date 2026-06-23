# Plan 11 — Redesign SCHEDULE (Stundenplan) to "Salbei / Leinen"

For agentic workers: use superpowers:subagent-driven-development.

## Goal

Bring `webapp/src/app/schedule/page.tsx` onto the shipped "Salbei / Leinen" foundation: remove every `GlassCard`/glass surface, swap the `month-primary` token for the rotating `primary` accent, replace the inline shadcn Avatar child tabs with a `PersonAvatar` + Foundation pill `ToggleGroup`, turn empty grid cells into dashed placeholders, and rebuild the mobile "pack for tomorrow" block as an interactive (session-local) `ChecklistItem` list plus a vertical tomorrow-lesson list. Per-subject category colors (from the DB `subjects` table) stay inline — they are functional category colors, not the month accent. All data, period, and current-period logic is preserved verbatim.

## Architecture

- Single page component (`schedule/page.tsx`, ~974 lines) plus three i18n bundles and the changelog. No new components, no new hooks, no schema change.
- Data flow unchanged: `usePeople()` → children; `useSchedules(selectedChildId)` → `Schedule[]`; `useSubjects()` → per-subject color/icon via `getSubjectColor`/`getSubjectIcon`; `useSetting("schedule_pack_items", DEFAULT_PACK_ITEMS)` → pack matching. The `grid` / `maxPeriods` / `subjectStats` / `packReminders` memos and the `getCurrentPeriodForDay` logic are kept exactly as-is.
- The pack checklist is a NEW, intentionally session-local interaction: a component `useState<Set<string>>` holding checked keys (`` `${subject}:${item}` ``). It is NOT persisted — it resets on reload, which is correct for a daily "what to pack tomorrow" aid. This is a real interaction (you tick items as you pack), not a fake feature; document it as ephemeral by design.
- Subject colors stay inline (`${color}15` backgrounds, `borderLeft 3px solid ${color}`). The "never hardcode the accent" rule applies only to the month/primary accent, which moves to `primary`/`primary`-tints; per-subject category colors are a documented exception.

## Tech Stack

Next.js 16 (App Router) · React 19 · Tailwind · shadcn/ui · framer-motion · next-intl (EN+DE+FR parity is a CI gate) · date-fns. Reuse Foundation + Plan 2–10 primitives: `PersonAvatar`, `Card`/`CardContent` (flat), `ChecklistItem`, `Badge`, `ToggleGroup`/`ToggleGroupItem` (pill variant), `.page-gradient`, `.elev-*`.

## Global Constraints

- No `next build` locally. Per-task gate: `cd webapp && npm run lint` and `npx tsc --noEmit`. No unit tests — verification = lint+tsc+structural self-review; live smoke deferred. Do NOT write Jest/RTL/TDD steps.
- Reuse Foundation + Plan 2-10 components; never hardcode accent hex (primary/tints); per-SUBJECT category colors come from the DB `subjects` table inline (documented exception); NO literal text-white on primary surfaces (`text-primary-foreground`). Lucide stroke 1.75. Times `font-mono`/`tabular-nums`.
- NO glass/backdrop-blur on app surfaces (removes GlassCard from /schedule). NO fake features (the pack checklist is a real session-local interaction; do NOT pretend it persists). Theme-following.
- Touch targets ≥44px. next-intl EN/DE/FR parity (CI gate). Reduced-motion respected.
- Commits: Conventional Commits, NO `Co-Authored-By: Claude` trailer. One commit per task.

---

### Task 1: Desktop grid + child tabs + shell

**Files**
- `webapp/src/app/schedule/page.tsx`

**Interfaces**
- Consumes: `PersonAvatar` (`@/components/person-avatar`), `ToggleGroup`/`ToggleGroupItem` (`@/components/ui/toggle-group`, pill variant via `toggleVariants`), `Card`/`CardContent` (`@/components/ui/card`), `.page-gradient`, existing `getSubjectColor`/`getSubjectIcon`/`grid`/`maxPeriods`/`getCurrentPeriodForDay`.
- Produces: the loading/error/no-children/main shells using `.page-gradient` + flat `Card`; child selector as a `PersonAvatar` (size 24) + pill `ToggleGroup`; the today-progress strip and desktop week-grid table as flat `Card`s with `primary` accent and dashed empty cells.

**Steps**

- [ ] Update imports. Replace the card import line:
  ```tsx
  import { GlassCard } from "@/components/ui/card";
  ```
  with:
  ```tsx
  import { Card, CardContent } from "@/components/ui/card";
  ```
  Replace the avatar import line:
  ```tsx
  import { Avatar, AvatarFallback } from "@/components/ui/avatar";
  ```
  with:
  ```tsx
  import { PersonAvatar } from "@/components/person-avatar";
  import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
  ```

- [ ] Remove the now-unused `getInitials` helper (it was only used by the old `AvatarFallback`). Delete this block:
  ```tsx
  function getInitials(name: string): string {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  ```

- [ ] Swap the three early-return shells' gradient divs. The loading, error, and no-children returns each open with:
  ```tsx
      <main id="main-content" className="min-h-screen relative overflow-hidden">
        <div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none" />
  ```
  Replace EACH of the three occurrences with:
  ```tsx
      <main id="main-content" className="min-h-screen relative overflow-hidden">
        <div className="page-gradient" />
  ```
  (Use `replace_all` on the exact gradient `<div>` line — there are four occurrences total including the main return; replacing all four here is correct.)

- [ ] No-children card: replace
  ```tsx
          <GlassCard className="p-8 text-center">
            <GraduationCap className="size-16 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h2 className="text-xl font-semibold mb-2">{t("noChildrenTitle")}</h2>
            <p className="text-muted-foreground mb-4">
              {t("noChildrenDescription")}
            </p>
            <Button variant="month" asChild>
              <Link href="/settings/people">{t("noChildrenAction")}</Link>
            </Button>
          </GlassCard>
  ```
  with:
  ```tsx
          <Card>
            <CardContent className="p-8 pt-8 text-center">
              <GraduationCap className="size-16 mx-auto mb-4 text-muted-foreground opacity-50" strokeWidth={1.75} />
              <h2 className="text-xl font-semibold mb-2">{t("noChildrenTitle")}</h2>
              <p className="text-muted-foreground mb-4">
                {t("noChildrenDescription")}
              </p>
              <Button variant="default" asChild>
                <Link href="/settings/people">{t("noChildrenAction")}</Link>
              </Button>
            </CardContent>
          </Card>
  ```

- [ ] Child tabs → PersonAvatar + pill ToggleGroup. Replace the entire `actions={...}` block on the main `PageHeader`:
  ```tsx
          actions={
            <>
              {children.length > 1 && (
                <Tabs value={selectedChildId || ""} onValueChange={setSelectedChildId}>
                  <TabsList>
                    {children.map((child) => (
                      <TabsTrigger key={child.id} value={child.id} className="gap-2">
                        <Avatar className="size-5" style={{ border: `2px solid ${child.color}` }}>
                          <AvatarFallback
                            className="text-[10px]"
                            style={{ backgroundColor: `${child.color}20`, color: child.color }}
                          >
                            {child.avatar_url && !child.avatar_url.startsWith("http") ? (
                              child.avatar_url
                            ) : (
                              getInitials(child.name)
                            )}
                          </AvatarFallback>
                        </Avatar>
                        <span className="hidden sm:inline">{child.name}</span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              )}
              {children.length === 1 && selectedChild && (
                <Badge
                  variant="outline"
                  className="text-sm px-3 py-1"
                  style={{ borderColor: selectedChild.color, color: selectedChild.color }}
                >
                  {selectedChild.avatar_url && !selectedChild.avatar_url.startsWith("http") && (
                    <span className="mr-1">{selectedChild.avatar_url}</span>
                  )}
                  {selectedChild.name}
                </Badge>
              )}
            </>
          }
  ```
  with:
  ```tsx
          actions={
            <>
              {children.length > 1 && (
                <ToggleGroup
                  type="single"
                  variant="pill"
                  value={selectedChildId || ""}
                  onValueChange={(value) => { if (value) setSelectedChildId(value); }}
                  className="flex-wrap justify-end gap-1.5"
                  aria-label={t("childSelectorAria")}
                >
                  {children.map((child) => (
                    <ToggleGroupItem
                      key={child.id}
                      value={child.id}
                      className="h-11 gap-2 rounded-full px-3"
                    >
                      <PersonAvatar
                        name={child.name}
                        color={child.color}
                        avatarUrl={child.avatar_url}
                        size={24}
                      />
                      <span className="hidden sm:inline">{child.name}</span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}
              {children.length === 1 && selectedChild && (
                <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
                  <PersonAvatar
                    name={selectedChild.name}
                    color={selectedChild.color}
                    avatarUrl={selectedChild.avatar_url}
                    size={24}
                  />
                  <span className="text-sm font-medium">{selectedChild.name}</span>
                </div>
              )}
            </>
          }
  ```
  Note: pill `ToggleGroupItem` height is forced to `h-11` (44px touch target). The `Tabs`/`TabsList`/`TabsTrigger` import is still used elsewhere? It is NOT — confirm by removing it in the next step.

- [ ] Drop the now-unused `Tabs` import. Remove:
  ```tsx
  import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
  ```
  (`Badge` is still used by the progress strip / mobile cards / tomorrow header, so keep it.)

- [ ] Today-progress strip: convert the `GlassCard` wrapper to a flat `Card` and recolor the progress bar. Replace:
  ```tsx
              <GlassCard className="overflow-hidden">
                <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
  ```
  with:
  ```tsx
              <Card className="overflow-hidden">
                <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
  ```
  And its closing tag — replace the matching `</GlassCard>` (the one immediately before `</motion.div>` inside this IIFE, line ~584) with `</Card>`.

- [ ] Recolor the progress bar fill. In the today-progress strip replace:
  ```tsx
                      <motion.div
                        className="h-full rounded-full bg-month-primary"
  ```
  with:
  ```tsx
                      <motion.div
                        className="h-full rounded-full bg-primary"
  ```

- [ ] No-schedule empty card: replace
  ```tsx
            <GlassCard className="overflow-hidden">
              <div className="p-8 text-center">
                <GraduationCap className="size-12 mx-auto mb-3 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground">{t("noScheduleMessage")}</p>
                <Button variant="outline" className="mt-4" asChild>
                  <Link href="/settings/schedule">{t("noScheduleAction")}</Link>
                </Button>
              </div>
            </GlassCard>
  ```
  with:
  ```tsx
            <Card className="overflow-hidden">
              <div className="p-8 text-center">
                <GraduationCap className="size-12 mx-auto mb-3 text-muted-foreground opacity-50" strokeWidth={1.75} />
                <p className="text-muted-foreground">{t("noScheduleMessage")}</p>
                <Button variant="outline" className="mt-4" asChild>
                  <Link href="/settings/schedule">{t("noScheduleAction")}</Link>
                </Button>
              </div>
            </Card>
  ```

- [ ] Desktop week-grid table: flatten the wrapper and recolor today's header. Replace the opening:
  ```tsx
              {/* Desktop: Full week grid table */}
              <GlassCard className="overflow-hidden hidden md:block">
  ```
  with:
  ```tsx
              {/* Desktop: Full week grid table */}
              <Card className="overflow-hidden hidden md:block">
  ```
  And replace its matching closing `</GlassCard>` (line ~793, immediately after `</div>` that wraps the `<table>`) with `</Card>`.

- [ ] Desktop weekday header cells: recolor today. Replace:
  ```tsx
                        {DAYS.map((day, index) => (
                          <th
                            key={day}
                            className={`p-3 text-center text-sm font-medium border-b border-border/50 ${
                              index === currentDayIndex
                                ? "text-month-primary bg-month-primary/5"
                                : "text-muted-foreground"
                            }`}
                          >
                            {day}
                          </th>
                        ))}
  ```
  with:
  ```tsx
                        {DAYS.map((day, index) => (
                          <th
                            key={day}
                            className={`p-3 text-center text-sm font-medium border-b border-border/50 ${
                              index === currentDayIndex
                                ? "text-primary bg-primary/5"
                                : "text-muted-foreground"
                            }`}
                          >
                            {day}
                          </th>
                        ))}
  ```

- [ ] Desktop time/period column: make times monospaced. Replace:
  ```tsx
                            <td className="p-3 text-xs text-muted-foreground align-top">
                              <div className="font-medium">{period}.</div>
                              <div className="text-[10px]">{periodTime}</div>
                            </td>
  ```
  with:
  ```tsx
                            <td className="p-3 text-xs text-muted-foreground align-top">
                              <div className="font-medium tabular-nums">{period}.</div>
                              <div className="text-[10px] font-mono">{periodTime}</div>
                            </td>
  ```

- [ ] Desktop today-column tint + current-period ring: recolor `month-primary` → `primary`. Replace:
  ```tsx
                                <td
                                  key={dayIndex}
                                  className={`p-2 align-top ${
                                    isToday ? "bg-month-primary/5" : ""
                                  }`}
                                >
  ```
  with:
  ```tsx
                                <td
                                  key={dayIndex}
                                  className={`p-2 align-top ${
                                    isToday ? "bg-primary/5" : ""
                                  }`}
                                >
  ```
  And replace:
  ```tsx
                                      className={`p-3 rounded-lg transition-all ${
                                        isCurrentPeriod ? "ring-2 ring-month-primary ring-offset-2 ring-offset-background" : ""
                                      }`}
  ```
  with:
  ```tsx
                                      className={`p-3 rounded-lg transition-all ${
                                        isCurrentPeriod ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
                                      }`}
  ```

- [ ] Desktop empty cells → dashed placeholder (replaces the `—` em dash). Replace:
  ```tsx
                                  ) : (
                                    <div className="p-3 text-center text-muted-foreground/30 text-xs">
                                      —
                                    </div>
                                  )}
  ```
  with:
  ```tsx
                                  ) : (
                                    <div
                                      className="h-full min-h-[3.25rem] rounded-lg border border-dashed border-border/60"
                                      aria-label={t("freePeriodAria")}
                                    />
                                  )}
  ```

- [ ] Add the subject icon `strokeWidth={1.75}` on the desktop cell icon for Lucide consistency. Replace:
  ```tsx
                                            <SubjectIcon
                                              className="size-3.5 shrink-0"
                                              style={{ color: getSubjectColor(slot.subject) }}
                                            />
  ```
  with:
  ```tsx
                                            <SubjectIcon
                                              className="size-3.5 shrink-0"
                                              strokeWidth={1.75}
                                              style={{ color: getSubjectColor(slot.subject) }}
                                            />
  ```

- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected: PASS. (Note: the mobile cards, pack-reminders, tomorrow-preview, and weekly-stats sections still reference `GlassCard` and `month-primary` at this point; they are migrated in Task 2. `GlassCard` import was removed in step 1, so `tsc`/lint WILL fail here on those remaining references.) **Therefore: do NOT run the gate until Task 2 is complete — Tasks 1 and 2 edit the same file and must land in one commit.** Skip the gate+commit for Task 1; proceed directly to Task 2.

> NOTE TO IMPLEMENTER: Task 1 and Task 2 both edit `schedule/page.tsx` and together remove the last `GlassCard`/`month-primary` references. Run the lint/tsc gate and commit ONCE, at the end of Task 2. Do not commit a half-migrated file.

---

### Task 2: Mobile cards + pack-for-tomorrow checklist + tomorrow lesson list

**Files**
- `webapp/src/app/schedule/page.tsx`

**Interfaces**
- Consumes: `ChecklistItem` (`@/components/checklist-item`), `Card`, `getSubjectColor`/`getSubjectIcon`, the existing `packReminders` / `reminderTargetDay` / `reminderDayLabel` / `isReminderWeekend` derivations, the existing tomorrow-preview IIFE derivations, `useState`/`useCallback` (already imported).
- Produces: mobile per-day flat `Card`s (today `ring-primary/50` + `bg-primary/10`); a "Für morgen einpacken" `Card` with a primary-gradient header and an interactive `ChecklistItem` packing list backed by local `useState<Set<string>>` (ephemeral); the tomorrow-preview rebuilt as a vertical lesson list of flat cards with `font-mono` start time + `borderLeft 3px solid ${color}`; weekly-stats as a flat `Card`; all `month-primary` → `primary`.

**Steps**

- [ ] Add the `ChecklistItem` import (group with the other component imports near the top):
  ```tsx
  import { ChecklistItem } from "@/components/checklist-item";
  ```

- [ ] Add the session-local checked-state. Immediately after the `const [selectedChildId, setSelectedChildId] = useState<string | null>(null);` line, add:
  ```tsx
  // Pack checklist is intentionally session-local (ephemeral): you tick items as
  // you pack for tomorrow; it resets on reload. No DB persistence by design.
  const [packedKeys, setPackedKeys] = useState<Set<string>>(new Set());
  const togglePacked = useCallback((key: string) => {
    setPackedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  ```
  (Reset on child switch is desirable so the list matches the visible child; add a reset effect after the existing auto-select effect:)
  ```tsx
  // Reset the ephemeral pack-check state when switching child.
  useEffect(() => {
    setPackedKeys(new Set());
  }, [selectedChildId]);
  ```

- [ ] Mobile per-day cards: flatten + recolor. Replace:
  ```tsx
                    <GlassCard
                      key={day}
                      className={`overflow-hidden ${isToday ? "ring-2 ring-month-primary/50" : ""}`}
                    >
                      <div className={`px-4 py-2.5 border-b border-border/50 ${isToday ? "bg-month-primary/10" : ""}`}>
                        <div className="flex items-center justify-between">
                          <span className={`font-medium text-sm ${isToday ? "text-month-primary" : "text-muted-foreground"}`}>
                            {day}
                          </span>
  ```
  with:
  ```tsx
                    <Card
                      key={day}
                      className={`overflow-hidden ${isToday ? "ring-2 ring-primary/50" : ""}`}
                    >
                      <div className={`px-4 py-2.5 border-b border-border/50 ${isToday ? "bg-primary/10" : ""}`}>
                        <div className="flex items-center justify-between">
                          <span className={`font-medium text-sm ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                            {day}
                          </span>
  ```
  And replace its matching closing `</GlassCard>` (line ~677, after the `divide-y` block) with `</Card>`.

- [ ] Mobile current-period row tint + monospaced time. Replace:
  ```tsx
                              className={`flex items-center gap-3 px-4 py-3 ${
                                isCurrentPeriod ? "bg-month-primary/10" : ""
                              }`}
                            >
                              <div className="text-xs text-muted-foreground w-10 shrink-0 text-center">
                                <div className="font-medium">{period}.</div>
                                <div className="text-[10px]">{slot.start}</div>
                              </div>
  ```
  with:
  ```tsx
                              className={`flex items-center gap-3 px-4 py-3 ${
                                isCurrentPeriod ? "bg-primary/10" : ""
                              }`}
                            >
                              <div className="text-xs text-muted-foreground w-10 shrink-0 text-center">
                                <div className="font-medium tabular-nums">{period}.</div>
                                <div className="text-[10px] font-mono">{slot.start}</div>
                              </div>
  ```
  And add `strokeWidth={1.75}` to the mobile subject icon — replace:
  ```tsx
                                <SubjectIcon className="size-4 shrink-0" style={{ color }} />
  ```
  with:
  ```tsx
                                <SubjectIcon className="size-4 shrink-0" strokeWidth={1.75} style={{ color }} />
  ```

- [ ] Rebuild the Pack-Reminders section as "Für morgen einpacken" with a primary-gradient header + interactive checklist. Replace the ENTIRE block:
  ```tsx
        {/* Pack Reminders for Tomorrow */}
        {maxPeriods > 0 && packReminders.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-6"
          >
            <GlassCard className="overflow-hidden">
              <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2">
                <Backpack className="size-4 text-month-primary" />
                <h2 className="text-xl font-medium">
                  {isReminderWeekend ? t("packListMonday") : t("packListTomorrow", { day: reminderDayLabel })}
                </h2>
              </div>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {packReminders.map((reminder) => {
                  const ReminderIcon = reminder.icon;
                  return (
                    <div
                      key={reminder.subject}
                      className="flex items-start gap-3 p-3 rounded-lg"
                      style={{ backgroundColor: `${reminder.color}10` }}
                    >
                      <div
                        className="p-2 rounded-lg shrink-0"
                        style={{ backgroundColor: `${reminder.color}20` }}
                      >
                        <ReminderIcon className="size-4" style={{ color: reminder.color }} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium mb-1" style={{ color: reminder.color }}>
                          {reminder.subject}
                        </p>
                        <ul className="space-y-0.5">
                          {reminder.items.map((item) => (
                            <li key={item} className="text-xs text-muted-foreground flex items-center gap-1.5">
                              <span className="size-1 rounded-full shrink-0" style={{ backgroundColor: reminder.color }} />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          </motion.div>
        )}
  ```
  with:
  ```tsx
        {/* Pack for tomorrow — interactive, session-local checklist (ephemeral by design) */}
        {maxPeriods > 0 && packReminders.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-6"
          >
            <Card className="overflow-hidden">
              <div className="bg-gradient-to-br from-primary to-primary/80 px-4 py-4 text-primary-foreground">
                <div className="flex items-center gap-2">
                  <Backpack className="size-5" strokeWidth={1.75} />
                  <h2 className="text-lg font-semibold">
                    {isReminderWeekend ? t("packForMonday") : t("packForTomorrow")}
                  </h2>
                </div>
                <p className="mt-1 font-mono text-xs uppercase tracking-wider text-primary-foreground/80">
                  {(isReminderWeekend ? t("packListMonday") : t("packListTomorrow", { day: reminderDayLabel }))}
                </p>
              </div>
              <CardContent className="space-y-2 p-4 pt-4">
                {packReminders.flatMap((reminder) =>
                  reminder.items.map((item) => {
                    const key = `${reminder.subject}:${item}`;
                    return (
                      <ChecklistItem
                        key={key}
                        checked={packedKeys.has(key)}
                        onCheckedChange={() => togglePacked(key)}
                        color={reminder.color}
                        label={item}
                        meta={
                          <span className="text-xs font-medium" style={{ color: reminder.color }}>
                            {reminder.subject}
                          </span>
                        }
                      />
                    );
                  })
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}
  ```
  Note: `packReminders` items each carry `{ subject, items, icon, color }`; the icon is no longer rendered here (the checkbox + per-subject color carry the meaning). This keeps `reminder.icon` referenced only inside the memo; that is fine — it stays in the produced object shape unchanged.

- [ ] Rebuild the Tomorrow-preview as a vertical lesson list of flat cards. Replace the ENTIRE block:
  ```tsx
              <GlassCard className="overflow-hidden">
                <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="size-4 text-month-primary" />
                    <h2 className="text-xl font-medium">
                      {isWeekend ? t("tomorrowMonday") : t("tomorrowDay", { day: dayLabel })}
                    </h2>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {t("tomorrowPeriodCount", { count: tomorrowSlots.length })}
                  </Badge>
                </div>
                <div className="p-4">
                  <div className="flex gap-2 flex-wrap">
                    {tomorrowSlots.map((slot, i) => {
                      const color = getSubjectColor(slot.subject);
                      const SubjectIcon = getSubjectIcon(slot.subject);
                      return (
                        <motion.div
                          key={`${slot.period}-${slot.subject}`}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.3 + i * 0.04 }}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                          style={{
                            backgroundColor: `${color}15`,
                            borderLeft: `2px solid ${color}`,
                            color,
                          }}
                        >
                          <SubjectIcon className="size-3" />
                          <span>{slot.subject}</span>
                          <span className="text-muted-foreground font-normal ml-0.5">{slot.start}</span>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              </GlassCard>
  ```
  with:
  ```tsx
              <Card className="overflow-hidden">
                <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="size-4 text-primary" strokeWidth={1.75} />
                    <h2 className="text-xl font-medium">
                      {isWeekend ? t("tomorrowMonday") : t("tomorrowDay", { day: dayLabel })}
                    </h2>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {t("tomorrowPeriodCount", { count: tomorrowSlots.length })}
                  </Badge>
                </div>
                <CardContent className="space-y-2 p-4 pt-4">
                  {tomorrowSlots.map((slot, i) => {
                    const color = getSubjectColor(slot.subject);
                    const SubjectIcon = getSubjectIcon(slot.subject);
                    return (
                      <motion.div
                        key={`${slot.period}-${slot.subject}`}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.3 + i * 0.04 }}
                        className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 elev-sm"
                        style={{ borderLeft: `3px solid ${color}` }}
                      >
                        <span className="font-mono text-xs font-bold tabular-nums" style={{ color }}>
                          {slot.start}
                        </span>
                        <SubjectIcon className="size-4 shrink-0" strokeWidth={1.75} style={{ color }} />
                        <span className="flex-1 text-sm font-semibold">{slot.subject}</span>
                      </motion.div>
                    );
                  })}
                </CardContent>
              </Card>
  ```

- [ ] Weekly-stats section: flatten + recolor header icon. Replace:
  ```tsx
            <GlassCard className="overflow-hidden">
              <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart3 className="size-4 text-month-primary" />
                  <h2 className="text-xl font-medium">{t("weeklyTitle")}</h2>
                </div>
  ```
  with:
  ```tsx
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart3 className="size-4 text-primary" strokeWidth={1.75} />
                  <h2 className="text-xl font-medium">{t("weeklyTitle")}</h2>
                </div>
  ```
  And replace the weekly-stats closing `</GlassCard>` (line ~966) with `</Card>`.

- [ ] Verify there are zero remaining `GlassCard` and zero remaining `month-primary` references in the file (search the file). If any remain, the gate will fail — fix before committing.

- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected: PASS.

- [ ] Commit (Tasks 1 + 2 in ONE commit):
  ```
  feat(schedule): flat Salbei/Leinen weekly grid with avatar child tabs, dashed free periods, and mobile pack checklist
  ```

---

### Task 3: i18n parity + changelog

**Files**
- `webapp/messages/en.json`
- `webapp/messages/de.json`
- `webapp/messages/fr.json`
- `CHANGELOG.md`

**Interfaces**
- Consumes: the new translation keys referenced in Tasks 1–2 (`childSelectorAria`, `freePeriodAria`, `packForTomorrow`, `packForMonday`).
- Produces: identical key sets across en/de/fr (CI parity gate) + a `[Unreleased]` changelog entry.

**Steps**

- [ ] Add four new keys to the `schedule` namespace in `webapp/messages/en.json`. Insert after the existing `"roomLabel"` line:
  ```json
    "roomLabel": "Room {room}",
    "childSelectorAria": "Select child",
    "freePeriodAria": "Free period",
    "packForTomorrow": "Pack for tomorrow",
    "packForMonday": "Pack for Monday",
  ```

- [ ] Add the same keys to `webapp/messages/de.json` (after that file's `"roomLabel"`):
  ```json
    "childSelectorAria": "Kind auswählen",
    "freePeriodAria": "Freistunde",
    "packForTomorrow": "Für morgen einpacken",
    "packForMonday": "Für Montag einpacken",
  ```

- [ ] Add the same keys to `webapp/messages/fr.json` (after that file's `"roomLabel"`):
  ```json
    "childSelectorAria": "Sélectionner l'enfant",
    "freePeriodAria": "Heure libre",
    "packForTomorrow": "À préparer pour demain",
    "packForMonday": "À préparer pour lundi",
  ```
  (Match each file's existing indentation and trailing-comma placement — read the surrounding lines first; the `schedule.days`/`daysShort` objects follow, so a trailing comma after the last inserted scalar is required.)

- [ ] Add the `[Unreleased] → Changed` changelog entry in `CHANGELOG.md`. Append to the existing `### Changed` list:
  ```markdown
  - Schedule redesigned to the flat "Salbei/Leinen" look: avatar-based child selector pills, a weekly grid with the month accent on today's column and dashed placeholders for free periods, and a "Pack for tomorrow" card with an interactive (session-local) packing checklist plus a tomorrow lesson list. Removed glassmorphism from the page.
  ```

- [ ] Verify JSON validity + EN/DE/FR key parity for the `schedule` namespace:
  ```bash
  cd webapp && node -e "const e=require('./messages/en.json'),d=require('./messages/de.json'),f=require('./messages/fr.json');const k=o=>Object.keys(o.schedule).sort().join(',');const ke=k(e),kd=k(d),kf=k(f);if(ke!==kd||ke!==kf){console.error('PARITY FAIL');process.exit(1);}console.log('parity OK');"
  ```
  Expected: `parity OK`.

- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected: PASS.

- [ ] Commit:
  ```
  i18n(schedule): add child-selector, free-period, and pack-for-tomorrow strings (EN/DE/FR) + changelog
  ```

---

## Self-Review

**Scope-item → task mapping**

- Scope 1 (desktop grid + child tabs + shell): Task 1 — `.page-gradient` shell (all four gradient divs), GlassCard→flat Card (no-children, today-progress, no-schedule, desktop table, recolored progress bar), child tabs → `PersonAvatar` size 24 + pill `ToggleGroup` (single-child rendered as a flat pill div), desktop today header `text-primary`+`bg-primary/5`, monospaced period/time column, current-period `ring-2 ring-primary ring-offset-2`, empty cells → `border border-dashed border-border/60 rounded-lg`, all `month-primary`→`primary`. Subject cells keep `${color}15` bg + `borderLeft 3px solid ${color}` (inline subject colors preserved, documented exception). All data/period/current-period logic untouched.
- Scope 2 (mobile + pack + tomorrow): Task 2 — mobile per-day cards GlassCard→flat Card with today `ring-primary/50` + `bg-primary/10` header, monospaced times; Pack-Reminders rebuilt as a "Für morgen einpacken" Card with a primary-gradient header (`bg-gradient-to-br from-primary to-primary/80` + `text-primary-foreground`, no literal white) and a flattened interactive `ChecklistItem` list backed by `useState<Set<string>>` (key `${subject}:${item}`, `color={reminder.color}`), documented session-local/ephemeral; Tomorrow-preview rebuilt as a vertical lesson list of flat cards with `font-mono` start time + `borderLeft 3px solid ${color}`; weekly-stats flattened; `month-primary`→`primary`.
- Scope 3 (i18n + changelog): Task 3 — four new keys in EN/DE/FR with parity verified; `[Unreleased] → Changed` entry. Existing `schedule.*` keys reused (`packListMonday`/`packListTomorrow` reused as the gradient-header subline; `tomorrowMonday`/`tomorrowDay`/`tomorrowPeriodCount`/`weeklyTitle`/`nowBadge`/`todayBadge`/day names all reused unchanged).

**Type-consistency check**

- `PersonAvatar` props: `name: string`, `color: string`, `avatarUrl?: string | null`, `size?: number` — `child.avatar_url` is `string | null` on `Person`, matches `avatarUrl`. ✔
- `ChecklistItem` props: `checked: boolean`, `onCheckedChange: (checked: boolean) => void` (we call `togglePacked(key)` ignoring the arg — valid), `label: ReactNode` (string), `meta?: ReactNode` (span), `color?: string`. ✔
- `ToggleGroup type="single"` + `onValueChange: (value: string) => void` (Radix single-mode) — guarded against empty deselect (`if (value) setSelectedChildId(value)`). `variant="pill"` flows through `toggleVariants` context to `ToggleGroupItem`. ✔
- `Set<string>` state with functional updater; `togglePacked` is `useCallback`-stable. ✔
- Removed imports (`GlassCard`, `Avatar`/`AvatarFallback`, `Tabs`/`TabsList`/`TabsTrigger`, `getInitials`) — confirm none referenced after edits (Task 2 final verify step + lint's no-unused gate). ✔

**Flagged deferrals**

- `schedule-widget.tsx` is OUT OF SCOPE (stale static `SUBJECT_CONFIG`; pre-existing, not this plan's concern).
- `settings/schedule` was flattened in Plan 7 — NOT touched here.
- Live/visual smoke deferred (per Global Constraints): verification is lint + `tsc` + structural self-review only.
- The pack checklist is intentionally NOT persisted (session-local); a future plan could persist per-child packed-state if users ask, but that would be a new feature with a schema change — explicitly out of scope.
- `reminder.icon` remains in the `packReminders` memo's produced shape though it is no longer rendered in the checklist; harmless and left unchanged to avoid touching the data memo. The `getSubjectIcon` import stays used by the desktop/mobile grid and the tomorrow list.
