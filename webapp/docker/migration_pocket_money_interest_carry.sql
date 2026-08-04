-- migration_pocket_money_interest_carry.sql
--
-- Interest never accrued for any realistic child's balance.
--
-- Daily accrual was `floor(balance × apr_bps / 10000 / 365)`, in whole
-- cents, with the fraction discarded every single day. At the default 10%
-- APR the daily amount only reaches one cent at a balance of €36.50 — so
-- an account holding €5, €10 or €30 earned exactly nothing, permanently,
-- while the settings screen advertised "10.0%" and the forecast drew a
-- line that never moved.
--
-- The flooring cost the larger balances too, because it rounded down
-- every day rather than once:
--
--   €50  at 10%  ->  floor(1.37) = 1 cent/day  ->  €3.65/year, not €5
--   €100 at 10%  ->  floor(2.74) = 2 cents/day ->  €7.30/year, not €10
--
-- Roughly a quarter of the interest disappeared into rounding.
--
-- The fix is to keep the fraction instead of throwing it away. This adds
-- a carry column holding sub-cent interest in millionths of a cent; each
-- day's exact accrual goes in, and whole cents overflow out into
-- pending_interest_cents as they accumulate. A €5 balance now earns its
-- first cent after about eight days instead of never.
--
-- Micros rather than a NUMERIC column: the rest of this schema is
-- integer cents on purpose, and mixing in floating-point money invites
-- exactly the rounding drift this migration exists to remove. BIGINT
-- because a year of accrual on a large balance comfortably exceeds the
-- INTEGER range once scaled by a million.
--
-- Existing accounts start at 0, which is correct — there is no history
-- to reconstruct, since the discarded fractions were never recorded
-- anywhere. Nobody is owed back-interest; they simply start earning it.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pocket_money_accounts'
      AND column_name = 'pending_interest_micros'
  ) THEN
    ALTER TABLE public.pocket_money_accounts
      ADD COLUMN pending_interest_micros BIGINT NOT NULL DEFAULT 0;

    COMMENT ON COLUMN public.pocket_money_accounts.pending_interest_micros IS
      'Sub-cent interest carry, in millionths of a cent. Daily accrual adds '
      'the exact amount here; whole cents overflow into '
      'pending_interest_cents. Without this the daily floor discarded the '
      'fraction and balances under ~EUR 36.50 never earned anything.';
  END IF;
END $$;
