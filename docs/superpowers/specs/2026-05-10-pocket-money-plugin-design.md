# Pocket Money Plugin (codename: **Piggy**) — Design Spec

> **Status**: brainstormed 2026-05-10; ready for writing-plans hand-off.
> **Phase**: pre-implementation. No code written yet.
> **Authors**: maintainer + Claude (brainstorming-driven design).

## Why this is a USP-grade feature

Self-hosted family-dashboard projects don't ship anything like this today. The closest commercial equivalents — Greenlight, RoosterMoney — are bank-linked apps with $5–10/month subscriptions, kid card hardware, and a privacy story that lives on someone else's database. Kinboard's pocket-money plugin gets to be the privacy-respecting, no-fee alternative.

The differentiator is that it's a **savings character**, not a banking app. One avatar that visibly grows as the kid saves, plus saving goals with real-world pictures. The point is **emotional connection to saving**, not Tamagotchi-grade complexity.

Kid-engagement loop (intentionally minimal):
1. Kid does a chore → balance goes up → after enough deposits the avatar evolves to the next stage.
2. Kid sets a goal with a picture of the thing they want → progress bar fills → parent confirms when funded.
3. Sunday morning interest pay → small coin-shower animation → balance bumps.

Parent-engagement loop:
1. Configure once at `/settings/pocket-money` (allowance, APR, max-eligible cap).
2. Approve goal-reached purchases + ad-hoc withdrawals from the inbox.

Cost to ship: ~2 weeks for the v0.1 release. The bulk of the cost is **avatar art** (3 species × 5 evolution stages = 15 SVGs), not code — sourced from CC0 SVG packs.

**Deliberately not shipping** (in v0.1 OR ever, unless asked later): cosmetics shop, separate coin currency, XP bar, level numbers, streak counters, badges, multiple animation types. Those are kid-app tropes that don't survive contact with actual children — too many concepts, too much screen clutter, too much for an 8-year-old to track. The character + the goal picture + the balance number is the entire mental model.

---

## 1. Plugin shape

Fifth registered SurfacePlugin (after Vehicles, Energy, Cameras, Stonks). Multi-row pattern keyed by `person_id`, mirroring how Vehicles is one row per car. `/pocket-money` page tabs through accounts. No vendor/driver abstraction — there's only one implementation; no external bank API to swap in.

The plugin is opt-in per family at `/settings/plugins`. When enabled but no kid accounts exist yet, the dashboard widget hides and the nav entry disappears (predicate: `accounts.length > 0`). Adding the first account from `/settings/pocket-money` materialises everything.

### Cross-plugin touch-points

- **People plugin**: schema add — `people.is_kid: boolean default false`. The pocket-money plugin only allows accounts on people with `is_kid = true`; the `is_kid` toggle lives on the per-person edit screen. Future kid-mode dashboard / age-appropriate widgets re-use the flag.
- **Todos plugin** (Phase 2): schema add — `todos.reward_cents: integer default 0`. When a todo with `reward_cents > 0` and `assigned_to` set transitions to `done`, the plugin's listener auto-credits the kid's account. Idempotent via the existing `notified_at` style flag (`reward_credited_at` on todos).

Both schema additions are idempotent migrations and don't break anything if the pocket-money plugin is disabled.

---

## 2. Data model

Four new tables (all idempotent, all cascade-delete on `family_id`):

### `pocket_money_accounts` (one per kid per family)
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `family_id` | UUID NN FK families | |
| `person_id` | UUID NN UNIQUE FK people | One account per kid |
| `currency` | TEXT NN | e.g. `EUR`, `USD`. Default from family locale. |
| `balance_cents` | INT NN default 0 | Real spendable money |
| `apr_bps` | INT NN default 1000 | Basis points (1000 = 10% APR). Parent-configurable. |
| `weekly_allowance_cents` | INT NN default 0 | 0 means no scheduled allowance |
| `allowance_day_of_week` | INT NN default 0 | 0=Sunday … 6=Saturday |
| `max_balance_eligible_cents` | INT NN default 50000 | Cap above which interest doesn't apply (€500 default) |
| `pending_interest_cents` | INT NN default 0 | Accrued but not yet committed |
| `interest_committed_day_of_week` | INT NN default 0 | When the weekly commit fires |
| `last_accrued_date` | DATE | Idempotency for daily accrual cron |
| `last_allowance_at` | TIMESTAMPTZ | Idempotency for allowance cron |
| `interest_committed_at` | TIMESTAMPTZ | Last weekly commit; drives the coin-shower animation on next kid-view load |
| `avatar_species` | TEXT NN | `dragon` \| `cat` \| `astronaut`. Picked once on account creation. |
| `lifetime_saved_cents` | INT NN default 0 | Cumulative deposits + interest. Drives avatar evolution stage. Withdrawals don't reduce it. |
| `last_seen_tier` | INT NN default 1 | The tier the kid was last shown; if `current_tier > last_seen_tier`, play the tier-promotion animation on next view. |
| `created_at`, `updated_at` | TIMESTAMPTZ NN | |

### `pocket_money_transactions` (immutable log)
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `account_id` | UUID NN FK | CASCADE |
| `amount_cents` | INT NN | Signed. + inflow, − outflow |
| `type` | TEXT NN | `allowance` \| `manual_deposit` \| `interest` \| `withdrawal` \| `adjustment` |
| `note` | TEXT | Optional human description |
| `related_goal_id` | UUID FK goals | Set when withdrawal corresponds to "I bought the goal" |
| `created_by_person_id` | UUID FK people | Audit trail; parent vs kid |
| `created_at` | TIMESTAMPTZ NN | |

Index on `(account_id, created_at desc)` for the transaction-history query.

### `pocket_money_goals`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `account_id` | UUID NN FK | CASCADE |
| `name` | TEXT NN | |
| `target_amount_cents` | INT NN | |
| `image_url` | TEXT | Resolved URL (catalog item, uploaded, or pasted) |
| `image_source` | TEXT NN | `catalog` \| `upload` \| `url` |
| `position` | INT NN | For ordering; 0 = primary |
| `is_primary` | BOOL NN default false | Exactly one true per account (enforced via partial unique index) |
| `status` | TEXT NN default `active` | `active` \| `ready_to_buy` \| `bought` \| `abandoned` |
| `target_reached_at` | TIMESTAMPTZ | Set when balance first crossed target |
| `parent_confirmed_at` | TIMESTAMPTZ | Set when parent ticked "bought" |
| `created_at`, `updated_at` | TIMESTAMPTZ NN | |

Partial unique index: `(account_id) WHERE is_primary AND status = 'active'`.

### `pocket_money_withdrawal_requests`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `account_id` | UUID NN FK | CASCADE |
| `amount_cents` | INT NN | Positive |
| `reason` | TEXT NN | Kid's "why" |
| `status` | TEXT NN default `pending` | `pending` \| `approved` \| `denied` |
| `parent_decided_at` | TIMESTAMPTZ | |
| `parent_decided_by_person_id` | UUID FK people | |
| `related_goal_id` | UUID FK goals | Present when goal hit 100% — parent's "confirm purchase" UI uses this row |
| `created_at` | TIMESTAMPTZ NN | |

### Static catalog (not DB)
- `webapp/src/plugins/pocket-money/catalog/avatars.json` — species + tier-art mapping
- `webapp/public/pocket-money/avatars/{species}-{tier}.svg` — 15 files total

### Migrations

`webapp/docker/migration_pocket_money.sql` — creates all four tables idempotently, plus the partial unique index on goals.
`webapp/docker/migration_people_is_kid.sql` — adds `is_kid BOOLEAN NOT NULL DEFAULT false` to `people`. Existing rows default to `false`.

---

## 3. UX surfaces

### `/pocket-money` (kid-friendly, full-screen)

Top-of-page tabs across multiple kids — same per-kid tab pattern as `/schedule`. Within each tab, three zones, top to bottom:

- **Avatar (top, ~40% of viewport)**: the SVG of the current species at the current evolution tier. Centered, generously sized so it's the visual anchor of the page. No particles, no level number, no XP bar — just the character.
- **Balance + primary goal**:
  - Big balance number with currency. Subtle "+ €0.32 today" tag in green if interest accrued today.
  - Primary goal card directly below: image of the desired item, name, progress bar (`€18.50 of €30 — 62%`). When funded: "🎉 You can buy this!" button → starts the parent-approval purchase flow.
- **Bottom action row + secondary goals**:
  - `Add goal` button, `Spend money` button (creates a withdrawal request).
  - Secondary goals as a horizontal scroll strip if more than one exists.

That's the entire kid view. No cosmetics shop, no badge wall, no XP bar, no streak counter, no menu. Transaction history lives behind a small "history" link in the corner — not a primary surface.

### `/settings/pocket-money` (parent admin)
- **Per-account row**: kid's name + face + current balance + APR + allowance amount + edit button.
- **Inbox at top** (red dot if non-empty):
  - Withdrawal requests (kid's reason + amount + Approve/Deny)
  - Goal-reached confirmations (`Liam reached his Lego goal — €30 — Bought / Not yet / Abandon`)
- **Per-account edit**: APR slider (with soft warning at >20%), allowance amount + day-of-week picker, max-eligible cap, interest commit day-of-week, manual deposit/withdrawal buttons, transaction history.
- **Liability total at top**: "Currently owed to kids: €87.50" — sum of all account balances. Helps parents reconcile against actual cash.

### Dashboard widget
Per-kid tabs at the top (matches `/schedule`'s pattern). Each tab content:
- Avatar mini at left
- Kid name + balance + tiny progress bar to primary goal
- Tap anywhere → jumps to `/pocket-money` for that kid

---

## 4. Avatar evolution + minimal celebrations

The entire gamification layer is **one avatar that evolves through 5 visual stages** as the kid saves. That's it. No XP bar, no level number, no badges, no streak counter, no second currency, no cosmetics shop.

### Avatar species (kid picks one on first-account creation)
- `dragon` — Egg → Hatchling → Drake → Adult → Ancient
- `cat` — Kitten → Young → Adult → Wise → Legendary
- `astronaut` — Rookie → Cadet → Pilot → Captain → Commander

Stage names are friendly, species-appropriate, and visible to the kid as a small caption under the avatar (e.g. *"Tycho the Drake"*). The species choice is one-time at account creation; the avatar's name is editable.

### Evolution thresholds (driven by `lifetime_saved_cents`)
| Stage | Lifetime saved |
|---|---|
| 1 (default) | €0 (start) |
| 2 | €5 |
| 3 | €25 |
| 4 | €100 |
| 5 | €500 |

Withdrawals do NOT reduce `lifetime_saved_cents` — once a kid has earned a stage, they keep it. Saving still progresses even when they spend on real things (which is the right pedagogical message — "you've grown by all the saving you've done over time").

### Three celebration moments (lightweight, gated once-per-event)

| Trigger | Animation | Duration |
|---|---|---|
| Avatar evolves to a new stage (when `current_tier > last_seen_tier`) | Radial burst + before/after avatar fade | ~4s |
| Goal reached (balance first crosses a goal's target) | Trophy lands on the avatar | ~3s |
| Weekly interest committed (Sunday cron, only if amount > 0) | Coin shower onto the avatar | ~3s |

All three use framer-motion + small inline SVGs — no heavy art. Each gated by a state column on the account (`last_seen_tier` for evolution, `target_reached_at` + `parent_confirmed_at` on the goal row, `interest_committed_at` for the weekly pay) so a page reload doesn't re-trigger.

### Art assets
- 3 species × 5 stages = **15 SVGs total**, all sourced from CC0 packs (game-icons.net, openmoji)
- 1 trophy SVG, 1 coin SVG, 1 sparkle/burst SVG for animations
- Total art delivery: ~18 files. Designer-replaceable per-asset later.

---

## 5. Cron jobs

Adding to `webapp/docker/ofelia.ini`:

| Job | Schedule | Endpoint | What it does |
|---|---|---|---|
| `accrue-interest` | `@every 24h` (00:30 UTC) | `POST /api/cron/accrue-interest` | Per account with `apr_bps > 0`: compute `min(balance, max_eligible) × (apr_bps / 10000 / 365)`, add to `pending_interest_cents`. Idempotent via `last_accrued_date`. |
| `commit-interest` | `@every 1h` (checks per-account scheduled day) | `POST /api/cron/commit-interest` | Per account where `today_dow == interest_committed_day_of_week`: move `pending_interest_cents` → `balance_cents` as a single `interest` transaction. Set `interest_committed_at` to drive the coin-shower animation on next kid-view load. |
| `process-allowance` | `@every 1h` | `POST /api/cron/process-allowance` | Per account where `today_dow == allowance_day_of_week` and `last_allowance_at` is more than 6 days old: deposit `weekly_allowance_cents` as an `allowance` transaction. |

All bearer-token gated with `${CRON_SECRET}`. All endpoints declare `runtime = "nodejs"` and `dynamic = "force-dynamic"`. Each is independently idempotent so a missed firing or double-firing recovers without manual intervention.

---

## 6. API surface

All routes declare `runtime = "nodejs"`, `dynamic = "force-dynamic"`. Mirrors the patterns from `/api/tickers/`, `/api/vehicles/`, `/api/cron/*`.

### Family-scoped CRUD
- `GET POST  /api/pocket-money/accounts?family_id=` — list / create
- `GET PATCH DELETE  /api/pocket-money/accounts/[id]` — read / update settings / soft-delete
- `GET POST  /api/pocket-money/accounts/[id]/transactions` — history / parent-only deposit-or-withdraw
- `GET POST  /api/pocket-money/accounts/[id]/goals` — list / add (with image lookup)
- `PATCH DELETE  /api/pocket-money/goals/[id]` — re-rank/edit/abandon
- `GET POST  /api/pocket-money/accounts/[id]/withdrawal-requests` — list (parent inbox) / kid-create
- `PATCH  /api/pocket-money/withdrawal-requests/[id]` — parent approve/deny
### Image lookup proxy (reuses item-catalog plumbing)
- `GET  /api/pocket-money/goal-image-search?q=` — passes through to existing `useCatalogSearch` infra; returns thumbnail suggestions
- `POST  /api/pocket-money/goal-image-upload` — multipart upload; reuses `webapp/src/hooks/use-image-upload.ts`. Stores in a new public `goal-images` Supabase bucket, family-scoped path.

### Static catalog (cached aggressively client-side)
- `GET  /api/pocket-money/catalog/avatars` — species + stage SVG paths

### Cron endpoints (Bearer `${CRON_SECRET}`)
- `POST /api/cron/accrue-interest`
- `POST /api/cron/commit-interest`
- `POST /api/cron/process-allowance`

---

## 7. Phasing — one release (~2 weeks)

The simplification dropped the second-phase content (cosmetics shop, streaks, badges, more animations) entirely. v0.1 IS the whole feature.

Single release scope:
- Four tables + `people.is_kid` migration (idempotent)
- Avatar evolution (3 species × 5 stages = 15 SVGs) + the three celebration animations
- Multi-goal queue with image lookup (catalog search + manual URL + upload)
- Cash flow: scheduled allowance + manual deposit/withdrawal (parent)
- Daily interest accrual + weekly commit cron + allowance cron
- Kid view (`/pocket-money`), parent settings (`/settings/pocket-money`), dashboard widget (per-kid tabs like `/schedule`)
- Withdrawal-request flow + parent-approval queue
- Goal-reached → parent-approval queue + auto-deduct on approval
- EN+DE i18n parity (CI gate)

### Possible future additions (not in scope, separate brainstorm if they ever come up)
- Todos integration: optional `reward_cents` column on `todos` + auto-deposit on completion (small, could land standalone)
- Sibling co-op goals
- Multi-currency per family
- Custom parent-uploaded avatar art

---

## 8. Risks + mitigations

| Risk | Mitigation |
|---|---|
| **Avatar art volume** — 15 SVGs (3 species × 5 stages) plus 3 helper sprites | Source from CC0 SVG packs (game-icons.net, openmoji, lucide). Catalog is JSON referencing SVGs in `webapp/public/pocket-money/`, swappable per-asset later by a designer without code changes. |
| **"Real" money confusion** — kid thinks the virtual €18.50 is actual cash; parent forgets to physically pay out | UI uses kid-friendly verbiage. Parent dashboard shows "Currently owed to kids: €X" total. Each transaction log entry is plain — easy to reconcile against actual money flows. |
| **Interest rate cargo-culting** — parent picks 50% APR for fun, balance balloons absurdly | Soft warning at >20% APR. `max_balance_eligible_cents` cap (default €500) prevents absurdity even when parents go wild. |
| **Currency cross-talk** — Kinboard is single-family, family is single-currency in practice | Account has a `currency` column defaulting to family locale's currency. Single currency per family in v0.1; cross-currency transfers out of scope. |
| **Kid permission boundary on shared kiosk** — no per-user auth | Kid actions are all "safe" (add goal, buy cosmetic, propose withdrawal). Destructive primitives (direct debit, edit interest rate, approve withdrawal) live in `/settings/pocket-money` which is parent-territory by convention. v0.3 could add a parent-PIN gate on `settings/*`. |
| **`is_kid` flag back-compat** — existing self-hosters' people rows default to `false` | First-run UX at `/settings/pocket-money` shows "No kids yet — toggle `Is a kid` on a person at /settings/people" if no kids exist. Inline link to the right page. |

---

## 9. Definition of done

A v0.1 ship is acceptable when:

- A self-hoster can enable the plugin at `/settings/plugins`, mark a person as a kid, create their account at `/settings/pocket-money`, set APR + weekly allowance, pick the kid's avatar species, and start depositing.
- The kid can open `/pocket-money`, see their avatar evolve as `lifetime_saved_cents` crosses thresholds, add goals via image lookup, propose withdrawals.
- The parent inbox shows pending withdrawal requests + goal-reached confirmations and can approve/deny.
- Daily interest accrues; weekly commit fires; allowance auto-deposits.
- The three celebration animations (avatar evolution, goal reached, weekly interest pay) fire once per event and don't re-trigger on page reload.
- All migrations applied idempotently on the existing demo + prod stacks via the Diun self-update path.
- CHANGELOG entry under `[Unreleased]` → Added.
- Wiki page `Pocket-Money.md` with screenshots + parent setup walkthrough.
- EN+DE i18n parity (CI gate).
