-- migration_zzzzzzzz_pocket_money_avatar_style_look.sql
-- A child's own look for their pocket-money creature (RFC-016 §4).
--
-- The name sorts it right after migration_zzzzzzzz_pocket_money_avatar_style
-- .sql, which it builds on, and before migration_zzzzzzzz_pocket_money_server
-- _only.sql (#361): that one revokes browser writes on every pocket_money_*
-- table and must sort after every migration that names one
-- (e2e/pocket-money-grants.spec.ts).
--
--   pocket_money_accounts.avatar_look   JSONB, '{}' by default
--
--   {} is the creature's own colours. Every key is optional:
--     name                free text, at most 16 characters, shown only on the
--                         family's own screens
--     body, belly, accent colours from the editor's fixed swatches
--     skin, hair          the princess's and the prince's
--     hairstyle           short | long | ponytail | curls
--     pattern             none | spots | stripes | hearts
--     eyes                round | sparkly | happy
--     acc                 none | bow | hat | glasses | flower
--
-- The sets live in webapp/src/lib/pocket-money/creatures/look.ts and the
-- route checks them: a new accessory later needs no migration, which is why
-- this is JSON and not ten columns. The CHECK only holds the shape -- an
-- object, never an array, a string or null.
--
-- WHO MAY WRITE. The child, from their own pocket-money page: PATCH
-- /api/pocket-money/accounts/[id] takes it with no settings PIN, like
-- avatar_style, and refuses unknown keys and values outside the sets. Browser
-- roles write nothing here directly (#361).
--
-- Sorts after migration_zzzzzzzz_pocket_money_avatar_style.sql, the last one to
-- change this table. Safe to run twice; it runs on every boot.

-- ONLY BEFORE THE CREATURES MOVED OUT. The look lives on `creatures` since
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
    ADD COLUMN IF NOT EXISTS avatar_look JSONB NOT NULL DEFAULT '{}'::jsonb;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pocket_money_accounts_avatar_look_check') THEN
    ALTER TABLE public.pocket_money_accounts
      ADD CONSTRAINT pocket_money_accounts_avatar_look_check
      CHECK (jsonb_typeof(avatar_look) = 'object');
  END IF;
END $$;
