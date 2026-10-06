# Creatures & rewards

Each child can have a creature: a drawn dragon, unicorn, T-Rex, princess or one of the other species, which hatches from an egg and grows as the child does their tasks. A child's task points also buy rewards the parents choose ("an hour of Minecraft for 50 points"). Neither needs the Pocket Money plugin: a family that never uses pocket money can still give a child a creature and run rewards.

Until v1.13 the creature and the rewards were part of [[Pocket Money|Pocket-Money]]. Since RFC-017 they are their own thing; pocket money keeps the euros (allowance, interest, goals, withdrawals). For a family that used them before, nothing looks different: every child who had a pocket-money avatar has the same creature, at the same stage, in the same look.

## Switching a creature on

**Settings → Creatures & rewards** (*Kreaturen & Belohnungen*, *Créatures et récompenses*), behind the settings PIN like all settings. Every child in the family has a card with a switch.

- **On.** A child who never had a creature picks one first: every species is shown with its eight stages. It starts as an egg.
- **Off.** The creature disappears from the child's screens, but nothing is deleted. Switching it back on brings back the same creature, at the same stage, in the same look.

A child without a creature sees nothing of it. Mark a family member as a child under Settings → People first.

Per child, with the creature on:

| Setting | What it does |
|---|---|
| **Creature** → *Change* | Another species. The stage, the style and the look stay. |
| **Grows with** | *Task points* (the default): it grows with every point the child earns and never shrinks, even when points are spent. *Saved money*: it grows with the money in the child's pocket-money account, as the pocket-money avatar always did. Offered only with the Pocket Money plugin on and an account for that child. |
| **Shop** | Lets the child buy things for their creature with points. Stored now; the shop itself comes in a later release. |
| **Look** | The drawing style. The child can change it on their own page too, with no PIN. |

The stages, the look editor and the cheering when a task is ticked off are described on the [[Pocket Money|Pocket-Money]] page (*Avatar evolution*, *Avatar style*, *Points instead of euros*); they work the same for every creature.

Where the creature shows today: the child's Pocket money page, the Pocket money widget on the dashboard, and the child's profile on the dashboard. A creature widget, a place on the tasks page and a rewards page of its own follow in the next steps of RFC-017.

## Points and rewards

A child's **points balance** is the points their tasks have earned, all time, minus the rewards a parent has approved. It belongs to the child, not to a pocket-money account, and it never shows less than zero. A request that is still waiting is held back.

**The catalogue** is on the same settings page: a title, a cost from 1 to 10000 points, an optional emoji and an *Active* switch. It is shared by every child in the family.

**Redeeming.** A child with a creature growing with points sees their points and the rewards on their page and taps **Redeem**. That only asks: the request waits under *Rewards waiting for approval* on Settings → Creatures & rewards and on the navigation badge. **Approve** spends the points, **Deny** spends nothing. Both need the settings PIN, checked on the server too, so a child's own screen can't approve its own request. Two screens approving at once book it once, and an approval the points no longer cover is refused while the request keeps waiting.

## For operators

- The data lives in the `creatures` table, one row per child that has one (`person_id`, `species`, `style`, `look`, `best_tier`, `last_seen_tier`, `grows_with`, `shop_enabled`, `enabled`). Reward requests (`point_redemptions`) belong to a person; `account_id` stays, nullable, for one release.
- The migration is `webapp/docker/migration_zzzzzzzz_pocket_money_creatures_out.sql`. It applies on start like every migration and gives every child who has a pocket-money account a creature with their account's species, style, look and stage, growing with points if the account was in points mode and with money otherwise. It does this once, when it creates the table.
- `creatures` streams live, so **restart realtime once after upgrading**: `docker restart kinboard-realtime`, or `docker compose restart realtime` with the `-f` files you normally use. Until then a creature switched on or changed on one screen shows on another only when that screen reloads.
- Screens only read `creatures`; every write goes through Kinboard's server (`/api/creatures`, `/api/rewards`), which checks the settings PIN for a parent's choices.
- A rollback to v1.13.0-rc.13 keeps working: the old pocket-money columns are still there, unchanged since the upgrade, and a trigger keeps reward requests readable per account. What changes while rolled back (a new account, a mode or style change) stays on the account and is not carried over to the creature on the next upgrade.
- In a family with the Pocket Money plugin switched off, the migration keeps each child's creature but leaves it switched off; grown-ups with an account get none.
- A family backup carries the creatures and the requests. Restoring a backup from before this release gives each child the creature their pocket-money account had, by the same rule as the migration.
