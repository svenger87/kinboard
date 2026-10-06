# RFC-016 — Drawn creatures, and an editor for kids

| | |
|---|---|
| **Status** | Implemented in 1.13.0-rc.12: Step 1 #363, Step 2 #365, Step 3 #366 (with changing the creature later). Live reactions, mood and cosmetics remain open (§2) |
| **Date** | 2026-10-06 |
| **Depends on** | the pocket-money plugin, points mode (#353), server-only pocket-money writes (#361) |

## 1. Why

A child's pocket-money avatar is a creature that grows through eight stages:
an egg that hatches and becomes, eventually, a mighty dragon. It is the part of
pocket money that children care about most, and since #353 it can grow with
task points instead of euros, which is what some families want: a reward that
isn't money (discussion #349).

Today each stage is a static picture from an emoji set
(`public/pocket-money/avatars/{species}-{1..8}.svg`, see `CREDITS.md`). It
doesn't move or react, all children with the same species look identical, and
a child has no say in it.

Two prototypes, built and tried on the maintainer's devices on 2026-10-06,
showed what it could be instead:

- **The dragon in three styles**: *Gumdrop* (soft, round, no outlines),
  *Sticker* (thick outlines, a white sticker edge) and *Storybook* (gradients,
  glow, stars). It breathes, blinks, beats its wings and sways its tail; a tap
  makes it hop with hearts; the egg wobbles, cracks and hatches; each new stage
  pops in with stars.
- **A creature workshop**: fourteen creatures and characters with their own
  growth story, and an editor a child can use alone: colours, a pattern, eyes,
  an accessory and a name; for the princess and the prince also skin tone and
  hair colour.

Everything is drawn in code from one skeleton (a body, a head and per-species
parts), so the artwork belongs to Kinboard. There are no asset packs to
licence, and nothing to fetch at runtime, which matters on LAN-only installs.

## 2. The three steps

| Step | What | Where |
|---|---|---|
| 1 | The dragon drawn in code, in three styles, chosen per child. A shared `CreatureAvatar` component replaces the `<img>` on the pocket-money page, the stages sheet, the celebration (as a hatching scene), the widget and the child's profile | in progress, own PR |
| 2 | More creatures in the same styles | this RFC, §3 |
| 3 | The editor: a child changes their creature's look themselves | this RFC, §4 |

Later, and out of scope here: the creature reacts live on the wall display when
its child ticks off a task, gets sleepy in the family's evening, and can wear
cosmetics bought with points next to the rewards from #353.

## 3. Step 2: the creatures

Each creature has its own beginning and its own growth story. Stage 1 is the
closed beginning, stage 2 the baby peeking out of it, stages 3–8 the growing
creature, with a crown at stage 8. Fourteen were drawn in the workshop:

| Creature | Starts as | Grows | Stage 8 |
|---|---|---|---|
| Dragon | a spotted egg | longer snout, crest spikes, horns, wings, spade tail, belly scales | Mighty T-Rex |
| T-Rex | an egg | a ridge of spikes; teeth from stage 4 | Rex King |
| Triceratops | an egg | the frill grows into a shield; nose horn, then two brow horns | Trike King |
| Stegosaurus | an egg | more back plates; a spiked tail from stage 5 | Stego King |
| Unicorn | a star egg | golden horn, rainbow mane, Pegasus wings | Celestial |
| Cat | ears peeking out of a basket | a scarf, then a lion's mane | King of the Jungle |
| Fox | a pile of autumn leaves | a bushy tail, then three, then five | Fox Spirit |
| Bunny | a basket | ears longer every stage, a carrot, then it glows | Bunny King |
| Axolotl | a jelly egg | frilly gills that grow and wave; it glows | Sea Legend |
| Owl | an egg | ear tufts, glasses, a graduation cap | Grand Owl |
| Penguin | an egg | a scarf, golden cheeks | Penguin King |
| Robot | a box of parts | blinking lights, jets, shoulder plates | Ultra Bot |
| Princess | a crown on a cushion | a tiara, a star wand, a cape | Queen |
| Prince | a crown on a cushion | a sword, then shield and cape as a knight | King |

The creatures share one skeleton (a round body, a head, per-species ears,
tails and extras). The princess and the prince use a person skeleton: a head
with hair, a dress or a tunic, sleeves and hands. They add **skin tone** (five
shades) and **hair colour** to the editor (§4), so a child can make them look
like themselves. Any child can pick either; nothing in Kinboard ties them to
boys or girls.

**All fourteen ship together** (decided 2026-10-06): the dragon in Step 1, and
the other thirteen in one Step 2 PR.

Today's astronaut, plant and wizard stay in the *Classic* style (today's
pictures). Choosing a drawn style for them shows "coming for this creature",
and nobody loses the creature their child already has. The plant (seed to
tree) and the wizard need skeletons of their own and are not scheduled.

Polish noted while drawing, before each ships:

- The stegosaurus's plates should stand above the shoulders, not out to the
  sides.
- The princess and the prince need a choice of hairstyles (short, ponytail,
  curls).

Each creature is one module under `src/lib/pocket-money/creatures/`. Its stage
names live in en, de and fr under the existing `pocketMoney.species.<id>.tierN`
keys, and the catalogue (`plugins/pocket-money/catalog/avatars.json`) gains a
`drawn: true` flag. A spec renders every creature × style × stage and fails on
a missing name, a duplicate SVG id or a stage that draws nothing.

## 4. Step 3: the editor

A child opens **Change look** on their own pocket-money page and changes:

| Choice | Options |
|---|---|
| Name | free text, up to 16 characters |
| Body colour | 10 from a fixed set |
| Tummy colour | 6 |
| Wings, ears and fins | 8 |
| Skin tone (princess, prince) | 5 |
| Hair colour (princess, prince) | 8 |
| Pattern | plain, spots, stripes, hearts |
| Eyes | round, sparkly, happy |
| Accessory | none, bow, party hat, sunglasses, flower |
| Style | Gumdrop, Sticker, Storybook (Classic stays available) |

There's also **Surprise me** (a random look) and **Start over** (the
creature's own colours).

Colours come from a fixed set rather than a free picker. Every combination
still looks good, the eyes stay readable on every body, and a value outside the
set is refused on the server.

### 4.1 Who decides what

| | Who | PIN |
|---|---|---|
| Which creature | a parent | yes, as today (#359) |
| Style and look | the child | no |
| Stage | task points or money, never the editor | — |

The look can change any time without touching progress, and switching creature
keeps the look's choices that still apply (colours, pattern, eyes, accessory,
name).

### 4.2 Data

One column on the child's account, written only through the server (#361):

```sql
ALTER TABLE pocket_money_accounts
  ADD COLUMN IF NOT EXISTS avatar_look JSONB NOT NULL DEFAULT '{}'::jsonb;
```

- `PATCH /api/pocket-money/accounts/[id]` takes `avatar_look` as a kid-side
  field (no PIN), validated against the fixed sets: known keys only, colours
  from the palette, the name trimmed, at most 16 characters, control
  characters removed. Unknown keys are refused rather than stored.
- `{}` means the creature's own colours. Every key is optional, so a later
  option (a new accessory) needs no migration.
- Export and import carry it with the account.
- The name is shown only to the family, on its own screens. It never goes to
  Home Assistant or an assistant.

### 4.3 Rendering

`CreatureAvatar` takes an optional `look`. The palette is resolved in one
place: the creature's colours, then the look's. Small thumbnails don't
animate. Animation is CSS on transform and opacity only (breathing, blinking,
wings, tail, gills), stays light on a Raspberry Pi, and switches off for
anyone who asks their device to reduce motion.

## 5. Testing

- A render matrix: every creature × style × stage × a sample of looks renders,
  with unique SVG ids, and every stage draws something.
- Look validation: every key and every out-of-set value, the name length,
  control characters, unknown keys refused. Mutation-proved.
- The PIN boundary: the look and style need no PIN; the creature does
  (`pocket-money-pin.spec.ts`).
- A rendered check of the editor in Chromium **and WebKit**, at phone and
  tablet widths.

## 6. Not in this RFC

- Live reactions, mood and cosmetics (§2).
- A drawing upload ("draw your own creature").
- Exposing the look through the Integration API or to assistants.

## 7. Open questions

1. ~~Which creatures~~: decided, all fourteen (§3).
2. **Classic**: is it kept for good, or retired once every creature is drawn?
3. **Who picks the style when a child has none yet**: the family's default
   (one setting), or always Classic until the child chooses?
