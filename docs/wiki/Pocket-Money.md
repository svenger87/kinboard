# Pocket Money (Piggy)

Per-kid virtual pocket-money accounts with configurable interest, saving goals, and an avatar that evolves as the kid saves. Self-hosted, no fintech, no monthly fee. Built as the fifth SurfacePlugin.

> **Creatures and rewards have moved.** A child's creature (the avatar below), task points and the rewards they buy are no longer part of pocket money: they are switched on and set up under **Settings → Creatures & rewards**, and they work without this plugin. See [[Creatures & rewards|Creatures-and-Rewards]]. Pocket money keeps the euros: allowance, interest, goals and withdrawals. The creature still shows on the child's Pocket money page next to the money.

## What you need

Nothing. The plugin is purely local — no external bank API. Parents control everything from `/settings/pocket-money`.

## First-run setup

1. Toggle a person on `/settings/people` to "Is a child". Existing rows default to false.
2. Open `/settings/pocket-money` and tap **Create** next to the kid's name. (A creature for the child is switched on separately, under Settings → Creatures & rewards.)
3. Set the APR (default 10%), weekly allowance, allowance day-of-week, interest commit day-of-week, max-eligible balance cap.
4. The `/pocket-money` page now shows up; the kid can add goals, propose spends, and watch their avatar grow.

## How interest works

- Daily cron at 00:30 UTC computes `min(balance, max_eligible) × (apr_bps ÷ 10000) ÷ 365` per account, accumulates into `pending_interest_cents`. Floor-rounded so the system never overpays.
- Hourly cron commits the pending amount **daily** (was weekly in earlier versions — kids and parents felt the long lag as "interest is broken"). A 23h per-account dedup guard prevents double-commit if the cron re-fires inside the same UTC day. Each commit drops a single `interest` transaction and triggers the coin-shower animation on next kid-view load.

The forecast panel on `/settings/pocket-money` shows projected balance at 1 / 3 / 6 / 12 months at the current APR + allowance, simulated day-by-day with the same math. Use it to dial APR up or down before the kid notices.

## Interest when the kid withdraws

Withdrawals reduce the principal that interest is calculated on, but they don't claw back interest the kid has already earned. Concretely:

- **Principal moves immediately.** The withdrawal subtracts from `balance_cents` on commit. The next day's accrual reads the lower balance — the kid earns less from day +1.
- **Pending interest is untouched.** Interest accrued earlier in the day sits in `pending_interest_cents` and still commits at the next daily run. A kid can't game the system by withdrawing right before commit — at most a few cents are at stake.
- **Avatar tier is preserved.** `lifetime_saved_cents` is monotonic — only positive non-adjustment transactions bump it. Withdrawals never touch it, so spending money doesn't visibly demote the avatar.
- **The eligibility cap clamps the principal, not the balance.** If balance is above `max_balance_eligible_cents`, withdrawals down to the cap don't change the interest rate — the kid was already only earning on the eligible portion.

Worked example: €100 balance, 10% APR, €500 cap, daily commit.

- Day 1 accrues ⌊100 × 1000 / (10000 × 365)⌋ = 2¢ → committed at next daily run → balance €100.02.
- Day 2 kid withdraws €30 (after the day-1 commit). Balance drops to €70.02.
- Day 2 accrues ⌊70 × 1000 / 3650000⌋ = 1¢ → committed daily.

Daily commits eliminate the "kid times a withdrawal right before commit" edge case that existed under the old weekly model — at most one day's accrual is ever sitting in pending.

## Avatar evolution

Tier promotes when `lifetime_saved_cents` (cumulative deposits + interest, NOT affected by withdrawals) crosses these thresholds:

| Stage | Lifetime saved |
|---|---|
| 1 | €0 (start) |
| 2 | €2 |
| 3 | €5 |
| 4 | €15 |
| 5 | €40 |
| 6 | €100 |
| 7 | €300 |
| 8 | €1000 |

Each promotion plays a once-per-event radial-burst animation. Withdrawals don't downlevel — the kid keeps their progress.

## Avatar style

Each child's avatar can be drawn in one of four looks:

| Look | What it is |
|---|---|
| **Classic** | The original pictures (the default, so nothing changes until someone picks another look) |
| **Gumdrop** | Soft, round shapes with no outlines; reads well from across the room |
| **Sticker** | Thick outlines and a white sticker edge, like a collectible; the clearest at small sizes |
| **Storybook** | Soft gradients, a gentle glow and a few stars |

**Who picks it.** The child, on their own `/pocket-money` page: **Change look** under the avatar opens the look editor (below), which includes the four styles as small pictures of their own avatar at its current stage. It needs no settings PIN, because it is the child's own avatar and changes nothing but the drawing. Parents see and change the style under Settings → Creatures & rewards → the child's card → **Look**. The species is still a parent's choice and still needs the PIN.

**Changing the creature.** A parent can switch a child's creature at any time under Settings → Creatures & rewards → the child's card → **Change**: every creature is shown with its eight stages, drawn in the child's own style and colours, and the sheet says what will happen (*Funkel becomes a T-Rex. Stage and look stay.*) before anything is saved. Only the species changes. The stage still comes from the money or points and the best stage reached, so nothing is lost; the style stays; and the look keeps everything that still applies -- the name, the colours, the pattern, the eyes, the accessory. A princess's or prince's skin tone, hair colour and hairstyle stay stored while another creature is chosen, unused, and come back if the child is switched back. It needs the settings PIN, on the server as well, and the child's own page has no such switch: the creature stays a parent's choice (RFC-016 §4.1).

**The look editor.** Besides the style, a child can give the creature a name (up to 16 characters, shown above it on their page) and choose its body colour, tummy colour and the colour of its wings, ears and fins, a pattern (plain, spots, stripes, hearts), eyes (round, sparkly, happy) and an accessory (bow, party hat, sunglasses, flower). For the princess and the prince the colours are the outfit, the trim and the hair, plus a skin tone (five) and a hairstyle (short, long, ponytail, curls). *Surprise me* picks a random look, *Start over* brings back the creature's own colours and keeps the name. The preview follows every choice; nothing is stored until **Save**. Colours come from fixed sets, so every combination still looks good, and the server refuses anything outside them. The stage still comes only from money or points: the look can change any time without touching progress.

The look is stored in `creatures.look` (until RFC-017 in `pocket_money_accounts.avatar_look`, `webapp/docker/migration_zzzzzzzz_pocket_money_avatar_style_look.sql`), `{}` meaning the creature's own look. A family export carries it. A stored or restored look keeps every key the editor knows with a value from its set and drops only the others, so a rollback or a newer backup keeps the name and the colours; the PATCH itself refuses any look with a bad key. The name is counted as a person sees it (an emoji with a skin tone, a flag or 👨‍👩‍👧‍👦 is one of the 16 characters), bidi controls, zero-width spaces and the BOM are removed, joiners stay, and a name of only blanks and invisible fillers is no name; more than 256 raw characters is refused. The name stays on the family's own screens: the Integration API, Home Assistant and AI assistants never see it.

**What the drawn looks do.** They breathe, blink, beat their wings and sway their tails; tapping the avatar makes it hop and send up hearts, and an egg wobbles. When the avatar reaches a new stage, the egg shakes, cracks and hatches, or a later stage flashes and the new one pops out with a burst of stars. Classic keeps the glow it always had. All motion stops for anyone whose device asks to reduce motion. The stages sheet, the dashboard widget and the child's profile show the avatar in the same look, without the motion. The motion uses only movement and fading, which a Raspberry Pi wall display handles easily.

**Cheering for a task ticked off.** When one of a child's tasks is ticked off -- on a wall display, a phone, or through Home Assistant or an assistant -- that child's creature cheers on every screen showing it, within about a second: it hops in a burst of stars under a rising "+5 ⭐" with the task's points, or sends up hearts for a task worth no points. It happens on the dashboard's Pocket money widget and on the child's own page (and in their profile on the dashboard, if it is open). If the points carry a child in points mode into a new stage, the widget plays a small hatching in place and the child's page plays the full celebration. The screen the task was ticked on cheers once, straight away. Only ticking off counts: taking a tick back, editing a task, or opening a screen never cheers, and a parent's task never does. Several ticks in a row cheer one after another; after three waiting, the rest are added up into one "+total". Nothing plays on a hidden tab or under the screensaver, nothing wakes it, and there is no sound. The widget's creature moves only for the second and a half of a cheer and stands still the rest of the time, so a Raspberry Pi wall display stays idle. With reduced motion, only the "+5 ⭐" shows, fading in and out. No setting and no migration: it follows the task changes every screen already receives.

**Which species are drawn.** Fourteen: the dragon, cat, axolotl, owl, robot, unicorn, fox, penguin, bunny, T-Rex, triceratops, stegosaurus, princess and prince. Each starts somewhere of its own -- a spotted egg, a star egg (unicorn), a jelly egg (axolotl), a basket (cat, bunny), a box of parts (robot), a pile of leaves (fox) or a crown on a cushion (princess, prince) -- and grows its own way, with a crown at stage 8. The astronaut, plant and wizard keep their classic pictures: for them the three drawn looks are greyed out with *Coming for this species*, and the child's page shows no **Change look** button. A drawn look stored for one of those shows the classic picture until its drawings arrive.

**Classic for the new creatures.** Twelve of the fourteen never had classic pictures. For them *Classic* is their Gumdrop drawing standing still (the picker says *Standing still*), and a new account for one of them starts in Gumdrop, so it moves from the first day. Dragon and cat accounts start on Classic, as before.

**The drawings are Kinboard's own.** They are drawn in code (`webapp/src/lib/pocket-money/creatures/`) and do not come from an asset pack, so there is no third-party licence attached to them. A new species is one file there: it draws its own head parts, tail and body changes on a shared skeleton, and its beginning, the looks' outlines and lighting, and the motion come with it.

The choice is stored in `creatures.style` (until RFC-017 in `pocket_money_accounts.avatar_style`, `webapp/docker/migration_zzzzzzzz_pocket_money_avatar_style.sql`), which the database holds to the four values. A family export carries it, and restoring a backup made before this column existed gives every child Classic.

## Saving goals

Add via `/pocket-money` → "Add goal". Three image-lookup modes: catalog search (reuses the shopping-item catalog), URL paste, or local upload. One goal is `is_primary` and drives the kid view's progress bar; the queue auto-promotes on completion. When a goal hits 100%, the kid sees a "🎉 You can buy this!" button → creates a withdrawal request → parent confirms in the inbox at `/settings/pocket-money`. Confirmation deducts the balance and marks the goal `bought`.

## Points instead of euros

Some families would rather not reward chores with money. Each child can instead have their avatar grow with **task points** -- the points their tasks give when ticked off (a task's ⭐ points, see the Tasks page) -- and spend those points on rewards the parents choose.

**Switching a child over.** Settings → Creatures & rewards → the child's card → **Grows with**: *Task points* (the default for a new creature) or *Saved money*, offered with pocket money on and an account for the child. The choice is per child and needs the settings PIN. A child whose creature grows with points needs no money set up: the pocket-money page shows money only if the child has some, an allowance, or a saving goal. Allowance and interest keep running if you set them, so a family can use both.

**The points balance** is the points the child has earned, all time, minus the rewards a parent has approved. It never shows less than zero. If a task is un-ticked after its points were already spent, the difference is owed and the next points earned pay it back first: earned 100, spent 60, a 50-point task un-ticked leaves earned 50, balance 0 and 10 owed; the next 10 points earned still leave the balance at 0, and only the points after that can be spent. The child's page says how many points are still to make up. A reward that is still waiting is held back: a child can't ask for more than they have left.

**The avatar in points mode** grows with the points **earned**, not the balance, so buying a reward never shrinks the pet; un-ticking a task takes its points, and any stage they brought, back. It never shows less than the best stage the child reached **with money**: a child who reached stage 5 with money starts points mode at stage 5 and grows again once their points pass stage 6. That money stage (`best_tier`) only ever climbs and never goes past stage 8 (the database refuses both), and points never write it, so switching back to euros keeps the badge too.

| Stage | Points earned | Roughly, at ~50 points a week |
|---|---|---|
| 1 | 0 (the egg) | start |
| 2 | 50 | the first week |
| 3 | 150 | 3 weeks |
| 4 | 300 | 6 weeks |
| 5 | 600 | 3 months |
| 6 | 1000 | 5 months |
| 7 | 1600 | 8 months |
| 8 | 2500 | about a year |

The thresholds live in `webapp/src/lib/pocket-money/types.ts` (`TIER_THRESHOLDS_POINTS`), next to the money ones.

**Rewards.** Settings → Creatures & rewards → **Rewards for task points**: a title, a cost from 1 to 10000 points, an optional emoji, and an *Active* switch. The catalogue is shared by every child in the family; inactive rewards are hidden from the children. Editing needs the settings PIN.

**Redeeming.** On `/pocket-money`, a child in points mode sees their points, every active reward with how far they are toward it, and **Redeem** on those they can afford. Redeeming asks a parent; nothing is spent yet. The request appears under *Rewards waiting for approval* in Settings → Creatures & rewards and on the navigation badge, like a withdrawal request. **Approve** spends the points; **Deny** spends nothing. What the creature grows with does not matter for a request since RFC-017: the points are the child's either way. Both need the settings PIN, checked on the server, so a child's own screen can't approve its own request. Approving is one database transaction: two devices approving at once book it once, and an approval the points no longer cover is refused and the request keeps waiting (points keep coming in, so a parent can approve it later or deny it). The reward's title and cost are copied into the request, so editing the catalogue later changes neither what is waiting nor what was spent.

**The child's profile.** Tapping a child in points mode on the dashboard shows the points left to spend and a **Rewards** button to their page.

What a child's creature grows with is `creatures.grows_with` (until RFC-017 it was `pocket_money_accounts.reward_mode`), the rewards are `point_rewards`, and the requests are `point_redemptions`, per child since RFC-017 (`webapp/docker/migration_zzzzzzz_point_rewards.sql`, then `webapp/docker/migration_zzzzzzzz_pocket_money_creatures_out.sql`). Screens can read them; every write goes through the server. A family export (Settings → Backup) carries the rewards and the requests, so a restore keeps the points already spent.

## Adding a new avatar species

The plugin ships with five species (dragon, cat, astronaut, plant, wizard) but the catalog is open-ended. Adding a sixth (e.g. "robot", "knight", "pirate") is a three-file change — **no DB migration, no code change, no settings UI edit**:

1. **Drop 8 SVG files into `webapp/public/pocket-money/avatars/`** named `<id>-1.svg` through `<id>-8.svg`. Each represents the avatar at one tier (stage 1 = starting, stage 8 = max). Any SVG works; sourcing from a CC-permissive emoji pack like Noto Emoji is the easy path.
2. **Add an entry to `webapp/src/plugins/pocket-money/catalog/avatars.json`** under the `species` array — copy the existing dragon entry and change the `id` + `src` paths.
3. **Add 9 i18n keys** to `webapp/messages/en.json` and `de.json`: `pocketMoney.species.<id>.{label, tier1, tier2, …, tier8}`. Keep EN+DE in lockstep (the CI parity check enforces it).
4. **Give it its own words in "becomes a …"**: `settings.pocketMoney.changeCreatureConfirm` picks the article (en), the dative form (de, *zum Hasen*) and the noun (fr) per species. `e2e/creature-change.spec.ts` fails until the new id has its own branch in de and fr.

The new species automatically shows up in the create-account picker and the *Change creature* sheet at `/settings/pocket-money`, in the kid-view stage caption, in the stages sheet, and is accepted by the API. Existing accounts on other species are untouched.

The set of stages and lifetime-saved thresholds is shared across all species and lives at `webapp/src/lib/pocket-money/types.ts` (`TIER_THRESHOLDS_CENTS`). Species must currently have exactly that many stages.

## What's not supported (yet)

- Cosmetics shop, badges, streak counter — deliberately not in scope (see [`docs/superpowers/specs/2026-05-10-pocket-money-plugin-design.md`](../superpowers/specs/2026-05-10-pocket-money-plugin-design.md))
- Todos `reward_cents` integration (chore → auto-credit) — possible follow-up
- Sibling co-op goals
- Multi-currency per family
- Custom parent-uploaded avatar art (catalog SVGs are designer-replaceable per file in `webapp/public/pocket-money/avatars/`)
- Drawn looks for the astronaut, plant and wizard -- planned

## Disabling the plugin

Toggle off at `/settings/plugins` → **Pocket Money**. Nav entry, dashboard widget, and settings page disappear. Account data, transactions, goals, withdrawal requests are preserved.
