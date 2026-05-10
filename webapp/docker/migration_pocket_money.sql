-- migration_pocket_money.sql
-- Creates the four tables for the Pocket Money plugin (Piggy):
--   pocket_money_accounts          one row per kid; balance + interest config + avatar state
--   pocket_money_transactions      immutable signed log of all cash movements
--   pocket_money_goals             saving goals; one is_primary at a time per account
--   pocket_money_withdrawal_requests  kid-proposed withdrawals + parent-approval queue
--
-- All cascade on family/account deletion. Idempotent: re-running on a
-- migrated stack is a no-op.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'pocket_money_accounts'
  ) THEN
    CREATE TABLE public.pocket_money_accounts (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
      person_id UUID NOT NULL UNIQUE REFERENCES public.people(id) ON DELETE CASCADE,
      currency TEXT NOT NULL DEFAULT 'EUR',
      balance_cents INTEGER NOT NULL DEFAULT 0,
      apr_bps INTEGER NOT NULL DEFAULT 1000,
      weekly_allowance_cents INTEGER NOT NULL DEFAULT 0,
      allowance_day_of_week INTEGER NOT NULL DEFAULT 0,
      max_balance_eligible_cents INTEGER NOT NULL DEFAULT 50000,
      pending_interest_cents INTEGER NOT NULL DEFAULT 0,
      interest_committed_day_of_week INTEGER NOT NULL DEFAULT 0,
      last_accrued_date DATE,
      last_allowance_at TIMESTAMPTZ,
      interest_committed_at TIMESTAMPTZ,
      avatar_species TEXT NOT NULL DEFAULT 'dragon'
        CHECK (avatar_species IN ('dragon', 'cat', 'astronaut')),
      lifetime_saved_cents INTEGER NOT NULL DEFAULT 0,
      last_seen_tier INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX pocket_money_accounts_family_id_idx
      ON public.pocket_money_accounts (family_id);

    CREATE TRIGGER pocket_money_accounts_set_updated_at
      BEFORE UPDATE ON public.pocket_money_accounts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;

  -- goals before transactions: transactions has an FK on related_goal_id.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'pocket_money_goals'
  ) THEN
    CREATE TABLE public.pocket_money_goals (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      account_id UUID NOT NULL REFERENCES public.pocket_money_accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      target_amount_cents INTEGER NOT NULL CHECK (target_amount_cents > 0),
      image_url TEXT,
      image_source TEXT NOT NULL DEFAULT 'url'
        CHECK (image_source IN ('catalog','upload','url')),
      position INTEGER NOT NULL DEFAULT 0,
      is_primary BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','ready_to_buy','bought','abandoned')),
      target_reached_at TIMESTAMPTZ,
      parent_confirmed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX pocket_money_goals_one_primary_idx
      ON public.pocket_money_goals (account_id)
      WHERE is_primary AND status = 'active';

    CREATE INDEX pocket_money_goals_account_position_idx
      ON public.pocket_money_goals (account_id, position);

    CREATE TRIGGER pocket_money_goals_set_updated_at
      BEFORE UPDATE ON public.pocket_money_goals
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'pocket_money_transactions'
  ) THEN
    CREATE TABLE public.pocket_money_transactions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      account_id UUID NOT NULL REFERENCES public.pocket_money_accounts(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL,
      type TEXT NOT NULL
        CHECK (type IN ('allowance','manual_deposit','interest','withdrawal','adjustment')),
      note TEXT,
      related_goal_id UUID REFERENCES public.pocket_money_goals(id) ON DELETE SET NULL,
      created_by_person_id UUID REFERENCES public.people(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX pocket_money_transactions_account_created_idx
      ON public.pocket_money_transactions (account_id, created_at DESC);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'pocket_money_withdrawal_requests'
  ) THEN
    CREATE TABLE public.pocket_money_withdrawal_requests (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      account_id UUID NOT NULL REFERENCES public.pocket_money_accounts(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','denied')),
      parent_decided_at TIMESTAMPTZ,
      parent_decided_by_person_id UUID REFERENCES public.people(id) ON DELETE SET NULL,
      related_goal_id UUID REFERENCES public.pocket_money_goals(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX pocket_money_withdrawal_requests_account_status_idx
      ON public.pocket_money_withdrawal_requests (account_id, status);
  END IF;
END $$;

-- Backfill the FK on transactions.related_goal_id for stacks that ran
-- an earlier version of this migration before the goals/transactions
-- create-order was fixed and the FK was added. Idempotent: skips if
-- the constraint already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pocket_money_transactions_related_goal_id_fkey'
  ) THEN
    ALTER TABLE public.pocket_money_transactions
      ADD CONSTRAINT pocket_money_transactions_related_goal_id_fkey
      FOREIGN KEY (related_goal_id)
      REFERENCES public.pocket_money_goals(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Configurable allowance cadence — 7 (weekly), 14 (biweekly), 28 (every
-- 4 weeks), or any integer. The cron's "already paid this period" guard
-- uses (interval - 1) days as its threshold. Idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pocket_money_accounts'
      AND column_name = 'allowance_interval_days'
  ) THEN
    ALTER TABLE public.pocket_money_accounts
      ADD COLUMN allowance_interval_days INTEGER NOT NULL DEFAULT 7
      CHECK (allowance_interval_days >= 1 AND allowance_interval_days <= 365);
  END IF;
END $$;

-- Public bucket for kid-uploaded goal images. Idempotent.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'goal-images',
  'goal-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
) ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read goal images" ON storage.objects;
CREATE POLICY "Public read goal images" ON storage.objects
  FOR SELECT USING (bucket_id = 'goal-images');

DROP POLICY IF EXISTS "Upload goal images" ON storage.objects;
CREATE POLICY "Upload goal images" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'goal-images');

DROP POLICY IF EXISTS "Update goal images" ON storage.objects;
CREATE POLICY "Update goal images" ON storage.objects
  FOR UPDATE USING (bucket_id = 'goal-images');

DROP POLICY IF EXISTS "Delete goal images" ON storage.objects;
CREATE POLICY "Delete goal images" ON storage.objects
  FOR DELETE USING (bucket_id = 'goal-images');

NOTIFY pgrst, 'reload schema';
