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

## Avatar evolution

Tier promotes when `lifetime_saved_cents` (cumulative deposits + interest, NOT affected by withdrawals) crosses these thresholds:

| Stage | Lifetime saved |
|---|---|
| 1 | €0 (start) |
| 2 | €5 |
| 3 | €25 |
| 4 | €100 |
| 5 | €500 |

Each promotion plays a once-per-event radial-burst animation. Withdrawals don't downlevel — the kid keeps their progress.

## Saving goals

Add via `/pocket-money` → "Add goal". Three image-lookup modes: catalog search (reuses the shopping-item catalog), URL paste, or local upload. One goal is `is_primary` and drives the kid view's progress bar; the queue auto-promotes on completion. When a goal hits 100%, the kid sees a "🎉 You can buy this!" button → creates a withdrawal request → parent confirms in the inbox at `/settings/pocket-money`. Confirmation deducts the balance and marks the goal `bought`.

## What's not supported (yet)

- Cosmetics shop, badges, streak counter — deliberately not in scope (see [`docs/superpowers/specs/2026-05-10-pocket-money-plugin-design.md`](../superpowers/specs/2026-05-10-pocket-money-plugin-design.md))
- Todos `reward_cents` integration (chore → auto-credit) — possible follow-up
- Sibling co-op goals
- Multi-currency per family
- Custom parent-uploaded avatar art (catalog SVGs are designer-replaceable per file in `webapp/public/pocket-money/avatars/`)

## Disabling the plugin

Toggle off at `/settings/plugins` → **Pocket Money**. Nav entry, dashboard widget, and settings page disappear. Account data, transactions, goals, withdrawal requests are preserved.
