# Pocket Money (Piggy)

Per-kid virtual pocket-money accounts with configurable interest, saving goals, and an avatar that evolves as the kid saves. Self-hosted, no fintech, no monthly fee. Built as the fifth SurfacePlugin.

## What you need

Nothing. The plugin is purely local — no external bank API. Parents control everything from `/settings/pocket-money`.

## First-run setup

1. Toggle a person on `/settings/people` to "Is a child". Existing rows default to false.
2. Open `/settings/pocket-money` and tap **Create** next to the kid's name.
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

**Who picks it.** The child, on their own `/pocket-money` page: **Change look** under the avatar opens four small pictures of their own avatar at its current stage, and a tap chooses one. It needs no settings PIN, because it is the child's own avatar and changes nothing but the drawing. Parents see and change the same choice under Settings → Pocket money → the child's card → **Look**. The species is still a parent's choice and still needs the PIN.

**What the drawn looks do.** They breathe, blink, beat their wings and sway their tails; tapping the avatar makes it hop and send up hearts, and an egg wobbles. When the avatar reaches a new stage, the egg shakes, cracks and hatches, or a later stage flashes and the new one pops out with a burst of stars. Classic keeps the glow it always had. All motion stops for anyone whose device asks to reduce motion. The stages sheet, the dashboard widget and the child's profile show the avatar in the same look, without the motion. The motion uses only movement and fading, which a Raspberry Pi wall display handles easily.

**Which species are drawn.** So far, the dragon. For the other species the three drawn looks are greyed out with *Coming for this species*, and the child's page shows no **Change look** button. If a drawn look is stored for a species that has no drawings (set before the species was changed, say), that species shows its classic picture until its drawings arrive.

**The drawings are Kinboard's own.** They are drawn in code (`webapp/src/lib/pocket-money/creatures/`) and do not come from an asset pack, so there is no third-party licence attached to them. A new species is one file there: it draws its own body and hatchling's head on a shared skeleton, and the egg, the looks' colours and the motion come with it.

The choice is stored in `pocket_money_accounts.avatar_style` (`webapp/docker/migration_zzzzzzzz_pocket_money_avatar_style.sql`), which the database holds to the four values. A family export carries it, and restoring a backup made before this column existed gives every child Classic.

## Saving goals

Add via `/pocket-money` → "Add goal". Three image-lookup modes: catalog search (reuses the shopping-item catalog), URL paste, or local upload. One goal is `is_primary` and drives the kid view's progress bar; the queue auto-promotes on completion. When a goal hits 100%, the kid sees a "🎉 You can buy this!" button → creates a withdrawal request → parent confirms in the inbox at `/settings/pocket-money`. Confirmation deducts the balance and marks the goal `bought`.

## Points instead of euros

Some families would rather not reward chores with money. Each child can instead have their avatar grow with **task points** -- the points their tasks give when ticked off (a task's ⭐ points, see the Tasks page) -- and spend those points on rewards the parents choose.

**Switching a child over.** Settings → Pocket money → the child's card → **Avatar grows with**: *Euro* (the default, everything as before) or *Task points*. The choice is per child and needs the settings PIN. A child in points mode needs no money set up: the money settings fold away under *Money (optional)*, and the pocket-money page shows money only if the child has some, an allowance, or a saving goal. Allowance and interest keep running if you set them, so a family can use both.

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

**Rewards.** Settings → Pocket money → **Rewards for task points**: a title, a cost from 1 to 10000 points, an optional emoji, and an *Active* switch. The catalogue is shared by every child in the family; inactive rewards are hidden from the children. Editing needs the settings PIN.

**Redeeming.** On `/pocket-money`, a child in points mode sees their points, every active reward with how far they are toward it, and **Redeem** on those they can afford. Redeeming asks a parent; nothing is spent yet. The request appears under *Rewards waiting for approval* in Settings → Pocket money and on the navigation badge, like a withdrawal request. **Approve** spends the points; **Deny** spends nothing. A request can't be approved once the child has been switched back to euros; it keeps waiting until a parent denies it or switches the child back. Both need the settings PIN, checked on the server, so a child's own screen can't approve its own request. Approving is one database transaction: two devices approving at once book it once, and an approval the points no longer cover is refused and the request keeps waiting (points keep coming in, so a parent can approve it later or deny it). The reward's title and cost are copied into the request, so editing the catalogue later changes neither what is waiting nor what was spent.

**The child's profile.** Tapping a child in points mode on the dashboard shows the points left to spend and a **Rewards** button to their page.

Points, rewards and requests are stored in `pocket_money_accounts.reward_mode`, `point_rewards` and `point_redemptions` (`webapp/docker/migration_zzzzzzz_point_rewards.sql`). Screens can read them; every write goes through the server. A family export (Settings → Backup) carries the rewards and the requests, so a restore keeps the points already spent.

## Adding a new avatar species

The plugin ships with five species (dragon, cat, astronaut, plant, wizard) but the catalog is open-ended. Adding a sixth (e.g. "robot", "knight", "pirate") is a three-file change — **no DB migration, no code change, no settings UI edit**:

1. **Drop 8 SVG files into `webapp/public/pocket-money/avatars/`** named `<id>-1.svg` through `<id>-8.svg`. Each represents the avatar at one tier (stage 1 = starting, stage 8 = max). Any SVG works; sourcing from a CC-permissive emoji pack like Noto Emoji is the easy path.
2. **Add an entry to `webapp/src/plugins/pocket-money/catalog/avatars.json`** under the `species` array — copy the existing dragon entry and change the `id` + `src` paths.
3. **Add 9 i18n keys** to `webapp/messages/en.json` and `de.json`: `pocketMoney.species.<id>.{label, tier1, tier2, …, tier8}`. Keep EN+DE in lockstep (the CI parity check enforces it).

The new species automatically shows up in the create-account picker at `/settings/pocket-money`, in the kid-view stage caption, in the stages sheet, and is accepted by the API. Existing accounts on other species are untouched.

The set of stages and lifetime-saved thresholds is shared across all species and lives at `webapp/src/lib/pocket-money/types.ts` (`TIER_THRESHOLDS_CENTS`). Species must currently have exactly that many stages.

## What's not supported (yet)

- Cosmetics shop, badges, streak counter — deliberately not in scope (see [`docs/superpowers/specs/2026-05-10-pocket-money-plugin-design.md`](../superpowers/specs/2026-05-10-pocket-money-plugin-design.md))
- Todos `reward_cents` integration (chore → auto-credit) — possible follow-up
- Sibling co-op goals
- Multi-currency per family
- Custom parent-uploaded avatar art (catalog SVGs are designer-replaceable per file in `webapp/public/pocket-money/avatars/`)
- Drawn looks for the cat, astronaut, plant and wizard, and a child's own colours, pattern, eyes, accessory or name for their avatar -- planned

## Disabling the plugin

Toggle off at `/settings/plugins` → **Pocket Money**. Nav entry, dashboard widget, and settings page disappear. Account data, transactions, goals, withdrawal requests are preserved.
