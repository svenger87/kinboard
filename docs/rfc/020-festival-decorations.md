# RFC-020 — Festival decorations on Home and the screensaver

| | |
|---|---|
| **Status** | Idea with a feasibility study; the owner's decisions are in (§8). Nothing built |
| **Date** | 2026-11-01 |
| **Depends on** | the Animations switch (#421), weather effects (#420, #429), the colour wash (#422), holiday regions (RFC-014), drawn creatures and the creature shop (RFC-016, RFC-017) |

## 1. Why

The weather effects showed that a wall display that changes with the world
outside is something families notice and like. Festivals are the other thing
that changes the feel of a house: in December the kitchen has an Advent
wreath, in October the kids carve pumpkins. Kinboard knows the date, the
family's holiday region and, since #421, how much each screen may move. It
can join in:

- **Santa's sleigh** flying over Home and the screensaver every couple of
  minutes in Advent. Tap it, and presents and stars come down.
- **Decorations on the widgets**: snow on each card's top edge at Christmas,
  lanterns for Lunar New Year, a pumpkin at Halloween.
- **The children's creatures** wearing a Santa hat, bunny ears or a witch's
  hat.
- **The colour wash** turning festive: Christmas red from the top, pine green
  from the bottom.

**Verdict: feasible, and mostly an artwork job.** The layer it needs (a
non-interactive canvas, capped at 30 frames a second, paused when hidden,
obeying the Animations switch) already exists as
`components/weather-effects.tsx`. The creatures already have slots for things
to wear (RFC-017's shop), and the colour wash is one CSS rule. The dates for
every festival in §3 can be worked out in the browser without a network call,
Diwali excepted (§3.2). The cost is drawing each scene well, the same kind of
work RFC-016's creatures were.

![Mockup on a screenshot of Kinboard's Home at Christmas: the sleigh flies over the widgets, snow sits on every card, the creatures wear Santa hats, a tap has dropped presents and stars, and the colour wash is red and green](020/home-christmas.svg)

*The mockups are built on screenshots of Kinboard itself: a throwaway
household on a local stack, at 1080p, with the weather stubbed and the clock
set to a Saturday in Advent (`020/capture.cjs`). The snow, lights, sleigh and
presents are drawn over the measured card positions (`020/mockups.py`). The
colour wash and the creatures' hats are not drawn over the screenshot: they
are the real CSS and the real creatures, with the festival item swapped into
the creature's head slot. The sleigh, snow and flames are animated in a
browser and stop when the viewer asks for reduced motion.*

## 2. What it looks like

Four layers. A festival can use any of them.

| Layer | What | Moves? | Where |
|---|---|---|---|
| **Visitor** | Something flies over the screen: the sleigh with reindeer, the Easter bunny, bats, lanterns, fireworks at the family's midnight. A tap on it drops presents and stars | ~10 s per pass, **every 2 minutes** | Home and the screensaver, **over the widgets** |
| **Dressing** | Still decorations on the widget cards: snow, lights, bunting, lanterns, a pumpkin, diyas | no | Home's widget grid |
| **Outfit** | A festival item in the creature's head slot | the creature's own idle loop | wherever a creature is drawn |
| **Colour wash** | The month's wash (#422) in two festival colours instead | no | every page |

### 2.1 Visitors

![The six visitors' paths, drawn over a screenshot of Kinboard's Home: the sleigh over the widgets, the bunny hopping along them, bats out of a corner, fireworks over the clock, lanterns rising through the widgets, diyas lighting along the cards' edge](020/visitors.svg)

**Over the widgets, every 2 minutes.** A pass takes about ten seconds, so the
canvas runs about 8% of the time and is stopped in between: no frames, no
work. Each pass takes a slightly different path, so it never parks over the
same card twice in a row. On the screensaver the same rhythm also moves
pixels against burn-in, alongside the existing shift (`BURN_IN_OFFSETS`).

**A tap does something.** Tapping the visitor drops presents and a shower of
stars, and the creatures on that screen cheer, reusing their live reaction
(#367). Only the visitor's own shape catches the tap: one transparent button
that moves with the sprite. A tap anywhere else reaches the widget beneath as
always. After one tap the visitor stops catching taps for the rest of its
pass, so a tap meant for the Events card that lands on the sleigh costs one
surprise, not a stuck screen.

![Mockup on a screenshot of Kinboard's screensaver: the sleigh crosses the middle of the screen while snow falls](020/screensaver-christmas.svg)

### 2.2 Dressing

![Kinboard's Events card, from a screenshot, dressed for six festivals: snow and lights for Christmas, confetti and a burst for New Year's Eve, lanterns for Lunar New Year, bunting and eggs for Easter, a cobweb and a pumpkin for Halloween, a marigold garland and diyas for Diwali](020/dressing.svg)

**Dressing never covers content.** It sits on a card's border and corners, in
the padding, never over text or a control. It is checked at 320 px, on a wall
display, and in WebKit, because Chromium alone has missed layout bugs here
before.

### 2.3 Outfits: a festival item in the shop's slots

![Kinboard's own Drake and Unicorn wearing a festival item in the head slot for six festivals](020/creature-outfits.svg)

RFC-017's creature shop already gives every creature four slots (head, face,
neck, background), with each item drawn once in a head-sized space and
placed on every species by `onHead()`. A festival outfit is **one more item
per festival in the head slot**, drawn the same way. The hats in the mockup
are exactly that: the shop's cap swapped for a festival hat inside the real
component, on the real Drake and Unicorn.

- During the festival, the festival item is worn instead of the child's own
  head item. The child's own item comes back the day after.
- A child can switch festival outfits off for their own creature (a kid-side
  field, like `style` and `look`).
- Festival items are not for sale and cost no points.

### 2.4 Colour wash

![Screenshots of Kinboard's Home with the colour wash and the creatures' hat for six festivals](020/colour-wash.svg)

Today the wash is one colour, the month's (`--month-primary`), glowing from
the top and rising from the bottom (`body::before` in `globals.css`). During
a festival it takes **two colours**, one for the top and one for the bottom,
at **the same strength** as the month's wash today (14% and 10% in dark mode),
so contrast doesn't change. The screenshots above are the real rule with
those two colours set. It is colour, not motion, so it stays on every
Animations setting, as the month's wash does now.

When two festivals overlap (Hanukkah during Advent, New Year's Eve on
Christmas's last days), **the shorter one wins on its own days**: it sets the
wash, the dressing and the visitor, and the longer one comes back after.

## 3. Which festivals, and where the dates come from

"Worldwide" can't mean "the family's region". The 38 regions Kinboard offers
(RFC-014) are almost all European, plus US, MX, BR and ZA, and the bundled
holiday data has no Lunar New Year, Diwali or Hanukkah. A family in Hamburg
may celebrate Eid, and a family in Texas may celebrate Lunar New Year. So the
festivals are **chosen by the family** (§4). Their dates come from a small
module of their own, `lib/festivals.ts`, not from the region data.

### 3.1 The festivals, their dates, and where they are pre-ticked

The owner's rule: **pre-tick the festivals that are common in the family's
country.** The last column is that rule, as a table `lib/festivals.ts` keeps
per offered country. It is reviewed whenever a region is added.

| Festival | Decorated | Date from | Pre-ticked in |
|---|---|---|---|
| Christmas | 1st Advent → 6 Jan | fixed | all 38 |
| New Year's Eve | 31 Dec, fireworks at the family's midnight | fixed | all 38 |
| Easter (Western) | Palm Sunday → Easter Monday | Gregorian computus, ~10 lines | all except the five below |
| Easter (Orthodox) | the same week, Julian computus | computus | RS, BG, RO, MD, BY |
| Halloween | 24 → 31 Oct | fixed | US, GB, IE |
| Día de Muertos | 31 Oct → 2 Nov | fixed | MX |
| Thanksgiving | its weekend | 4th Thursday of November | US |
| Carnival | the week before Ash Wednesday | Easter − 46 days | BR |
| St Nicholas | 5–6 Dec | fixed | NL, BE, LU, DE, AT, CH, CZ, SK, PL |
| St Patrick's Day | 17 Mar | fixed | IE |
| Midsummer | its eve and day | per country | SE, EE, LV, LT |
| Lunar New Year | eve → Lantern Festival (15th day) | `Intl` `chinese`, month 1 day 1 (2026-02-17, 2027-02-07 ✓) | — |
| Eid al-Fitr | 3 days | `Intl` `islamic-umalqura`, Shawwal 1 (2026-03-20, 2027-03-09 ✓) | — |
| Eid al-Adha | 4 days | `Intl` `islamic-umalqura`, Dhu al-Hijjah 10 (2026-05-27, 2027-05-16 ✓) | — |
| Hanukkah | 8 nights | `Intl` `hebrew`, Kislev 25 (2026-12-05, 2027-12-25, 2028-12-13 ✓) | — |
| Passover | 8 days | `Intl` `hebrew`, Nisan 15 (2026-04-02, 2027-04-22 ✓) | — |
| Nowruz | the days around Farvardin 1 | `Intl` `persian` (2026-03-21 ✓) | — |
| Diwali | 5 days | **a date table** (§3.2) | — |
| Valentine's Day | 14 Feb | fixed | — |

"—" means it isn't common across any offered country as a whole, so a family
ticks it. A religious or cultural festival is never assumed.

The ✓ dates were computed with `Intl.DateTimeFormat` in Node 22 on
2026-11-01 and checked against published calendars. `Intl` calendars ship
with full ICU, which Chromium (the wall displays and the Pi), Safari and Node
all have. WebKit still needs checking in the spec run, because a missing
calendar there would silently produce no festival rather than an error.

### 3.2 Where it's harder

- **Diwali** follows the Hindu lunisolar calendar, which `Intl` doesn't have:
  its `indian` calendar is the solar Śaka calendar. Diwali needs a table of
  dates (2026–2036 is eleven lines). A spec fails once the table has less
  than two years left in it, so it gets topped up long before it runs out.
- **The Islamic calendar** in `islamic-umalqura` is Saudi Arabia's
  astronomical one. A community that goes by moon sighting can be a day off.
  The windows are several days long, so the decorations are up either way.
- **Midnight on New Year's Eve** is the family's midnight, in the family's
  time zone (the calendar already has one), not the display's or the
  server's.

## 4. Who chooses, and how much moves

- **The family chooses its festivals** under Settings → Design →
  *Festivals*. The list starts with the country's common festivals ticked
  (§3.1); everything else is one tick away. One switch turns all of it off.
- **Each screen's Animations switch decides how much of it moves**, as with
  the weather:
  - **On:** everything.
  - **Reduced:** dressing, outfits (still) and the colour wash; no visitors.
  - **Off:** the colour wash only, as the month's wash today. No visitors,
    no dressing, no idle loop.
- **Preview**, as for the weather: `/?festival-preview=christmas` on Home,
  and a *Preview* button per festival in settings, so a scene can be checked
  in July without changing the clock.

## 5. How it would be built

![Diagram: a pass every 2 minutes on Home and the screensaver; dressing and the colour wash cost no frames; the scheduler (Waiting, Flying, Gone, and Tapped from Flying); what each Animations setting allows](020/animation-model.svg)

All of it is drawn in code, so the artwork belongs to Kinboard (as RFC-016
decided for the creatures). There are no asset packs to licence and nothing
to fetch, which matters on LAN-only installs.

| Piece | Reuses | New |
|---|---|---|
| `lib/festivals.ts` (pure): `festivalDates(id, year)`, `activeFestival(date, chosen, timeZone)`, `commonFestivals(country)` | the holiday region, the family time zone | the date rules and the pre-tick table in §3, the Diwali table, the overlap rule (§2.4). Fast-suite spec with the dates above |
| A `festivals` family setting (chosen list, on/off) | `useSetting`, `SETTINGS_KEYS`, re-read every minute like the weather effects (#429) | a key and a settings section in en/de/fr |
| `<FestivalVisitors>` | the `EffectsCanvas` loop: `FRAME_MS`, `devicePixelRatio` capped at 1.5, `visibilitychange`, `useMotion()`, sprites drawn once | a 2-minute scheduler that starts the loop for one pass and stops it again; a canvas above the widgets with `pointer-events: none`, plus one transparent button that follows the sprite and takes the tap |
| The tap | the creatures' live reaction (#367) | presents and stars on the canvas |
| Dressing | `<html data-motion>`, set before first paint; same idea | `<html data-festival="christmas">`, plus CSS in `globals.css` on Home's widget grid (one hook on the grid, so none of the widgets changes) |
| Outfits | RFC-017's head slot, `onHead()`, `items.tsx` | one head item per festival; a kid-side switch to opt out |
| Colour wash | `body::before` and its opacities (#422) | `--festival-top` and `--festival-bottom`, set with `data-festival`; the month's colour when unset |
| Screensaver | `components/screensaver.tsx` layers | the visitor canvas above the photo, below the clock |

Home mounts `<FestivalVisitors>` next to `<WeatherEffects>` (`app/page.tsx`).
Both can run at once, for example snow falling while the sleigh crosses. Each
visitor sprite is cached and only one visitor flies at a time, so the two
together should cost close to weather alone. That has to be measured on the
Pi in step 1, not assumed.

## 6. Steps

| Step | What | When it's worth having |
|---|---|---|
| 1 | `lib/festivals.ts` with all dates, the pre-tick table and specs; the setting; `data-festival`; the colour wash; **Christmas**: the sleigh with its tap, snow-capped cards, the Santa hat | before the 1st of Advent, **29 Nov 2026** |
| 2 | New Year's Eve: fireworks at the family's midnight | 31 Dec 2026 |
| 3 | Lunar New Year, Easter (Western and Orthodox) | 17 Feb 2027 / Mar–Apr 2027 |
| 4 | The rest of §3.1, as each one's artwork is ready | through 2027 |

Step 1 is small in code and large in drawing. If the sleigh isn't good enough
by mid-November, the wash, the snow-capped cards and the hat can ship alone,
and the sleigh can follow in December.

## 7. Risks

- **Over the widgets.** For ten seconds in every 120, part of a row of cards
  is behind the sleigh. The varying path and the one-tap rule (§2.1) keep it
  from being in the way. If it still is in daily use, slowing the rhythm on
  Home is a one-number change.
- **Taste.** A decoration that looks cheap is worse than none. Every scene
  should be tried on the maintainer's devices before it ships, as the
  creatures were.
- **Cultural care.** Only what's common in the family's country is
  pre-ticked, and everything else is the family's choice. Imagery stays
  festive rather than devotional: lights, lanterns, food and animals, no
  religious symbols.
- **The Pi.** Weather effects already run on it at 30 frames a second. One
  visitor at a time, cached sprites and a stopped loop between passes keep
  this in the same budget, but it needs measuring (step 1).
- **Keeping it fresh.** The Diwali table needs a reminder that fails in time
  (§3.2). Every other date is computed.

## 8. Decisions (owner, 2026-11-01)

1. **Visitors fly over the widgets**, not behind them. The tap target and the
   one-tap rule in §2.1 follow from this.
2. **Every 2 minutes**, on Home and on the screensaver.
3. **Pre-tick the festivals common in the family's country** (§3.1).
4. **A tap on the visitor does something**: presents and stars, and the
   creatures cheer.
5. **Nothing on birthdays.**
6. **The colour wash changes** with the festival (§2.4).

## 9. Not in this RFC

- Birthdays (decision 5).
- Sounds. A wall display that jingles is a different decision.
- Decorations a family uploads or draws itself.
