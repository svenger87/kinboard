# Adding a festival

How to draw one of RFC-020's festivals ([`docs/rfc/020-festival-decorations.md`](../rfc/020-festival-decorations.md))
so it shows on Home and the screensaver. Read §2 (the four layers), §3.3 (the
festival's kit: what it looks like), §4 (who chooses, how much moves), §5.1
(the art) and §8 (the owner's decisions) first. The dates are already done:
every festival in §3.1 and §3.3 has its window in `webapp/src/lib/festivals.ts`,
its name and its one-line description in all three languages, and its
pre-tick rule. **Don't touch any of those.** A festival is its art and its kit.

## The files

For a festival `<id>` (the id in `FESTIVALS`, e.g. `halloween`), create:

| File | What |
|---|---|
| `webapp/scripts/festival-art/<id>.py` | the art script: draws every part and still as SVG, writes them and the art JSON |
| `webapp/public/festivals/<id>/*.svg` | the art, **generated** by the script (commit them) |
| `webapp/src/lib/festivals/kits/<id>.art.json` | **generated**: each part's size and pivot, and the rig (if the visitor has one) |
| `webapp/src/lib/festivals/kits/<id>.ts` (`.tsx` if it draws an outfit item) | the kit: visitor, dressing, outfit, wash, stages |

and add **one line** to `webapp/src/lib/festivals/kits/all.ts`, in
alphabetical order of the file name:

```ts
export { default as halloween } from "./halloween";
```

That's all. No other file changes: not `globals.css`, not `items.tsx`, not
the message files, not `festivals.ts`, not the scene. If you find you need
to change one of them, stop and ask; the engine is missing something.

Run the script from the repo root: `python3 webapp/scripts/festival-art/<id>.py`.

### Draft first

Start the kit with `draft: true`. A draft can be previewed (the gallery,
`/?festival-preview=<id>`) but isn't offered in Settings or switched on by
the date. The owner takes the `draft` out once the festival has been seen on
the household's own screens (§7, "Taste").

## The kit

```ts
import { css, defineFestival } from "@/lib/festivals/kit";
import ART from "./halloween.art.json";

export default defineFestival({
  id: "halloween",
  draft: true,
  // Top / bottom, light theme and dark theme, as HSL triples. At the month's
  // strengths: never set --month-wash-*.
  wash: { light: ["28 90% 48%", "270 45% 34%"], dark: ["28 92% 56%", "270 50% 56%"] },
  visitor: { archetype: "burst", parts: ART.parts, /* … */ },
  dressing: (s) => css`
    ${s.cards} { position: relative; }
    ${s.cards}::after { /* … */ background: ${s.art("cobweb")} center / contain no-repeat; pointer-events: none; }
  `,
  outfit: [{ slot: "head", item: "wizard_hat" }],
});
```

- **wash**: two colours, top and bottom, for light and dark (§2.4). Dark
  needs them lighter, as `christmas.tsx`'s are. `washByStage` gives a stage
  its own (a national day's flag colours, by country).
- **visitor**: one of the archetypes below, or `null` (St Nicholas, Yalda,
  Ramadan have none).
- **dressing**: CSS, or `null`. Use only the selectors `s` gives you, which
  are scoped to your festival and to Animations On and Reduced:
  `s.cards` (every widget card on Home), `s.cardsAt(stage)`, `s.tasks` (the
  Tasks card alone), `s.tasksAt(stage)`, `s.root`, `s.stage(stage)`, and
  `s.art(name)` for `url("/festivals/<id>/<name>.svg")`. Put drawings on
  `::before` and `::after`, `position: absolute`, `pointer-events: none`.
  `:nth-child(odd)` / `(even)` varies them card to card.
- **outfit**: the creatures' items, at most one per slot (`head`, `face`,
  `neck`, `background`). Either a shop item by id (`scarf`, `star_glasses`,
  `flower_crown`, `bow_tie`, `medal`, `heart_glasses`, `wizard_hat`,
  `rainbow`, `snow`… see `creatures/shop.ts`), or your own: give it an id of
  its own (`party_hat_nye`) and a `draw`. Head and neck items are drawn in the
  head's space, a head of radius 34 at the origin, as the shop's in
  `creatures/items.tsx`; use `line(st, w)` for Sticker's outline and
  `sheen(st, …)` for Storybook's highlight, from `creatures/item-draw.tsx`.
  `new-years-eve.tsx` has an example. A child can switch festival outfits off;
  the child's own item is back the day after.
- **stage** / **stages** / **previewStage**: a part of the festival the
  dressing changes with. `stage(at)` gets the day, the window, `dayIndex`,
  `days`, `minutes`, `afterDusk`, `visitorReady` and the family's `country`,
  and returns one of `stages` (or null); it lands on
  `<html data-festival-stage>`. St Nicholas: `eve`/`day`. Hanukkah would be
  `night-1`…`night-8` (from `dayIndex` and `afterDusk`), Ramadan `day`/`night`
  (its dusk is 18:00 without the weather), a national day the country
  (`fr`, `us`, with `washByStage`).

When the visitor flies is the date module's, not the kit's: St Martin's walk
and a national day's fireworks wait for dusk, New Year's Eve's for the
family's midnight. Everything else flies all day, every two minutes.

## The archetypes

A visitor is configuration and art. Units are the art's own (its SVG
viewBox) unless the name says px. `size: { per, px, min, max }` sets how big
the art is on a screen: `clamp(screen[per] / px, min, max)` CSS px per art
unit. `tap` says what a tap drops: stars always, `presents: true`, or
`drops: [part names]` (eggs, sweets); `tap: false` for none. `every` changes
the two-minute rhythm (only a timed show, fireworks, may go faster).

| Archetype | For | Options |
|---|---|---|
| `fly` | across the screen on a varied arc, banking, drifting in the wind: the sleigh | `body` (a part or a rig), `box` (the tap target, art units from the body's origin), `length`, `bands` (high/low heights by turns), `arc`, `dip`, `bank`, `duration` |
| `walk` | a row along the bottom, above the navigation bar: lanterns, a parade, a hopping bunny, a dreidel, a dragon dance, goldfish, a dragon boat | `members` (parts or rigs), `gap`, `tail`, `lift`, `period` (s a step), `lag`, `bob: { amp, hop }` (hop: \|sin\|, else a wave), `swing: { amp, lag, wind }`, `turn` (spins about the vertical, turns a second), `stick`, `extent`, `direction` |
| `rise` | up from the bottom, swaying, fading near the top: hearts, balloons, sky lanterns, flowers (`bloom`) | `sprites`, `count`, `speed` (px/s), `sway`, `scale`, `spin`, `bloom`, `ceiling`, `duration` |
| `drift` | down from the top with the shared wind, turning over: leaves, petals | `sprites`, `count`, `speed`, `sway`, `scale`, `spin`, `tumble` (flips a second) |
| `burst` | out of a corner or edge: bats, streamers and confetti, coloured powder, noisemakers | `sprites`, `count`, `waves`, `from` (corners/edges, one per wave), `speed`, `spread` (°), `gravity` (px/s²; negative floats), `drag` (0–0.9), `life`, `spin`, `flap` (wing beats a second), `grow` (a powder cloud spreading) |
| `fireworks` | rockets and bursts over the clock: New Year's Eve, national days | `colors`, `shells`, `sparks`, `radius` (px), `over` (`clock`/`top`), `sprites` (extras among the sparks), `duration` |
| `arc` | a rainbow over the widgets | `sprite` (drawn as the whole bow, its pivot at the circle's centre), `span` (share of the width), `grow`, `hold`, `fade` (ms), `sparkle` |

The particle archetypes (`rise`, `drift`, `burst`) make one particle, a
little larger, the tap target: a swarm can't be one, or it would catch every
tap meant for a widget. `fireworks` takes a tap on its newest burst (another
goes off there), `arc` on its apex.

**Rigs.** A body or member can be a rig (`lib/festivals/visitors/types.ts`,
`Rig` and `RigNode`): parts that move against each other, each turning about
its pivot at a point of its parent's drawing, by curves: `{ keys }` (a
Catmull-Rom loop through keyframes, art.py's gait), `{ wave: [amp, phase],
freq }`, `{ sine, ms, wind }` (on the wall clock, stronger in the wind), or
an array (summed). `under` draws before the part, `over` after; `phase`
offsets a subtree (the second reindeer); `anchors` and `lines` draw live
lines (the reins). `christmas.tsx` builds the sleigh this way from its
`art.json` rig; a hopping bunny's ears or a dragon boat's paddlers are the
same. Put the rig's numbers (joints, keyframes) in the art script's `rig`, so
the drawing and its motion live together.

The maths of every archetype is `lib/festivals/visitors/motion.ts`, with its
spec `e2e/festival-archetypes.spec.ts`.

## The art

Port the conventions of `docs/rfc/020/art.py` (and `scripts/festival-art/_common.py`
has its helpers: `Art`, `lin`, `rad`, `blur`, `fur`):

- **Parts with pivots.** `art.part(name, w, h, pivot, body, defs)`: each part
  in its own coordinates, its pivot the point it turns about. `art.still(name, svg)`
  for a dressing drawing, which CSS places. `art.finish(rig=…)` writes the
  art JSON.
- **Style (§5.1).** The creatures' palette and soft, round shapes (RFC-016);
  Storybook's gradients, soft shadows and highlights for depth; light from the
  top left; **no outlines**, so it reads the same on the dark and the light
  theme; glows drawn into the art (canvas blur is slow on a Pi). As much
  detail as the drawing can hold: it's paid for once, when the bitmaps are
  made, not every frame.
- **No devotional imagery** (§7, "Cultural care"): lights, lanterns, food,
  animals, flowers, paper and colour. No religious symbols, no figures of
  worship.
- **Seeded randomness** (`random.Random(n)`), so running the script again
  gives the same files, byte for byte.
- **Small.** A visitor's parts are drawn once at the screen's pixel ratio; a
  part needn't be bigger than it shows on a 1080p wall at `size.max`.

## The checks every festival passes

1. **The specs.** `e2e/festival-kits.spec.ts` (its files, the one registry
   line, its CSS scoped to it and to Animations On/Reduced, every drawing
   there and generated by its script, its outfit valid, its stages its own),
   `e2e/festival-archetypes.spec.ts`, `e2e/festivals.spec.ts` (the dates),
   `e2e/festivals-scene.spec.ts`. All in the fast suite.
2. **Dressing never covers content** (§2.2): `e2e/festivals-ui.spec.ts` checks
   every drawn festival's dressing against every card's text, icons and
   controls at 320 px and at 1920 px. Run it on the stack in Chromium **and
   WebKit** (`--project=webkit`): WebKit is where layout differs. Look at it
   too, in the gallery, at both widths and in both themes.
3. **Frame cost, measured the bench way** (RFC-020 §7.1): Chromium with the
   CPU throttled 4× and 6×, 1920×1080, 30 fps cap, snow on, your visitor
   flying continuously, compared with snow alone. Report fps, dropped frames
   and script ms per frame, and the time to make the bitmaps. Under 4× it
   should cost under a millisecond of script a frame more than snow alone,
   with no dropped frames.
4. **Animations Reduced and Off** (§4): Reduced keeps the dressing, the
   outfit and the wash, and no visitor; Off keeps the wash only. The kit
   selectors and the scene do this for you; check it in the gallery.
5. **The gallery screenshot.** `/settings/festival-gallery`: Preview your
   festival (and each of its stages), let the visitor fly, tap it, and attach
   a screenshot of the visitor mid-pass and of the dressed sample cards to
   the PR. The owner reviews here too. `/?festival-preview=<id>` does the same
   on Home (`&festival-stage=<stage>` for a stage).
