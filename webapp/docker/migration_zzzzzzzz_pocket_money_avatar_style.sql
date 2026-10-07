-- migration_zzzzzzzz_pocket_money_avatar_style.sql
-- How a child's avatar is drawn.
--
--   pocket_money_accounts.avatar_style   'classic'   the static pictures in
--                                                    public/pocket-money/avatars
--                                                    (the default: every account
--                                                    looks exactly as before)
--                                        'gumdrop' | 'sticker' | 'storybook'
--                                                    drawn in code by
--                                                    webapp/src/lib/pocket-money/creatures
--
-- The species stays in avatar_species. A style the species has no drawings
-- for yet (cat, astronaut, plant, wizard) is shown as classic by the screens,
-- so the column holds the child's choice, not what is currently drawable.
--
-- WHO MAY WRITE. The child: it is their own avatar, chosen from their own
-- pocket-money page, so PATCH /api/pocket-money/accounts/[id] takes it with no
-- settings PIN, like last_seen_tier and best_tier. avatar_species stays a
-- parent's setting. Browser roles write nothing here directly (#361); the
-- CHECK below holds a direct write and the route alike to the four values.
--
-- Sorts after migration_zzzzzzz_point_rewards.sql, the last one to change this
-- table. Safe to run twice; it runs on every boot.

-- ONLY BEFORE THE CREATURES MOVED OUT. The style lives on `creatures` since
-- RFC-017, and a later release drops this column from the account (RFC-017
-- §7 step 5). This file re-runs on every boot, so without the guard a
-- rollback to this release after that drop would put the column back, empty
-- -- or, for best_tier and the trigger, fail and keep the app from starting.
-- `creatures` existing is the marker: it is created and filled from the
-- account columns in one statement (migration_zzzzzzzz_pocket_money_creatures_
-- out.sql), so from then on nothing needs this file to run. A 1.12 install
-- upgrading has no `creatures` yet and still gets the column here, before the
-- creatures are built from it.
DO $$ BEGIN
  IF to_regclass('public.creatures') IS NOT NULL THEN RETURN; END IF;
  ALTER TABLE public.pocket_money_accounts
    ADD COLUMN IF NOT EXISTS avatar_style TEXT NOT NULL DEFAULT 'classic';
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pocket_money_accounts_avatar_style_check') THEN
    ALTER TABLE public.pocket_money_accounts
      ADD CONSTRAINT pocket_money_accounts_avatar_style_check
      CHECK (avatar_style IN ('classic', 'gumdrop', 'sticker', 'storybook'));
  END IF;
END $$;
