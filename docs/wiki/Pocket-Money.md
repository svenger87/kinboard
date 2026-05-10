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
- Hourly cron checks each account; on its configured `interest_committed_day_of_week`, the pending amount commits as a single `interest` transaction → balance bumps → coin-shower animation triggers on next kid-view load.

The forecast panel on `/settings/pocket-money` shows projected balance at 1 / 3 / 6 / 12 months at the current APR + allowance, simulated day-by-day with the same math. Use it to dial APR up or down before the kid notices.

## Interest when the kid withdraws

Withdrawals reduce the principal that interest is calculated on, but they don't claw back interest the kid has already earned. Concretely:

- **Principal moves immediately.** The withdrawal subtracts from `balance_cents` on commit. The next day's accrual reads the lower balance — the kid earns less from day +1.
- **Pending interest is untouched.** Interest accrued earlier in the week sits in `pending_interest_cents` and still commits on the configured commit day. A kid can withdraw mid-week without losing the partial week's accrual on the pre-withdrawal balance.
- **Avatar tier is preserved.** `lifetime_saved_cents` is monotonic — only positive non-adjustment transactions bump it. Withdrawals never touch it, so spending money doesn't visibly demote the avatar.
- **The eligibility cap clamps the principal, not the balance.** If balance is above `max_balance_eligible_cents`, withdrawals down to the cap don't change the interest rate — the kid was already only earning on the eligible portion.

Worked example: €100 balance, 10% APR, €500 cap, weekly commit on Sunday.

- Days 1-3 each accrue ⌊100 × 1000 / (10000 × 365)⌋ = 2¢ → 6¢ pending.
- Day 4: kid withdraws €30. Balance drops to €70. Pending stays at 6¢.
- Days 4-7 each accrue ⌊70 × 1000 / 3650000⌋ = 1¢ → 4¢ more pending.
- Sunday commit: balance += 10¢. Avatar tier unchanged.

One known edge case: a kid timing a withdrawal right before commit-day still gets a full week's interest on the pre-withdrawal balance. With realistic APRs and weekly commits this is at most a few cents per week — not worth gaming, not worth fixing.

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

## Saving goals

Add via `/pocket-money` → "Add goal". Three image-lookup modes: catalog search (reuses the shopping-item catalog), URL paste, or local upload. One goal is `is_primary` and drives the kid view's progress bar; the queue auto-promotes on completion. When a goal hits 100%, the kid sees a "🎉 You can buy this!" button → creates a withdrawal request → parent confirms in the inbox at `/settings/pocket-money`. Confirmation deducts the balance and marks the goal `bought`.

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

## Disabling the plugin

Toggle off at `/settings/plugins` → **Pocket Money**. Nav entry, dashboard widget, and settings page disappear. Account data, transactions, goals, withdrawal requests are preserved.
