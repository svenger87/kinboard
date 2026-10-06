# RFC-017 — Creatures and rewards outside pocket money

| | |
|---|---|
| **Status** | Implemented: step 1 #370 (rc.14), step 2 #371 (rc.15); the shop (step 3) is in progress; dropping the old account columns (step 5) follows in a later release |
| **Depends on** | RFC-016 (drawn creatures), #353 (points mode, rewards), #361 (server-only writes) |
| **Decisions taken** | 2026-10-06 by the maintainer, §2 |

## 1. Why

RFC-016 made each child's avatar a drawn creature that grows, moves, reacts
when a task is ticked off, and can be dressed by the child. It all still lives
on the child's *pocket-money account*: the species, the style, the look and the
stage are columns of `pocket_money_accounts`, and the rewards a child buys with
task points hang off that account too.

That no longer fits. The creature grows with **task points**, which every
family has, and the pocket-money page is just one place to see it. A family
that never uses pocket money should still be able to give a child a creature.
They should also be able to run rewards ("an hour of Minecraft for 50 points")
without setting up euro accounts.

## 2. Decisions

1. **A creature is switched on per child, by a parent.** It's not automatic.
   Settings → *Creatures & rewards* (Kreaturen & Belohnungen) has a switch per
   child, behind the settings PIN. Children without one see nothing of it.
2. **Points, rewards and the shop become core.** They no longer need the
   pocket-money plugin. Pocket money keeps the euros: allowance, interest,
   goals and withdrawals.
3. **The creature grows with task points by default.** Where the pocket-money
   plugin is on and the child has an account, a parent can choose *grows with
   saved money* instead, per child, as today's money mode does.

## 3. Data

### 3.1 `creatures`, one row per child that has one

| Column | |
|---|---|
| `person_id` | primary key, references `people` (deleted with the person) |
| `family_id` | for RLS, references `families` |
| `species`, `style`, `look` | as on the account today (RFC-016) |
| `best_tier`, `last_seen_tier` | as today; `best_tier` only climbs, capped at 8 |
| `grows_with` | `points` (default) or `money` |
| `shop_enabled` | default true |
| `created_at`, `updated_at` | |

A row means the creature is on. Switching it off deletes nothing: an
`enabled` flag keeps the creature, so switching it back on returns the same
creature at the same stage.

### 3.2 Rewards and purchases move from the account to the person

- `point_rewards` is already per family and stays as it is.
- `point_redemptions.account_id` becomes `person_id`.
- `point_purchases` (the shop, §5) is per person from the start.
- A child's points balance is per person:
  earned (`todo_point_awards`) − approved redemptions − purchases,
  never below zero, with pending redemptions held. Pocket money's euros are
  not involved.

### 3.3 Migration

1. Create `creatures`.
2. For every `pocket_money_accounts` row whose child has a drawn style, a
   look, a non-default species, or `reward_mode='points'`, create the
   creature with the account's values, `enabled=true`, and
   `grows_with = (reward_mode='points' ? 'points' : 'money')`. Classic
   dragons on accounts that never touched any of this get a creature too,
   since they have one today.
3. Re-key `point_redemptions` from account to person, using the account's
   `person_id`.
4. Leave the old account columns in place for one release (read-only, no
   longer written), then drop them in a later migration. This keeps a rollback
   to rc.13 working.

All idempotent, server-only writes as #361, and sorted before the
pocket-money revoke migration. The RLS and grants guards cover the new
tables.

## 4. Where the creatures live

| Place | What |
|---|---|
| **Dashboard widget "Creatures"** (new) | Every child's creature side by side, reacting live when a task is ticked (#367), with mood. The wall display's main place for them |
| **Tasks page** | The child's creature beside their name or column, cheering on their own ticks |
| **Child's profile** (family widget) | The creature, the points balance, a way to rewards and the shop |
| **Rewards page** `/rewards` (Belohnungen, new nav item) | Per child: the creature large, its stages, "Change look", the shop, the rewards to redeem, the balance |
| **Pocket-money page** | Still shows the creature next to the money, for families that use both |

The pocket-money widget keeps showing euros. The creature moves to its own
widget, so a family can have either or both on the dashboard.

## 5. The shop

As drafted in the mood/cosmetics plan: about twenty items (hats, glasses,
neckwear, backgrounds), drawn in code for every creature and style. The child
buys directly, with no PIN, from their own points. A parent can turn the shop
off per child and sees what was bought. Buying never shrinks the creature,
because the stage follows points earned. The worn items are slots in `look`,
and only owned items can be worn.

## 6. What stays where

| | Before | After |
|---|---|---|
| Creature (species, style, look, stage) | pocket-money account | `creatures`, per child |
| "Grows with" | `reward_mode` on the account | `creatures.grows_with` (money only offered with pocket money on) |
| Rewards catalogue | pocket-money settings | Settings → Creatures & rewards |
| Redemptions | per account | per child |
| Approving a redemption | settings PIN | unchanged |
| Euros, allowance, interest, goals, withdrawals | pocket money | unchanged |

## 7. Steps

1. **Data move**: `creatures`, the redemption re-key, reads switched over, and
   the settings page. No visible change for an existing family, apart from
   the new settings page.
2. **Surfaces**: the Creatures widget, the tasks page, the profile, the
   `/rewards` page with its nav item.
3. **Shop** (§5).
4. **Mood** is already in progress and moves with the creature; it does not
   depend on where the data lives.
5. A later release drops the old account columns.

## 8. Answered 2026-10-06

1. **The Rewards page appears in the navigation only once a child in the
   family has a creature.** A family that never switches one on never sees it.
2. **A child's own device opens straight to their creature.** Devices gain an
   optional *Belongs to* person under Settings → Devices. A device that belongs
   to a child with a creature starts on that child's Rewards page instead of
   the dashboard. A kiosk ignores this, since it's the family's screen. This is
   part of step 2.
