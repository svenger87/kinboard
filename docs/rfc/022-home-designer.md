# RFC-022 — Home, arranged by each family

| | |
|---|---|
| **Status** | Proposed 2026-11-18 |
| **Date** | 2026-11-18 |
| **Depends on** | The layout designer for the screensaver (#478): the `layouts` table and its routes, assignment and defaults, the 48-column grid, `resolveLayout`, `LayoutGrid`/`ListBox`/`useFitToBox`, the editor and Settings → Layouts; the screen matrix (#476); each screen's reported size (#472) |
| **Discussion** | #282 |

## 1. Why

#478 lets a family arrange the screensaver of each wall screen. Home is the
other half of the same screen, and the half people touch. Today Home is a
responsive grid: the clock block at the top, then the widgets in an order and
a visibility the family can choose, flowing into one to six columns by width.
That is good on a phone and a laptop and wrong on a wall: on the kitchen's
1080×1920 panel the widgets fill the first two thirds and the rest scrolls out
of reach, and nobody can say "the shopping list next to the meal plan, the
tasks big, the weather small".

Every request in #282 about Home has been of that kind. The layout designer
already answers it for the screensaver; this RFC extends it to Home, so a
layout describes a whole wall screen, both of its faces.

## 2. The rule: same layout, same grid, same editor

Nothing new where #478 already decided. A layout has had a `home` arrangement
since migration 086, empty until now. It uses the same grid (48 columns in steps of a quarter
cell, a 24px gap only between boxes, 48px edge; the screensaver's since the
fine-grid change, and saved layouts were converted without changing how they
look), the same assignment (a kiosk's own layout, else
the family's default for its orientation, else built-in), the same text sizes
(S/M/L/XL), the same validation and the same editor, with its tools: the grid as dots, lines or
off; snap guides while dragging (Alt drops without snapping); several boxes at
once (Shift+click or a frame) with align, distribute and same width/height;
exact X/Y/W/H in steps; arrows by a step (Shift: a cell, Alt: resize); a
refused move says why and changes nothing; one undo per command. A family
edits Home and the screensaver of one layout side by side.

What changes for a family that never opens the designer: nothing. Home stays
the responsive grid, on every device.

## 3. What it adds

### 3.1 Home widgets in a box

Every Home widget renders in a box it did not choose, with the two behaviours
#478 settled (design §5):

- **Lists show more or fewer entries** and end in "+n": upcoming events,
  tasks, shopping, notes, messages, meal plan, waste collection, countdowns,
  holidays, birthdays.
- **Single values grow with their box:** the clock, the date, the weather now,
  the pocket-money balance, a timer.

The rest gets a layout of its own that fits its box: the week overview, the
school schedule, the forecast, creatures, vehicles, stonks, the media player,
photos, the family members. Each widget gets a minimum size, as on the
screensaver. Minimums count in steps: where this RFC or the widget table
speaks of cells or columns, multiply by 4 (6 columns of width are 24 steps).

| Widget | Kind | Note |
|---|---|---|
| weather | value + fixed | now as a value; the forecast row only when the box is wide enough |
| upcomingEvents | list | |
| schedule | fixed | per child as today: one widget per child (`options.personId`) |
| birthday | list | |
| holidays | list | |
| weekOverview | fixed | seven columns; needs ≥ 24 steps (6 cells) of width |
| mealPlan | list | |
| wasteCollection | list | |
| notes | list | |
| tasks | list | ticking off stays one tap |
| shopping | list | ticking off stays one tap |
| vehicles, stonks | fixed | |
| pocketMoney | value | per child as today (`options.personId`) |
| creatures | fixed | |
| photos | fixed | the photo fills the box (cover) |
| timers | fixed | buttons stay at least 48px |
| media | fixed | |
| messages | list | |
| countdown | list | |

### 3.2 The clock block, taken apart

The block at the top of Home becomes widgets of its own, so it can be placed
like the rest: **clock** (with seconds when the family has them on),
**date and week**, **greeting**, **family members** (the avatars with their
counts), **today strip**. A new layout starts with them where they are today.

### 3.3 Touch keeps working

Home is where people act: tick off a task or an item, start a timer, open an
event, tap a member. A box changes the size, never the interaction:

- Touch targets stay at least 48px, whatever the text size; a box too small
  for a target shows fewer entries instead of smaller buttons.
- A list's "+n" opens the widget's full page (tasks → /todos, shopping →
  /shopping), as the card titles do today.
- Dialogs and sheets opened from a widget are unchanged: they open over the
  layout, not inside the box.

### 3.4 Notices that are not widgets

"Needs attention", "server unreachable", the getting-started checklist and the
install prompt appear only sometimes and vary in height. On a Home with a
layout they slide in as a strip over the top of the layout and leave when done;
the layout never moves (design §5, decided). A message sent to the screen keeps
its full-screen takeover; the festival decorations, creatures on Home and the
weather effects stay background layers.

### 3.5 What stays fixed

The navigation bar at the bottom: not placeable, and the grid's height is the
screen's minus the bar. The floating lights button stays where it is.

### 3.6 Which devices

As decided for #478: a layout applies on its own only to kiosks. A laptop or a
phone keeps today's responsive, scrolling Home unless a layout is assigned to
it explicitly, and a screen below 600px wide keeps it always.

### 3.7 The editor

The editor of a layout gets a **Home | Screensaver** switch at the top. The
canvas, palette, inspector, undo, custom sizes and "make a copy for this size"
work the same; the palette lists Home's widgets, including per-child ones once
per child. A new layout's Home starts from today's arrangement for its shape.

Settings → Widgets keeps working for screens without a layout and, like
Settings → Screensaver, says which screens use a layout instead.

## 4. Data

No migration. `layouts.home` exists (086) and holds the same items as
`screensaver` (`{ id, widget, x, y, w, h, text, options? }`). `validateItems`
learns a surface: Home's widget keys, minimums and `options.personId` (a
person of the family, checked on the server). `PATCH /api/layouts/[id]`
accepts `home` (it refuses it today).

## 5. How it would be built

| Step | What | Where |
|---|---|---|
| 1 | Home widget catalogue: kinds, minimums, default boxes, per-child options; `validateItems` and `builtInHome(width, height)` per surface | `lib/layouts/` |
| 2 | One data source for Home, like `useScreensaverData` for the screensaver, so widgets in boxes don't each fetch | `hooks/use-home-data.ts` |
| 3 | The clock block split into widgets (clock, date and week, greeting, family members, today strip), the built-in Home rendering them unchanged | `components/widgets/` |
| 4 | Each Home widget in a box: lists through `ListBox` with "+n" linking to its page, values through `useFitToBox`, fixed kinds fitting their box; 48px targets | `components/layouts/home-widgets/` |
| 5 | Home renders a designed layout: `useActiveLayout("home")`, the notices strip, nav bar outside the grid | `app/page.tsx`, `components/layouts/designed-home.tsx` |
| 6 | The editor's Home tab; Settings → Widgets' note; the routes accept `home` | editor, settings, `api/layouts/[id]` |
| 7 | Screen matrix `home-layout` view; wiki (Layouts.md gains Home, new captures); changelog | `scripts/screen-matrix.mjs`, `docs/wiki/` |

Each step ships behind the fallback: Home without a layout is the code path of
today, untouched, and the matrix's built-in Home shots must not change.

## 6. Risks

- **Twenty widgets, each in an unknown box.** Most of the work is here; each
  widget needs its own look at a small and a large box. The matrix checks
  overlaps, cut-off text and "+n" on every screen; the per-widget minimums
  are the guard.
- **Interaction in small boxes.** A box that only fits two task rows must
  still let a child tick one off. 48px targets and "+n" to the page, no
  shrinking of buttons.
- **The Pi.** Home is on screen most of the waking day. One data hook per
  page, no per-widget fetching, no new intervals; measure with the matrix's
  stack and on a Pi before the release.
- **Two screens per layout to keep in mind.** A family designing a layout now
  shapes two faces. The editor shows one at a time; a layout with only one of
  them designed uses the built-in for the other.
- **The double mount on client-side navigation (#378)** remounts the editor;
  its draft survives, but Safari can lose the first second of edits. Worth
  fixing before Home doubles the editor's use.

## 7. To decide

1. **Can a designed Home scroll?** Proposal: no. A layout is one screen; what
   does not fit shows "+n". A family that wants more makes the box bigger.
2. **Per-child widgets** (schedule, pocket money): one widget per child, each
   placed on its own (proposal), or one widget that shows all children?
3. **The compact/classic Home switch** (per browser): hidden on a screen that
   uses a layout (proposal), since the layout replaces it.
4. **Build order:** steps 1–3 first (no visible change), then the widgets in
   groups (time and family: clock, date, members, today, events, weather;
   then lists: tasks, shopping, meals, notes, messages; then the rest), then
   steps 5–7. Home with a layout ships when every widget can be placed.

## 8. Not in this RFC

Layouts that change with the time of day; sharing layouts between families;
the JSON export of layouts (a separate change); pixel placement; a phone
layout; new widgets.
