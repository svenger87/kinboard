# RFC-020 — Festival decorations on Home and the screensaver

| | |
|---|---|
| **Status** | Idea, with a feasibility study. Nothing built |
| **Date** | 2026-11-01 |
| **Depends on** | the Animations switch (#421), weather effects (#420, #429), holiday regions (RFC-014), drawn creatures (RFC-016) |

## 1. Why

The weather effects showed that a wall display that changes with the world
outside is something families notice and like. Festivals are the other thing
that changes the feel of a house: in December the kitchen has an Advent
wreath, in October the kids carve pumpkins. Kinboard knows the date, the
family's holiday region and, since #421, how much each screen may move. It
could join in:

- **Santa's sleigh** crossing the top of Home now and then in Advent, and
  across the screensaver's photos.
- **Still decorations on the widgets**: a little snow on each card's top edge
  at Christmas, a string of lanterns for Lunar New Year, a pumpkin in a corner
  at Halloween.
- **The children's creatures** wearing something for the season: the open
  "cosmetics" item from RFC-016 §2.

**Verdict: feasible, and mostly an artwork job.** The layer it needs (a
non-interactive overlay behind the widgets, capped at 30 frames a second,
paused when hidden, obeying the Animations switch) already exists as
`components/weather-effects.tsx`. The dates for every festival in §3 can be
worked out in the browser without a network call, Diwali excepted (§3.2). The
cost is drawing each scene well, which is the same kind of work RFC-016's
creatures were.

![Mockup: Home at Christmas. The sleigh crosses the hero band, snow rests on each widget card's top edge, and the creature wears a Santa hat](020/home-christmas.svg)

*The mockups in this RFC are SVGs drawn by `020/mockups.py`. They show
placement and motion, not final artwork. The animated ones (the sleigh,
snow, diya flames) play in a browser, and stop when the viewer asks for
reduced motion.*

## 2. What it looks like

Three layers. A festival can use any of them.

| Layer | What | Moves? | Where |
|---|---|---|---|
| **Visitor** | Something crosses the screen once in a while: the sleigh with reindeer, the Easter bunny hopping along the bottom, bats at Halloween, a dragon dance for Lunar New Year, fireworks at midnight on New Year's Eve | yes, for ~10 s per pass | Home and the screensaver |
| **Dressing** | Still decorations on the widget cards: snow caps, a garland, bunting, lanterns, a pumpkin, diyas | no | Home's widget grid |
| **Creature outfit** | A Santa hat, bunny ears, a witch's hat on the drawn creatures | the creature's own idle loop only | wherever a creature is drawn |

### 2.1 Visitors

![Mockup: motion paths for six visitors. The sleigh arcs across the hero band, the bunny hops along the bottom edge, bats zig-zag to the moon, fireworks burst at midnight, lanterns rise, and diyas light one by one](020/visitors.svg)

Each visitor has one path and one duration, and stays clear of the widgets.
Fireworks are the exception: they burst above the hero for a minute at the
family's midnight and are gone before anyone needs the screen.

**Visitors are rare on purpose.** On Home, one pass every 15–20 minutes is a
nice surprise, not a distraction, and the canvas runs only while a visitor is
on screen, so an idle display costs nothing between passes. On the screensaver
they can come more often (every few minutes). There they also help against
burn-in, alongside the existing pixel shift (`BURN_IN_OFFSETS`).

![Mockup: the screensaver at Christmas. The sleigh crosses in front of the moon over a snowy photo, below the clock](020/screensaver-christmas.svg)

### 2.2 Dressing

![Mockup: one widget card dressed for six festivals: snow and lights for Christmas, confetti and a burst for New Year's Eve, lanterns for Lunar New Year, bunting and eggs for Easter, a cobweb, bat and pumpkin for Halloween, a marigold garland and diyas for Diwali](020/dressing.svg)

**Dressing never covers content.** It sits on a card's border and corner, in
the padding, never over text or a control, and is checked at 320 px, on a
wall display, and in WebKit. Chromium alone has missed layout bugs before.

### 2.3 Creature outfits

![Mockup: the same creature in six outfits: a Santa hat, a party hat, a red cap with a lantern, bunny ears, a witch's hat, a marigold garland with a diya](020/creature-outfits.svg)

One accessory per festival, drawn to fit every species' head (RFC-016's
skeleton gives each one the same anchor), so a festival adds one drawing,
not fourteen.

## 3. Which festivals, and where the dates come from

"Worldwide" can't mean "the family's region". The 38 regions Kinboard offers
(RFC-014) are almost all European, plus US, MX, BR and ZA, and the bundled
holiday data has no Lunar New Year, Diwali or Hanukkah. A family in Hamburg
may celebrate Eid, and a family in Texas may celebrate Lunar New Year. So the
festivals are **chosen by the family** (§4), and their dates come from a
small module of their own, `lib/festivals.ts`, not from the region data.

### 3.1 The candidate list

| Festival | Decorated | Date from | Verified |
|---|---|---|---|
| Christmas | 1st Advent → 6 Jan | fixed; Advent from 25 Dec | — |
| New Year's Eve | 31 Dec, fireworks at the family's midnight | fixed | — |
| Easter (Western) | Palm Sunday → Easter Monday | Gregorian computus, ~10 lines | — |
| Easter (Orthodox) | the same week, Julian computus | computus | RS, BG, RO, MD, BY are offered regions |
| Halloween | 24 → 31 Oct | fixed | — |
| Día de Muertos | 31 Oct → 2 Nov | fixed | MX is an offered region |
| Lunar New Year | eve → Lantern Festival (15th day) | `Intl` `chinese` calendar, month 1 day 1 | 2026-02-17, 2027-02-07 ✓ |
| Eid al-Fitr | 3 days | `Intl` `islamic-umalqura`, Shawwal 1 | 2026-03-20, 2027-03-09 ✓ |
| Eid al-Adha | 4 days | `Intl` `islamic-umalqura`, Dhu al-Hijjah 10 | 2026-05-27, 2027-05-16 ✓ |
| Hanukkah | 8 nights | `Intl` `hebrew`, Kislev 25 | 2026-12-05, 2027-12-25, 2028-12-13 ✓ |
| Passover | 8 days | `Intl` `hebrew`, Nisan 15 | 2026-04-02, 2027-04-22 ✓ |
| Nowruz | 1 day + the days around it | `Intl` `persian`, Farvardin 1 | 2026-03-21 ✓ |
| Diwali | 5 days | **a date table** (§3.2) | — |
| Valentine's Day, St Patrick's Day, Carnival, St Nicholas, Midsummer | the day (or the season for Carnival) | fixed, or Easter-relative for Carnival | — |

The ✓ dates were computed with `Intl.DateTimeFormat` in Node 22 on
2026-11-01 and checked against published calendars. `Intl` calendars ship
with full ICU, which Chromium (the wall displays and the Pi), Safari and Node
all have. WebKit still needs checking in the spec run, because a missing
calendar there would silently produce no festival rather than an error.

### 3.2 Where it's harder

- **Diwali** follows the Hindu lunisolar calendar, which `Intl` doesn't have:
  its `indian` calendar is the solar Śaka calendar. Diwali needs a table of
  dates (2026–2036 is eleven lines). A spec should fail once the table has
  less than two years left in it, so it gets topped up long before it runs
  out.
- **The Islamic calendar** in `islamic-umalqura` is Saudi Arabia's
  astronomical one. A community that goes by moon sighting can be a day off.
  The windows are several days long, so the decorations are up either way.
- **Midnight on New Year's Eve** is the family's midnight, in the family's
  time zone (the calendar already has one), not the display's or the
  server's.

## 4. Who chooses, and how much moves

- **The family chooses its festivals** under Settings → Design →
  *Festivals*. The list is pre-ticked from the region: Christmas, New Year's
  Eve and Easter (Western or Orthodox, by region) where the region's data has
  them, and Halloween where it's an observance in the region's data (US, GB,
  IE…). Everything else is off until someone ticks it, so a religious or
  cultural festival is never assumed. One switch turns all of it off.
- **Each screen's Animations switch decides how much of it moves**, as with
  the weather:
  - **On:** visitors, dressing and outfits.
  - **Reduced:** dressing and outfits only; nothing crosses the screen.
  - **Off:** nothing at all, including still dressing, matching what *Off*
    means for weather effects.
- **Preview**, as for the weather: `/?festival-preview=christmas` on Home,
  and a *Preview* button per festival in settings. The festival maintainer
  can check a scene in July without changing the clock.

## 5. How it would be built

![Diagram: when the canvas runs. Home has a pass every 15 to 20 minutes and is idle in between; the screensaver every 3 to 5 minutes; dressing is drawn once by CSS. Below: the scheduler (Waiting, Flying, Gone) and what each Animations setting allows](020/animation-model.svg)

All of it is drawn in code, so the artwork belongs to Kinboard (as RFC-016
decided for the creatures). There are no asset packs to licence and nothing
to fetch, which matters on LAN-only installs.

| Piece | Reuses | New |
|---|---|---|
| `lib/festivals.ts` (pure): `festivalDates(id, year)`, `activeFestivals(date, chosen, timeZone)` | the holiday region (defaults), the family time zone | the date rules in §3, the Diwali table. Fast-suite spec with the dates above |
| A `festivals` family setting (chosen list, on/off) | `useSetting`, `SETTINGS_KEYS`, re-read every minute like the weather effects (#429) | a key and a settings section in en/de/fr |
| `<FestivalVisitors>` canvas | the `EffectsCanvas` loop: `FRAME_MS`, `devicePixelRatio` capped at 1.5, `visibilitychange`, `useMotion()`, sprites drawn once | a scheduler that starts the loop for one pass and stops it again |
| Dressing | `<html data-motion>`, which is set before first paint; same idea | `<html data-festival="christmas">`, plus CSS in `globals.css` on Home's widget grid (one hook on the grid, so none of the 27 widgets changes) |
| Creature outfits | `CreatureAvatar`'s per-species parts | one accessory slot per festival, shared by all species |
| Screensaver | `components/screensaver.tsx` layers | the visitor canvas above the photo, below the clock |

Home mounts `<FestivalVisitors>` next to `<WeatherEffects>` (`app/page.tsx`).
Both can run at once, for example snow falling while the sleigh crosses. They
use separate canvases, but each visitor sprite is cached and only one visitor
flies at a time, so the cost of the two together stays close to weather alone.
This should be measured on the Pi before step 2 ships, not assumed.

## 6. Steps

| Step | What | When it's worth having |
|---|---|---|
| 1 | `lib/festivals.ts` with all dates and specs; the setting; `data-festival`; **Christmas only**: the sleigh, snow-capped cards, a Santa hat on the creatures | before the 1st of Advent, **29 Nov 2026** |
| 2 | New Year's Eve: fireworks at the family's midnight; New Year's Day keeps a last few | 31 Dec 2026 |
| 3 | Lunar New Year (lanterns, a dragon), Easter (Western and Orthodox) | 17 Feb 2027 / Mar–Apr 2027 |
| 4 | The rest of §3.1, as each one's artwork is ready | through 2027 |

Step 1 is small in code and large in drawing. If the sleigh isn't good
enough by mid-November, the snow-capped cards and the hat can ship alone, and
the sleigh can follow in December.

## 7. Risks

- **Taste.** A decoration that looks cheap is worse than none. Every scene
  should be tried on the maintainer's devices before it ships, as the
  creatures were.
- **Cultural care.** The festival list defaults to what the region marks, and
  everything else is the family's choice. Imagery stays festive rather than
  devotional: lights, lanterns, food and animals, no religious symbols.
- **The Pi.** Weather effects already run on it at 30 frames a second. One
  visitor at a time, cached sprites and no animation between passes keep this
  in the same budget, but it needs measuring (step 1).
- **Keeping it fresh.** The Diwali table needs a reminder that fails in time
  (§3.2). Every other date is computed.

## 8. Open questions for the owner

1. Do visitors fly **behind the widgets** (seen in the gaps and the hero, like
   the snow) or **over them** for the length of a pass?
2. How often on Home: every 15–20 min, or only on the screensaver?
3. Which festivals are pre-ticked by region? §4 proposes the region's own
   public holidays plus New Year's Eve, and Halloween where it's marked.
4. Should a tap on the sleigh do something for the kids (a shower of stars,
   or a creature cheering)? It's an easy delight, but it means the visitor
   catches taps while it flies, which the weather never does.
5. Birthdays: a family member's birthday as a "festival" of its own (bunting
   and a balloon on Home) is a natural next step, and the birthday widget
   already knows the dates.

## 9. Not in this RFC

- Sounds. A wall display that jingles is a different decision.
- Decorations a family uploads or draws itself.
- Changing the month colour wash (#422) per festival. The wash already
  follows the month, and the two would compete.
