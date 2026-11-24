# Layouts

A layout is your own arrangement of a wall screen, both of its faces: its [screensaver](Screensaver) and its [Home](Dashboard). For each it says which widgets show, where, how large, and at what text size. You draw it once for a screen size, assign it to one or more screens, and those screens show it instead of the built-in screensaver and Home.

![The layout editor: the widget palette on the left, a 1080×1920 screen in the middle with the events selected, the inspector on the right](images/layouts-editor.png)

Nothing changes for a family that never creates a layout: every screen keeps the built-in screensaver and today's Home until a layout is assigned to it, or set as a default for wall screens. A layout can arrange just one face; the other stays built-in until you draw it.

## What a layout is

- **Named and owned by the family** — "Küche hochkant", "Flur quer". Every device of the family can see it; only a parent with the [settings PIN](Security-and-Threat-Model#the-settings-pin) can change it.
- **Made for one screen size** — a width and a height in CSS pixels, the size the page is drawn at on that screen. Settings → Devices shows the size each screen reports, including the browser's scaling (a 1080×1920 panel at Windows 150% draws pages at 720×1280).
- **Drawn on a grid** — 48 columns, each step a quarter of a square cell. The 24px gap sits only between boxes, and the screen's edges are 48px away. Widgets snap to steps, so two widgets can never overlap and the spacing stays even. Layouts made before the finer grid look exactly as they did.
- **Shared where you want** — several screens can use the same layout; editing it changes all of them.

## Creating a layout

<img src="images/settings-layouts.png" alt="Settings — Layouts: two layouts, Küche hochkant (1080×1920, portrait default) and Flur quer (1920×1080, landscape default), with the screens they are assigned to" width="720"/>

**Settings → Layouts → New layout.** Give it a name and pick the screen it is for:

- **Your screens** — each of the family's devices that has reported its size ("Küche — 1080×1920").
- **Common sizes** — Full HD portrait and landscape, each at 100% and 150% scaling, and a tablet both ways.
- **Custom size…** — any width and height. A layout needs a page at least 600px wide with room for six rows of cells; the form says so when a size is too small.

A new layout starts from the built-in arrangements for that shape — the screensaver as it is today, and Home with the clock across the top and your cards below in your order — so you rearrange rather than start from an empty screen. **Duplicate** makes a copy with the same arrangement and size, not assigned to any screen; **Delete** asks first and names the screens that go back to the built-in screensaver (or to the default layout).

## The editor

The editor shows the screen at its true proportions, scaled to fit, with the real widgets and your family's real data: your events, birthdays, weather and news, as the wall will show them.

A **Home | Screensaver** switch at the top picks which face you are arranging. Everything below works the same on both; only the palette changes, and undo, Reset and Save cover the face you are on.

- **Move** a widget by dragging it; it snaps to the grid (and to other boxes, see Tools). A widget cannot be dropped on top of another.
- **Resize** it by dragging its corner. Each widget has a minimum size (the inspector shows it); it will not go smaller.
- **Palette** (left) — the widgets not yet on the screen. On the screensaver: clock, date, next event, weather now, forecast, events, birthdays, holidays, news, lessons, energy, Tesla and the photo count. On Home: see [Home](#home) below. Click one to add it in the first free space; each widget appears once (on Home, once per child where it is per child).
- **Inspector** (right) — the selected widget's position and size (X, Y, W, H, in steps; the minimum size is shown), its **text size** (Small, Medium, Large, Extra large) and **Remove**.
- **Undo / Redo** — every change in this session, also with Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y).
- **Keyboard** — see the table under Tools; Delete removes the selection, Escape deselects.
- **Reset** puts the built-in arrangement back (undoable until you leave the page); **Save** writes the layout, and the screens using it update within a second or two.

Unsaved changes survive the settings PIN locking in the middle of an edit. If someone else saved the same layout meanwhile, Save says so and offers to reload rather than overwrite their work.

### Tools

![The layout editor with three boxes selected (news, weather now and the forecast): the grid shown as dots, and the inspector's Arrange buttons for aligning, distributing and matching sizes](images/layouts-editor-arrange.png)

- **Grid** — the toolbar shows it as dots and lines, as lines, or not at all; the choice is remembered in this browser.
- **Guides** — while you drag or resize, a box snaps within one step of another box's edge or centre, or of the screen's centre, and a line shows what it lined up with. Hold Alt (Option) while dragging to drop exactly where you let go.
- **Several boxes** — Shift+click adds to the selection, or drag a frame on empty canvas. With several selected you can align left, right, top, bottom or centre, distribute horizontally or vertically (the outermost boxes stay), or give them the same width or height (as the first selected). Delete removes all of them.
- **Exact values** — the inspector has X, Y, W and H as number fields, in steps. A value that doesn't fit is refused with the reason.
- **Refused moves** — a move or command that can't be done says why and changes nothing. Each command is one undo.

| Keys | Does |
| --- | --- |
| Arrow | Move one step |
| Shift + arrow | Move a whole cell (four steps) |
| Alt + arrow | Resize one step |
| Alt + Shift + arrow | Resize a whole cell |
| Delete | Remove the selected boxes |
| Escape | Deselect |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |

After an update to Kinboard, reload screens and editors that were open: an editor still running the old version can't save (it shows an error) and changes not saved before the update are lost. If Kinboard itself detects that the page is out of date, it says so ("Kinboard was updated…") and offers to reload.

### How widgets fill their box

- **Lists** (events, birthdays, holidays, news, lessons) show as many whole entries as fit and end with "+3 more" for the rest. A taller box shows more entries; the text stays at its size.
- **Single values** (clock, date, next event, weather now, photo count) grow to fill their box.
- **The forecast** shows as many forecast slots as the box is wide enough for. **Energy** and **Tesla** can be as small as half a cell high: in a flat box their figures sit side by side, otherwise they are stacked. They use the box's text size and get smaller only when that does not fit.

Text sizes follow the screen's short side, so a layout looks the same on every screen of its shape.

A widget whose feature is not set up — no weather service, the Tesla plugin switched off, no lessons — shows a hint in the editor and an empty space on the screen. Nothing moves to fill it.

## Home

<!-- SCREENSHOT PLACEHOLDER (RFC-022): a designed Home on a 1080×1920 wall screen.
     Source: webapp/e2e/screen-matrix/portrait-1080__de__home-layout.png
     (node scripts/screen-matrix.mjs --code DEMO01 --views home-layout --only portrait-1080 --locales de)
     Save as images/home-designed.png, then replace this comment with:
     ![A designed Home on a 1080×1920 wall screen](images/home-designed.png) -->

<!-- SCREENSHOT PLACEHOLDER (RFC-022): the same on a 1920×1080 landscape screen.
     Source: webapp/e2e/screen-matrix/landscape-1080__de__home-layout.png
     Save as images/home-designed-landscape.png. -->

Home is the face people touch: they tick off a task, start a timer, open an event. Its built-in arrangement is a grid that flows into one to six columns by width — right on a phone or a laptop, but on a tall wall panel the lower cards scroll out of reach. A designed Home puts each card where you want it, at the size you want, on one screen.

### What a designed Home is

- **One screen, never scrolling.** Everything sits on the grid between the top of the screen and the navigation bar. A list that has more entries than its box shows ends with **"+3 more"**, and tapping that opens the full page (tasks → Tasks, shopping → Shopping), as a card's title does today. Want to see more? Make the box bigger.
- **The clock block, taken apart.** The block at the top of today's Home is five widgets you place on their own: **clock** (with seconds if you have them on under Settings → Theme), **date and week**, **greeting**, **family members** (the avatars with their counts) and **today strip**. A new layout starts with them across the top, where they are today; move them apart, shrink them, or leave one out.
- **The cards of Settings → Widgets** — weather, upcoming events, schedule, birthdays, holidays, week overview, meal plan, waste collection, notes, tasks, shopping, vehicles, stonks, pocket money, creatures, photos, timers, media player, messages and countdowns.
- **One widget per child.** The schedule and pocket money appear in the palette once for each child, so each child's timetable or balance can sit where that child looks.

### How Home's widgets fill their box

- **Lists** (upcoming events, tasks, shopping, notes, messages, meal plan, waste collection, countdowns, holidays, birthdays, the today strip) show as many whole entries as fit and end with "+n" for the rest.
- **Single values** (clock, date, greeting, pocket money) grow to fill their box.
- **Weather** shows the weather now, and its forecast row only when the box is wide enough.
- **The others** (week overview, schedule, family members, creatures, vehicles, stonks, media player, photos, timers) arrange themselves to fit. The week overview needs its seven days, so it is at least half the screen wide; the photo fills its box.

Touch keeps working whatever the size: buttons and rows stay at least 48px tall, and a box too small for another row shows one fewer entry rather than smaller buttons. Ticking off a task or a shopping item is still one tap, and dialogs opened from a widget open over the whole screen, not inside its box.

### What stays as it is

- **The navigation bar** at the bottom is not part of the layout; the grid ends above it. The floating **lights** button stays where it is.
- **Notices** that come and go — "Needs attention", "Server unreachable", the getting-started checklist, the install prompt — slide in as a strip over the top of the layout and leave when they are done. The layout itself never moves.
- A **message** sent to the screen still takes over the whole screen. The **festival** decorations, the **creatures** walking along Home and the **weather effects** stay in the background.
- Settings → Widgets → *Compact home layout* is hidden on a screen that uses a layout: the layout decides where the clock and the people go.

### Which screens use it

A designed Home follows the same rules as the screensaver (see below), with one difference that matters for phones and laptops:

- **Wall screens** (kiosks) use their own layout, or the family's default for the way they are turned.
- **Laptops and phones** keep today's responsive, scrolling Home, unless a layout is assigned to that device directly in Settings → Devices.
- **Screens under 600px wide** always keep today's Home, whatever is assigned.

Settings → Widgets keeps working for every screen without a layout. Like Settings → Screensaver, it says which screens use a layout instead, since its switches and order do not apply there.

<!-- SCREENSHOT PLACEHOLDER (RFC-022): the editor on its Home tab (not produced by the
     screen matrix; capture by hand once the editor's Home tab has landed).
     Save as images/layouts-editor-home.png and images/layouts-editor-home-light.png. -->

## Assigning it to screens

<img src="images/settings-devices-layout.png" alt="Settings — Devices: the Küche screen with its layout picker set to Küche hochkant" width="720"/>

- **Per screen** — Settings → Devices has a **Layout** picker under each device: *Built-in* or one of your layouts.
- **Defaults for wall screens** — Settings → Layouts → *Default layouts* has a **portrait default** and a **landscape default**. A wall screen (a device marked as a kiosk) without a layout of its own uses the default for the way it is turned. Each picker only offers layouts of its orientation.

Which layout a screen shows, in order:

1. its own layout, if the layout's orientation matches the way the screen is turned;
2. the family's default for that orientation — wall screens (kiosks) only;
3. the built-in screensaver and Home.

The same layout gives a screen both faces: the screensaver when it is idle, Home when it is touched.

So a tablet turned on its side moves from its own portrait layout to the landscape default, and back when turned again. Devices that are not kiosks (a laptop, a phone) only ever use a layout assigned to them directly.

Settings → Devices says what each screen will show: "Uses the default layout “Küche hochkant”", or a warning when a screen's shape is far from its layout's ("Made for 1080×1920 — this screen is 1280×800"). Settings → Screensaver notes which screens use a layout, since its own switches (news, forecast, number of events and birthdays, *Large clock and events*) apply only to screens without one.

## On screens of other sizes

A layout drawn for 1080×1920 also runs on a 720×1280 screen (the same panel at 150%): positions and sizes are stored in grid steps, so it scales. When the other screen has a different number of rows — a tablet at 800×1280, say — the rows are scaled proportionally, minimum sizes win, and a widget that no longer fits is left out. Settings → Devices lists what a screen leaves out ("Not shown on this screen: Birthdays").

In the editor, the screen picker previews the layout on any other size. The preview is read-only and names what does not fit. To arrange the layout for that size, **Make a copy for this size**: the copy is a new layout of that size, redrawn from the saved one. Widgets that lost their place are moved into free cells first, shrinking toward their minimum, and only those that still do not fit are left out; the new editor lists them ("Not on this size: Birthdays") so you can make room and add them back from the palette.

![The same layout copied for a 1920×1080 landscape screen, open in the editor](images/layouts-copy-landscape.png)

## What stays the same

A layout arranges the widgets. On the screensaver, everything around them is unchanged (for Home, see [What stays as it is](#what-stays-as-it-is)):

- the **photo** in the background, its rotation and its credit;
- the **weather effects** (Settings → Screensaver → *Weather effects*);
- the children's **creatures** along the bottom (Settings → Creatures);
- the **festival** decorations and visitors (Settings → Design → Festivals);
- the **night** view: during the family's bedtime, with *Night* on, the dim clock on black replaces the layout too;
- a **message** sent to the screen still takes over the whole screen, and a touch still wakes it.

The "touch to unlock" hint is not shown over a designed layout; the layout owns the screen.

![A designed screensaver on a 1080×1920 wall screen](images/screensaver-designed.png)

## What's not supported (yet)

- **Phones and narrow screens keep the built-in screensaver and Home.** Below 600px wide (or with room for fewer than six rows) the grid's cells would be a few pixels wide, so a layout assigned to such a screen is not drawn there. There is no separate phone layout.
- **A Home that scrolls.** A designed Home is one screen; what does not fit shows "+n".
- **Pixel-exact placement, colours and fonts.** Widgets snap to the grid; the text size is the one style choice per widget.
- **Layouts that change with the time of day**, beyond the night view.

## Related

- [Screensaver](Screensaver) — the built-in screensaver, photos, presence and night
- [Dashboard](Dashboard) — today's Home, its widgets and Settings → Widgets
- [People and devices](People-and-Devices) — marking a screen as a kiosk, and the size each screen reports
- [Security-and-Threat-Model](Security-and-Threat-Model#the-settings-pin) — the settings PIN that guards layouts
