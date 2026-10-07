-- migration_zzzzzzzz_pocket_money_creatures_out_zz_drop.sql
-- The old creature columns leave pocket_money_accounts (RFC-017 §7 step 5).
--
-- Since 1.13 a child's creature lives in `creatures`
-- (migration_zzzzzzzz_pocket_money_creatures_out.sql), and nothing reads or
-- writes these any more:
--
--   pocket_money_accounts.avatar_species, avatar_style, avatar_look,
--     best_tier, last_seen_tier, reward_mode     and their CHECKs
--   pocket_money_accounts_best_tier_climbs      the trigger keeping best_tier
--   pocket_money_best_tier_only_climbs()          climbing, and its function
--   point_account_totals(), request_point_redemption()
--                                                 the account-keyed wrappers
--                                                 kept for one release
--   creatures_from_accounts()                     the backfill rule as a
--                                                 function; the backfill is
--                                                 inline in creatures_out now,
--                                                 and an old backup's import
--                                                 derives its creatures in
--                                                 TypeScript
--
-- What it does NOT drop: point_redemptions.account_id and the
-- point_redemptions_fill_keys trigger. They are not creature data, and
-- dropping them is a separate decision.
--
-- A ROLLBACK to rc.13 is not possible after this has run: rc.13 reads these
-- columns. That is why it ships a release after 1.13.0, which kept them. A
-- rollback to a 1.13 whose migrations add the columns without the guard (see
-- THE MIGRATIONS THAT ADD THESE COLUMNS below)
-- does not start either: its migration_pocket_money_best_tier.sql and
-- migration_zzzzzzz_point_rewards.sql fail on the missing columns on every
-- boot, and the entrypoint refuses to start on a failed migration.
--
-- ONLY ONCE THE CREATURES EXIST. A 1.12 install upgrading straight to this
-- release builds its creatures from these columns in creatures_out, which
-- sorts before this file, in the same statement that creates `creatures`. So
-- `creatures` existing means the columns have been read; until it does --
-- creatures_out failed on this boot, say -- nothing is dropped, and the next
-- boot tries again with the data still there.
--
-- THE MIGRATIONS THAT ADD THESE COLUMNS (migration_pocket_money_best_tier.sql,
-- migration_zzzzzzz_point_rewards.sql section 1,
-- migration_zzzzzzzz_pocket_money_avatar_style*.sql) re-run on every boot and
-- skip once `creatures` exists, so the columns stay gone.
-- e2e/creatures-drop-account-columns.spec.ts holds every migration to that.
-- migration_pocket_money.sql still creates the table with avatar_species and
-- last_seen_tier on a fresh install -- before `creatures` exists -- and this
-- file drops them a few files later.
--
-- THE NAME sorts it right after creatures_out both in byte order ('.' before
-- '_'), which the entrypoint and the specs use, and in a locale-aware shell
-- glob (en_US ignores the punctuation, so a plain "_drop" would come first
-- there: "outdrop" < "outsql"; "outzzdrop" does not). The guard above makes
-- the order a matter of when, not whether: run first, it skips and the next
-- boot drops. And before
-- migration_zzzzzzzz_pocket_money_server_only.sql, which must sort after every
-- migration that names a pocket_money_* table (e2e/pocket-money-grants.spec.ts).
--
-- Safe to run twice, and twice at once: it takes creatures_out's own session
-- lock, so it never runs alongside that file's backfill, and every step is
-- IF EXISTS. The ALTER TABLE runs only while one of the columns is still
-- there, so a boot after the drop takes no lock on the table at all.

SELECT pg_advisory_lock(hashtextextended('migration_zzzzzzzz_pocket_money_creatures_out', 0));

DO $$
BEGIN
  IF to_regclass('public.creatures') IS NULL THEN
    RAISE NOTICE 'no creatures table yet: keeping the old account columns for its backfill';
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS pocket_money_accounts_best_tier_climbs ON public.pocket_money_accounts;
  DROP FUNCTION IF EXISTS public.pocket_money_best_tier_only_climbs();

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'pocket_money_accounts'
       AND column_name IN ('avatar_species', 'avatar_style', 'avatar_look',
                           'best_tier', 'last_seen_tier', 'reward_mode')
  ) THEN
    ALTER TABLE public.pocket_money_accounts
      DROP CONSTRAINT IF EXISTS pocket_money_accounts_reward_mode_check,
      DROP CONSTRAINT IF EXISTS pocket_money_accounts_best_tier_range,
      DROP CONSTRAINT IF EXISTS pocket_money_accounts_avatar_style_check,
      DROP CONSTRAINT IF EXISTS pocket_money_accounts_avatar_look_check,
      DROP COLUMN IF EXISTS avatar_species,
      DROP COLUMN IF EXISTS avatar_style,
      DROP COLUMN IF EXISTS avatar_look,
      DROP COLUMN IF EXISTS best_tier,
      DROP COLUMN IF EXISTS last_seen_tier,
      DROP COLUMN IF EXISTS reward_mode;
  END IF;

  DROP FUNCTION IF EXISTS public.point_account_totals(UUID, UUID);
  DROP FUNCTION IF EXISTS public.request_point_redemption(UUID, UUID, UUID, UUID);
  DROP FUNCTION IF EXISTS public.creatures_from_accounts(UUID);
END $$;

SELECT pg_advisory_unlock(hashtextextended('migration_zzzzzzzz_pocket_money_creatures_out', 0));

NOTIFY pgrst, 'reload schema';
