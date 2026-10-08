-- migration_zzzzzzz_pocket_money_realtime.sql — pocket money reaches
-- every screen as it changes.
--
-- Since every pocket-money write moved to the server (#361), the screen that
-- starts a booking is often not the one that writes it: an assistant asks, a
-- parent allows it on the wall display, the server books it. None of the
-- pocket_money_* tables was in the supabase_realtime publication, so a phone
-- showing the child's balance kept the old figure until it refetched on its
-- own, and the parent took it for a booking that had not happened.
--
-- Published here:
--   pocket_money_accounts             the balance, allowance, interest
--   pocket_money_transactions         the ledger
--   pocket_money_goals                a goal confirmed or reached
--   pocket_money_withdrawal_requests  a spend request asked for or decided
-- The rewards side (point_rewards, point_redemptions, point_purchases,
-- creatures) is already published by its own migrations.
--
-- Publishing grants nothing. Realtime reads each change as the subscriber's
-- own role and applies the tables' row-level security, which is family-scoped
-- on all four (migration_zz_row_level_security.sql); the browser roles keep
-- the SELECT they already had and nothing else
-- (migration_zzzzzzzz_pocket_money_server_only.sql).
--
-- Realtime reads the publication when it starts. A running realtime container
-- does not stream these tables until it is restarted:
--   docker restart kinboard-realtime
--
-- Safe on every boot, and twice at once: an advisory lock serialises
-- concurrent runs, each table is added only while it exists and is not yet
-- published, and a table published by a run that got there first is not an
-- error. Sorts after migration_pocket_money.sql, which creates the tables,
-- and before migration_zzzzzzzz_pocket_money_server_only.sql, whose revoke
-- must stay the last migration to name a pocket_money_* table
-- (e2e/pocket-money-grants.spec.ts) -- in byte order and under an en_US
-- collation alike. The order does not matter to realtime: it reads the
-- publication when it starts, after every migration has run.

SELECT pg_advisory_lock(hashtextextended('migration_zzzzzzz_pocket_money_realtime', 0));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND to_regclass('public.pocket_money_accounts') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pocket_money_accounts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pocket_money_accounts;
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- published meanwhile by a run that got there first
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND to_regclass('public.pocket_money_transactions') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pocket_money_transactions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pocket_money_transactions;
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- published meanwhile by a run that got there first
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND to_regclass('public.pocket_money_goals') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pocket_money_goals') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pocket_money_goals;
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- published meanwhile by a run that got there first
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND to_regclass('public.pocket_money_withdrawal_requests') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pocket_money_withdrawal_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pocket_money_withdrawal_requests;
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- published meanwhile by a run that got there first
END $$;

SELECT pg_advisory_unlock(hashtextextended('migration_zzzzzzz_pocket_money_realtime', 0));
