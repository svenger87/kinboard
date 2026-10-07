-- migration_pocket_money_best_tier.sql
--
-- The avatar stage now tracks the CURRENT BALANCE instead of
-- lifetime_saved_cents.
--
-- Why the change: lifetime_saved_cents only ever increases, so the stage
-- was a permanent rank that said nothing about how much a kid actually
-- has. Spending a month's savings left the avatar untouched, which made
-- the whole progression meaningless as a savings signal — it measured
-- how long the account had existed, not how well it was doing.
--
-- Why a high-water mark: making the stage fall on spending is only fair
-- if the achievement isn't erased. Saving up and then buying the thing
-- you saved for is the behaviour the feature exists to encourage, and
-- punishing it with a silent demotion teaches the opposite lesson.
-- best_tier records the highest stage ever reached, shown next to the
-- current one as "best ever: Stage N".
--
-- lifetime_saved_cents is deliberately KEPT: it is still the honest
-- answer to "how much has flowed into this account", it is what the
-- backfill below is derived from, and dropping a column that another
-- surface may grow to need is not worth the irreversibility.

-- ONLY BEFORE THE CREATURES MOVED OUT. The stage lives on `creatures` since
-- RFC-017, and a later release drops this column from the account (RFC-017
-- §7 step 5). This file re-runs on every boot, so without the guard a
-- rollback to this release after that drop would put the column back, empty
-- -- or, for best_tier and the trigger, fail and keep the app from starting.
-- `creatures` existing is the marker: it is created and filled from the
-- account columns in one statement (migration_zzzzzzzz_pocket_money_creatures_
-- out.sql), so from then on nothing needs this file to run. A 1.12 install
-- upgrading has no `creatures` yet and still gets the column here, before the
-- creatures are built from it.
DO $$
BEGIN
  IF to_regclass('public.creatures') IS NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pocket_money_accounts'
      AND column_name = 'best_tier'
  ) THEN
    ALTER TABLE public.pocket_money_accounts
      ADD COLUMN best_tier INTEGER NOT NULL DEFAULT 1;

    -- Backfill from lifetime_saved_cents against the NEW thresholds.
    --
    -- Existing kids must not open the app to find their avatar demoted
    -- with nothing to show for the months that earned it. Deriving the
    -- high-water mark from lifetime earnings reconstructs the best stage
    -- they could ever have held. The new thresholds are lower than the
    -- old lifetime-based ones (a balance of a few hundred euro is a lot
    -- for a child; a lifetime total of that is not), so nobody's badge
    -- comes out lower than the stage they had before this migration.
    --
    -- Kept in sync with TIER_THRESHOLDS_CENTS in
    -- webapp/src/lib/pocket-money/types.ts. Two copies is regrettable,
    -- but a one-time backfill can't import TypeScript, and the
    -- alternative (backfilling from the app on first load) would leave
    -- the column wrong for every family that never opens the page.
    --
    -- Installs that already ran this migration keep the value they were
    -- given; the IF NOT EXISTS guard above means it never runs twice.
    -- That's correct — best_tier records the highest stage a child
    -- actually reached, not a figure recomputed whenever the thresholds
    -- are retuned. Rewriting it would erase history to match a new
    -- scale.
    UPDATE public.pocket_money_accounts
    SET best_tier = CASE
      WHEN lifetime_saved_cents >= 20000 THEN 8
      WHEN lifetime_saved_cents >=  8000 THEN 7
      WHEN lifetime_saved_cents >=  3000 THEN 6
      WHEN lifetime_saved_cents >=  1000 THEN 5
      WHEN lifetime_saved_cents >=   400 THEN 4
      WHEN lifetime_saved_cents >=   150 THEN 3
      WHEN lifetime_saved_cents >=    50 THEN 2
      ELSE 1
    END;

    -- last_seen_tier drives the one-off evolution celebration. Align it
    -- with the backfilled badge so the migration itself doesn't fire a
    -- congratulations animation on next open for a stage the kid reached
    -- weeks ago.
    UPDATE public.pocket_money_accounts
    SET last_seen_tier = GREATEST(last_seen_tier, best_tier);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
