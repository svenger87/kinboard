# School schedule

The `/schedule` page — kids' weekly school timetable, with per-day pack-list reminders.

![School schedule — Mon-Fri grid with per-period subjects](images/schedule-week-grid.png)

Configured via [[Family-Members|Settings → Family members]] (mark people as "child / student") and [[Database-Schema|Settings → School schedule]] (period definitions, pack lists). The `/schedule` view is the **consumer** surface — kids check it before leaving for school.

## Layout

The page renders the active child's week in a grid:

- **Rows**: configured periods (1, 2, 3, ...)
- **Columns**: Mon / Tue / Wed / Thu / Fri
- **Cells**: subject + room + start/end time

The current period is highlighted. Empty periods (free hours) show as subtle gray.

## Per-child view

If you have multiple kids in school, the page header has a person-picker. Tap a child's avatar → their schedule appears.

The dashboard's **schedule widget** also picks one child (the one who's most-actively using the kiosk based on touch-fingerprint correlation, or the first child you marked). To see the others, navigate to `/schedule`.

## Pack list

Below the schedule grid, a **pack list** shows what to bring for tomorrow's classes. Pulled from:

- **Per-subject pack items** — "Bring sportswear for PE" — configured in [[Database-Schema|Settings → School schedule → Pack list]]
- **Tomorrow's actual classes** — only items relevant to subjects in tomorrow's grid show up

Example: tomorrow has PE → pack list shows "Sportswear, Sneakers, Water bottle". Reset every morning.

## Configuration

Three things to configure in **Settings → School schedule**:

### 1. Periods (the time grid)

The default is 8 periods, 45 min each, with German-school-style breaks:

```
1. 08:00–08:45
2. 08:50–09:35
   (break 15 min)
3. 09:50–10:35
4. 10:40–11:25
   (break 15 min)
5. 11:40–12:25
6. 12:30–13:15
   (lunch)
7. 14:00–14:45
8. 14:50–15:35
```

Edit these via the **gear icon** in the page header → **Edit period grid**. Each period has start + end time. Add / remove rows as your school's bell schedule requires.

### 2. Subjects

Each unique subject is a row in `public.subjects` with:
- **Name**
- **Color** (per-subject visual differentiation)
- **Icon** (Lucide icon name; Math → Calculator, English → BookOpen, etc.)

Configure in Settings → School schedule. Subjects are family-wide — if both kids share a school, share their subjects.

### 3. Pack lists

Per-subject "what to bring". Each pack list is a comma-separated list of items, e.g. `Sportswear, Sneakers, Water bottle` for PE.

Pack lists are family-wide so all kids' schedules read from the same lookup. If different schools require different items per subject, customize via per-subject names (e.g. "PE - Anna's school" vs "PE - Tom's school").

## Day-detail panel

Tap a cell → side panel showing:

- Subject name + color/icon
- Time range
- Room (if recorded)
- Edit button to change subject / room / time

Tap an empty cell → "Add lesson" dialog.

## Patterns that work well

- **Morning routine**: kids glance at the kiosk while eating breakfast → "okay, today is Math first period in Room A12"
- **Friday-night-prep**: parent + kid review next week's schedule together, pre-pack anything weird
- **Substitute schedule**: when school sends a one-off "no Math today, German instead" note, edit the cell directly. Reverts to the regular schedule by default the next week.

## Persistence

- `public.subjects` — subjects per family
- `public.schedules` — one row per (child, day-of-week) with `time_slots` JSONB array
- `public.settings.schedule_periods` — period grid (12 periods × start/end)
- `public.settings.schedule_pack_items` — pack list per subject

Real-time published, so editing on a phone propagates to the kitchen wall in ~1 s.

## What's not supported

- **Multi-week / rotating schedules** (A/B weeks). Workaround: edit the whole week each Sunday for the next week.
- **Substitute / cancellation tracking.** Edit cells directly when changes happen; no historical record.
- **Homework tracking per subject.** Use [[Tasks-and-Todos]] tagged with the subject name as a workaround.
- **Multiple schools per family with different period grids.** One grid for the whole family.

## Related

- [[Family-Members]] — mark a person as "child" to enable schedule features
- [[Dashboard]] — schedule widget shows today's lessons
- [[Tasks-and-Todos]] — homework / project assignments
