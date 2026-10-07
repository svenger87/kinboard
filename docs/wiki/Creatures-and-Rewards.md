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
| **Shop** | Lets the child buy things for their creature with their points, on their Rewards page (see *The shop* below). Off hides the shop; what was bought stays the child's and stays on. Below the switch is the list of what the child bought, with the dates. |
| **Look** | The drawing style. The child can change it on their own page too, with no PIN. |

The stages, the look editor and the cheering when a task is ticked off are described on the [[Pocket Money|Pocket-Money]] page (*Avatar evolution*, *Avatar style*, *Points instead of euros*); they work the same for every creature.

## Where the creatures show

| Where | What |
|---|---|
| **Creatures widget** on the dashboard | Every child's creature side by side: the child's name, the stage (with the creature's own name if it has one) and what they have to spend -- their points, or the money saved for a creature that grows with money. Tap a creature for that child's Rewards page. Switch it on under Settings → Widgets (*Creatures*); it is off by default. With no creature switched on yet it says where creatures come from. From three children on it takes two columns of the dashboard. |
| **Rewards page** (`/rewards`) | One child at a time, picked at the top. The creature, large: tap it and it hops; *Change look*; its stage and a bar to the next one (tap it for all the stages); the child's points and anything they owe; the family's rewards to redeem, with the requests still waiting. Works for a child without a pocket-money account. `/rewards?child=<person id>` opens a child's tab directly. |
| **Navigation** | *Rewards* (*Belohnungen*, *Récompenses*) appears once a child in the family has a creature switched on, and its badge counts the requests waiting for a parent. Hide it on a device under Settings → Navigation like any other item. |
| **Tasks page** | Each child's creature, small, beside their name and points; it cheers when one of their tasks is ticked off. Only for children with a creature. |
| **A child's profile** (tap them on the dashboard) | The creature, the points to spend and *To the rewards*. |
| **Pocket money page and widget** | Unchanged: the creature next to the money, for families who use both. |

On the dashboard, the tasks page and the profile the creatures stand still -- a wall display's Raspberry Pi has nothing to redraw -- and move only for the second and a half they cheer. They are sleepy at night and happy once the day's tasks are done.

## A child's own device

Under **Settings → Devices** each device has *Belongs to*: the family (the default) or a person. A device that belongs to a child with a creature opens on that child's Rewards page instead of the dashboard: when the app starts, is reloaded or is opened from the home screen. **Home** in the navigation still goes to the dashboard, so the rest of Kinboard is one tap away. A device marked as a **kiosk** ignores it and always opens on the dashboard -- it is the family's screen, whoever it was set up for.

Setting it is a parent's choice, behind the settings PIN; Kinboard's server checks the PIN too, so a child's phone can't make itself someone else's.

## Icons

Tasks and rewards pick their icon from one emoji picker: every emoji except flags (Windows draws flags as two letters). Search in the screen's language or in English -- "Eis", "glace" and "ice" all find 🍦 -- or browse by category; the emoji picked last on this device come first, and a skin tone chosen once is remembered on the device. Kinboard checks on the server that an icon is exactly one emoji. A reward whose icon was typed as text before the picker keeps it until someone picks a new one.

## Points and rewards

A child's **points balance** is the points their tasks have earned, all time, minus the rewards a parent has approved. It belongs to the child, not to a pocket-money account, and it never shows less than zero. A request that is still waiting is held back.

**The catalogue** is on the same settings page: a title, a cost from 1 to 10000 points, an optional emoji from the picker and an *Active* switch. It is shared by every child in the family.

**Redeeming.** A child with a creature sees their points and the rewards on the Rewards page and taps **Redeem**. That only asks: the request waits under *Rewards waiting for approval* on Settings → Creatures & rewards and on the navigation badge. **Approve** spends the points, **Deny** spends nothing. Both need the settings PIN, checked on the server too, so a child's own screen can't approve its own request. Two screens approving at once book it once, and an approval the points no longer cover is refused while the request keeps waiting.

## The shop

On the Rewards page, under the rewards, a child whose shop is on can spend points on things for their creature (*Shop*, *Boutique*). Nineteen items in four places:

| Place | Items and prices (points) |
|---|---|
| **Hats & more** | Cap 25, wizard hat 40, pirate hat 40, headphones 30, flower crown 35, space helmet 60 |
| **Glasses** | Heart glasses 20, monocle 25, star glasses 30 |
| **Around the neck** | Scarf 20, bow tie 20, medal 35, cape 45 |
| **Backgrounds** | Starry sky 60, forest 70, snow 70, rainbow 80, beach 80, outer space 120 |

- Each card shows the child's own creature with the item on, in its own style. **Buy** asks once and then spends the points straight away: no PIN, it's the child's own choice. The shop only sells what the child can afford, holding back rewards still waiting for a parent, and each item only once.
- An item bought is the child's for good. **Wear** puts it on, **Take off** takes it off; *Change look* offers the bought items too. One item per place: a hat from the shop replaces the free bow, party hat or flower (and the crown at the top stage, until it's taken off), shop glasses replace the free sunglasses.
- Hats and glasses show from the hatchling on, neckwear once the creature is out of its shell; an egg wears only a background (the shop's cards show every item on a grown creature either way). Backgrounds sit behind the creature in a rounded frame. A creature shown as its classic picture changes to its Gumdrop drawing when something is put on, as with *Change look*. The astronaut, the plant and the wizard, which aren't drawn yet, have no shop.
- **Buying never shrinks a creature**: it grows with the points earned, and a purchase only lowers what's left to spend. The balance is earned minus approved rewards minus purchases.
- A parent turns the shop off per child under Settings → Creatures & rewards. The shop disappears from the Rewards page; anything bought stays on, and the child can still take it off or put it back on under *Change look*.
- **Refunds are a parent's.** The same page lists what each child bought, with the dates, and *Refund* (settings PIN) gives the points back and takes the item off if it's being worn. The item leaves the list and can be bought again later. For the child, what they buy stays theirs: only a parent can refund.

## Asking from Home Assistant or an assistant

Home Assistant (the *points balance*, *creature stage* and *reward requests* sensors, and the `kinboard.request_reward` action) and a connected assistant (`get_rewards`, `request_reward`) see each child's points and creature stage, the rewards and what is waiting, and can ask for a reward. Asking is the same as the child tapping **Redeem**: it waits for a parent and the PIN, and nothing outside the family's screens can approve it. The creature's name and look are never sent out.

**Who is told.** A new request pushes the family's phones -- every device except wall displays (kiosks) and those that *belong to* a child -- with *"Mia would like 🎮 An hour of Minecraft (50 ⭐)"*; a tap opens the requests at the top of Settings → Creatures & rewards. An answer pushes the child's own device, if one belongs to them. Quiet hours apply, and each device has a *Reward requests* switch in Settings → Notifications.

## For operators

- The data lives in the `creatures` table, one row per child that has one (`person_id`, `species`, `style`, `look`, `best_tier`, `last_seen_tier`, `grows_with`, `shop_enabled`, `enabled`). Reward requests (`point_redemptions`) belong to a person; `account_id` stays, nullable, for one release.
- The migration is `webapp/docker/migration_zzzzzzzz_pocket_money_creatures_out.sql`. It applies on start like every migration and gives every child who has a pocket-money account a creature with their account's species, style, look and stage, growing with points if the account was in points mode and with money otherwise. It does this once, when it creates the table.
- `creatures` streams live, so **restart realtime once after upgrading**: `docker restart kinboard-realtime`, or `docker compose restart realtime` with the `-f` files you normally use. Until then a creature switched on or changed on one screen shows on another only when that screen reloads.
- Screens only read `creatures`; every write goes through Kinboard's server (`/api/creatures`, `/api/rewards`), which checks the settings PIN for a parent's choices.
- A rollback to v1.13.0-rc.13 keeps working: the old pocket-money columns are still there, unchanged since the upgrade, and a trigger keeps reward requests readable per account. What changes while rolled back (a new account, a mode or style change) stays on the account and is not carried over to the creature on the next upgrade.
- In a family with the Pocket Money plugin switched off, the migration keeps each child's creature but leaves it switched off; grown-ups with an account get none.
- A family backup carries the creatures and the requests. Restoring a backup from before this release gives each child the creature their pocket-money account had, by the same rule as the migration.
- The reward pushes are `reward_requested` and `reward_decided` rows in `scheduled_notifications`, sent by the usual `process-notifications` job. Each device's switch is `notification_preferences.reward_requests` (default on), added by `webapp/docker/migration_zzzzzzzz_reward_notifications.sql`; nothing new streams.
- The Integration API has `GET /api/integration/v1/rewards` (`family:read`) and `POST /api/integration/v1/rewards/requests` (`pocket_money:write`); `webapp/openapi/integration-v1.yaml` documents both.
- **Who a device belongs to** is `devices.person_id` (nullable, cleared when the person is deleted), added by `webapp/docker/migration_zzzzzzzzz_device_owner.sql`. Only the server writes it (`PATCH /api/devices/<id>`, settings PIN): the migration narrows the browser roles' INSERT and UPDATE on `devices` to every other column. Nothing new streams, so no realtime restart is needed for it.
- **The shop** (`webapp/docker/migration_zzzzzzzzz_point_purchases.sql`) adds `point_purchases` (one row per item a child owns: `person_id`, `item_id`, `cost`, `created_at`) and `purchase_person_point_item()`, which buys under the same per-child lock as reward requests and approvals. `point_person_totals()` keeps its name and arguments and gains a `purchased` amount; its `balance` now subtracts purchases, and reward requests and approvals check that balance. The catalogue and its prices live in Kinboard's code (`webapp/src/lib/pocket-money/creatures/shop.ts`); the item ids are stable and stored in the creature's `look` (`head`, `face`, `neck`, `background`). Screens only read the table; buying is `POST /api/creatures/<person id>/purchases` (no PIN), a refund is `DELETE /api/creatures/purchases/<purchase id>` (settings PIN; `refund_person_point_purchase()` deletes the row and takes the item out of the look, under the same lock), wearing is the creature's look, which the server accepts only with owned items. `point_purchases` streams live, so **restart realtime once after upgrading** (`docker restart kinboard-realtime`); until then a purchase shows on the child's other screens only after a reload. Backups carry the purchases. A rollback to rc.15 forgets the purchases in the balance: while rolled back the children get those points back, the rows stay, and they count again after the next upgrade -- so points spent on rewards in between can show as *still to make up*. A backup made on rc.15 has no purchases, so restoring it drops the worn shop items.
- The emoji picker's names and keywords (Unicode CLDR, via the pinned `emojibase-data`, MIT) are generated into `webapp/src/lib/emoji/` by `node scripts/generate-emoji-data.mjs` and loaded from Kinboard itself, only when a picker opens: no CDN, so it works offline. Emoji newer than Unicode 15.0 are left out, since a Raspberry Pi's emoji font can't draw them yet.
