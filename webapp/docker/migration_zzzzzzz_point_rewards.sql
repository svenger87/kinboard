-- migration_zzzzzzz_point_rewards.sql
-- Task points instead of euros, for a child whose family wants it
-- (discussion #349).
--
--   pocket_money_accounts.reward_mode   'money' (the default, as before) or
--                                       'points': the avatar grows with the
--                                       task points the child has earned
--   point_rewards                       the family's rewards catalogue
--   point_redemptions                   a child's "Einlösen", waiting for a
--                                       parent, then approved or denied
--
-- WHERE THE MODE LIVES. On the child's pocket-money account. A child is in the
-- plugin exactly when they have an account -- the settings page creates one
-- per child and every pocket-money screen lists accounts, not people -- and an
-- account needs no money: its balance and allowance default to 0, and the
-- allowance and interest jobs skip a zero. The avatar's species, best_tier and
-- last_seen_tier are already on the account, so the mode that decides how the
-- avatar grows sits next to them.
--
-- THE POINTS BALANCE is never stored. It is
--
--   earned  = sum(todo_point_awards.points) for the account's child
--   balance = max(0, earned - sum(cost of APPROVED redemptions))
--
-- computed here (point_account_totals) and mirrored in
-- webapp/src/lib/pocket-money/points.ts. Nothing to keep in step: an award
-- written or taken back by the task triggers moves it at once.
--
-- A SHORTFALL IS PAID BACK FROM LATER POINTS. If a task is un-ticked after
-- its points were spent, earned can drop below spent. The balance shows 0,
-- not a negative number, but the difference is still owed and the next
-- points earned pay it off first: earned 100, spent 60, a 50-point task
-- un-ticked -> earned 50, balance 0, owed 10; the next 10 points earned leave
-- the balance at 0, and only the points after that can be spent.
--
-- APPROVING is one transaction (decide_point_redemption): the child's account
-- row is locked first -- the order a delete of the account cascades in, so
-- the two cannot deadlock -- which queues every other decision for the same
-- child behind this one; then the redemption row, which must still be
-- pending; and only then is the balance read. Two devices approving the same request: one
-- approves, the other is told already_decided. Two requests that together
-- exceed the balance: one approved, the other refused with nothing written.
-- A refusal leaves the request pending -- unlike a withdrawal, which is
-- denied when the money is gone -- because points keep coming in, and the
-- request can be approved once the child has done a few more tasks.
--
-- WHO MAY WRITE. The browser roles read, family-scoped; every write goes
-- through the service role behind a server route: the catalogue and the
-- decisions need the settings PIN (requireSettingsUnlock), a child's request
-- needs a session. EXECUTE on the functions belongs to the service role only.
--
-- Sorts after every other migration, so the tables it reads exist. Safe to run
-- twice; it runs on every boot.

-- ---------------------------------------------------------------------------
-- 1. The mode, and best_tier that only climbs
-- ---------------------------------------------------------------------------
-- ONLY BEFORE THE CREATURES MOVED OUT (RFC-017). The mode and the stages live
-- on `creatures` since then (grows_with, best_tier and its own climbing
-- trigger), and a later release drops reward_mode, best_tier, this trigger and
-- its function from the account (RFC-017 §7 step 5). This file re-runs on
-- every boot: unguarded, a rollback to this release after that drop would put
-- the column back and fail on the trigger for a column that is gone, and the
-- app would not start. `creatures` existing is the marker -- it is created and
-- filled from these columns in one statement -- so a 1.12 install upgrading
-- still gets them here, before the creatures are built from them.
DO $guard$
BEGIN
  IF to_regclass('public.creatures') IS NOT NULL THEN RETURN; END IF;

  ALTER TABLE public.pocket_money_accounts
    ADD COLUMN IF NOT EXISTS reward_mode TEXT NOT NULL DEFAULT 'money';

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pocket_money_accounts_reward_mode_check') THEN
    ALTER TABLE public.pocket_money_accounts
      ADD CONSTRAINT pocket_money_accounts_reward_mode_check CHECK (reward_mode IN ('money', 'points'));
  END IF;

  -- best_tier is the highest stage a child ever reached WITH MONEY. The screens
  -- write it (the stage is derived from what they show), so until now a write
  -- could also lower it, or raise it past the last stage. A stage reached with
  -- money must survive a switch to points and back, so the database keeps the
  -- higher of the two -- and never more than stage 8, the last one
  -- (TIER_THRESHOLDS_* in webapp/src/lib/pocket-money/types.ts). In points mode
  -- the stage comes from the points earned and is never written here, so a
  -- task un-ticked takes the stage back down with it.
  CREATE OR REPLACE FUNCTION public.pocket_money_best_tier_only_climbs() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
  BEGIN
    NEW.best_tier := LEAST(8, GREATEST(LEAST(8, COALESCE(OLD.best_tier, 1)), COALESCE(NEW.best_tier, 1), 1));
    RETURN NEW;
  END $fn$;

  DROP TRIGGER IF EXISTS pocket_money_accounts_best_tier_climbs ON public.pocket_money_accounts;
  CREATE TRIGGER pocket_money_accounts_best_tier_climbs
    BEFORE UPDATE OF best_tier ON public.pocket_money_accounts
    FOR EACH ROW EXECUTE FUNCTION public.pocket_money_best_tier_only_climbs();

  -- Any value already out of range is brought back into it (the trigger above
  -- clamps a stored 99 to 8), and then a CHECK holds every row to 1..8,
  -- including a new account's.
  UPDATE public.pocket_money_accounts SET best_tier = best_tier WHERE best_tier NOT BETWEEN 1 AND 8;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pocket_money_accounts_best_tier_range') THEN
    ALTER TABLE public.pocket_money_accounts
      ADD CONSTRAINT pocket_money_accounts_best_tier_range CHECK (best_tier BETWEEN 1 AND 8);
  END IF;
END $guard$;

-- ---------------------------------------------------------------------------
-- 2. The tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.point_rewards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  cost_points INTEGER NOT NULL CHECK (cost_points BETWEEN 1 AND 10000),
  icon TEXT CHECK (icon IS NULL OR char_length(icon) BETWEEN 1 AND 16),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS point_rewards_family_idx ON public.point_rewards (family_id);

DROP TRIGGER IF EXISTS point_rewards_set_updated_at ON public.point_rewards;
CREATE TRIGGER point_rewards_set_updated_at
  BEFORE UPDATE ON public.point_rewards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- A redemption keeps the reward's title, icon and cost as they were when the
-- child asked: a parent editing the catalogue later changes neither what is
-- waiting nor what was spent.
CREATE TABLE IF NOT EXISTS public.point_redemptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.pocket_money_accounts(id) ON DELETE CASCADE,
  reward_id UUID REFERENCES public.point_rewards(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  icon TEXT,
  cost_points INTEGER NOT NULL CHECK (cost_points BETWEEN 1 AND 10000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  requested_by_device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decided_by_device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS point_redemptions_account_status_idx ON public.point_redemptions (account_id, status);
CREATE INDEX IF NOT EXISTS point_redemptions_family_idx ON public.point_redemptions (family_id);
CREATE INDEX IF NOT EXISTS point_redemptions_reward_idx ON public.point_redemptions (reward_id) WHERE reward_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS point_redemptions_requested_by_idx ON public.point_redemptions (requested_by_device_id) WHERE requested_by_device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS point_redemptions_decided_by_idx ON public.point_redemptions (decided_by_device_id) WHERE decided_by_device_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Read-only to the browser, family-scoped
-- ---------------------------------------------------------------------------
ALTER TABLE public.point_rewards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS point_rewards_family_read ON public.point_rewards;
CREATE POLICY point_rewards_family_read ON public.point_rewards
  FOR SELECT USING (family_id = public.current_family_id());

ALTER TABLE public.point_redemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS point_redemptions_family_read ON public.point_redemptions;
CREATE POLICY point_redemptions_family_read ON public.point_redemptions
  FOR SELECT USING (family_id = public.current_family_id());

-- REVOKE ALL also takes TRUNCATE, which migration_zzzz_revoke_truncate.sql
-- would otherwise only catch on the boot after this table was created.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.point_rewards FROM anon;
    REVOKE ALL ON TABLE public.point_redemptions FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.point_rewards FROM authenticated;
    REVOKE ALL ON TABLE public.point_redemptions FROM authenticated;
    GRANT SELECT ON TABLE public.point_rewards TO authenticated;
    GRANT SELECT ON TABLE public.point_redemptions TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.point_rewards TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.point_redemptions TO service_role;
  END IF;
END $$;

-- A request or a decision on one screen shows on the others: the child sees
-- "approved" arrive, the parent's inbox sees the request. The realtime
-- container reads the publication only when it starts, so it must be
-- restarted after this runs for the first time.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'point_rewards') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.point_rewards;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'point_redemptions') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.point_redemptions;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. The balance, a request, a decision
-- ---------------------------------------------------------------------------

-- An account's points: earned, spent (approved), waiting (pending) and the
-- balance, max(0, earned - spent). Mirrored by pointsBalance() in
-- webapp/src/lib/pocket-money/points.ts. NULL when there is no such account
-- in the family.
CREATE OR REPLACE FUNCTION public.point_account_totals(p_family_id UUID, p_account_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_person UUID;
  v_earned BIGINT;
  v_spent BIGINT;
  v_pending BIGINT;
BEGIN
  SELECT person_id INTO v_person FROM public.pocket_money_accounts
   WHERE id = p_account_id AND family_id = p_family_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(sum(points), 0) INTO v_earned FROM public.todo_point_awards
   WHERE person_id = v_person AND family_id = p_family_id;
  SELECT COALESCE(sum(cost_points) FILTER (WHERE status = 'approved'), 0),
         COALESCE(sum(cost_points) FILTER (WHERE status = 'pending'), 0)
    INTO v_spent, v_pending
    FROM public.point_redemptions WHERE account_id = p_account_id;
  RETURN jsonb_build_object(
    'earned', v_earned, 'spent', v_spent, 'pending', v_pending,
    'balance', GREATEST(0, v_earned - v_spent),
    'owed', GREATEST(0, v_spent - v_earned));
END $$;

-- A child asks for a reward. The account is locked so two requests from one
-- child are served in turn; a request is refused when the balance, less what
-- is already waiting, does not cover it. Answers:
--   { ok: true, redemption: {...} }
--   { ok: false, error: 'not_found' }         no such account in this family
--   { ok: false, error: 'not_points_mode' }   the child's avatar grows with money
--   { ok: false, error: 'no_reward' }         no such active reward in this family
--   { ok: false, error: 'insufficient_points', balance, pending }
CREATE OR REPLACE FUNCTION public.request_point_redemption(
  p_family_id UUID, p_account_id UUID, p_reward_id UUID, p_device_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_mode TEXT;
  v_reward public.point_rewards;
  v_totals JSONB;
  v_row public.point_redemptions;
BEGIN
  SELECT reward_mode INTO v_mode FROM public.pocket_money_accounts
   WHERE id = p_account_id AND family_id = p_family_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF v_mode <> 'points' THEN RETURN jsonb_build_object('ok', false, 'error', 'not_points_mode'); END IF;

  SELECT * INTO v_reward FROM public.point_rewards
   WHERE id = p_reward_id AND family_id = p_family_id AND active;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'no_reward'); END IF;

  v_totals := public.point_account_totals(p_family_id, p_account_id);
  IF (v_totals->>'balance')::BIGINT - (v_totals->>'pending')::BIGINT < v_reward.cost_points THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_points',
      'balance', v_totals->'balance', 'pending', v_totals->'pending');
  END IF;

  INSERT INTO public.point_redemptions
    (family_id, account_id, reward_id, title, icon, cost_points, requested_by_device_id)
  VALUES
    (p_family_id, p_account_id, v_reward.id, v_reward.title, v_reward.icon, v_reward.cost_points,
     (SELECT id FROM public.devices WHERE id = p_device_id AND family_id = p_family_id))
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', true, 'redemption', to_jsonb(v_row));
END $$;

-- A parent decides. Answers:
--   { ok: true, status: 'approved', balance } | { ok: true, status: 'denied' }
--   { ok: false, error: 'not_found' }                 no such redemption in this family
--   { ok: false, error: 'already_decided', status }   nothing changed
--   { ok: false, error: 'insufficient_points', balance }  nothing changed, still pending
--   { ok: false, error: 'not_points_mode' }   approving only: the child's avatar
--       grows with money now; nothing changed, the request stays pending so a
--       parent can deny it or switch the child back. Denying always works.
CREATE OR REPLACE FUNCTION public.decide_point_redemption(
  p_family_id UUID, p_redemption_id UUID, p_decision TEXT, p_device_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_req public.point_redemptions;
  v_mode TEXT;
  v_device UUID;
  v_totals JSONB;
  v_balance BIGINT;
BEGIN
  IF p_decision NOT IN ('approved', 'denied') THEN
    RAISE EXCEPTION 'decision must be approved or denied' USING ERRCODE = '22023';
  END IF;

  -- The account first, then the request: the order a delete of the account
  -- cascades in, so the two cannot deadlock. Every decision for this child
  -- queues here, so the balance read below already counts any approval that
  -- went before.
  SELECT a.reward_mode INTO v_mode
    FROM public.pocket_money_accounts a
    JOIN public.point_redemptions r ON r.account_id = a.id
   WHERE r.id = p_redemption_id AND r.family_id = p_family_id
     FOR UPDATE OF a;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;

  SELECT * INTO v_req FROM public.point_redemptions
   WHERE id = p_redemption_id AND family_id = p_family_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_decided', 'status', v_req.status);
  END IF;

  -- A device of another family, or one removed since, is recorded as nobody.
  SELECT id INTO v_device FROM public.devices WHERE id = p_device_id AND family_id = p_family_id;

  IF p_decision = 'denied' THEN
    UPDATE public.point_redemptions
       SET status = 'denied', decided_at = now(), decided_by_device_id = v_device
     WHERE id = p_redemption_id;
    RETURN jsonb_build_object('ok', true, 'status', 'denied');
  END IF;

  IF v_mode <> 'points' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_points_mode');
  END IF;

  v_totals := public.point_account_totals(p_family_id, v_req.account_id);
  v_balance := (v_totals->>'balance')::BIGINT;
  IF v_totals IS NULL OR v_balance < v_req.cost_points THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_points', 'balance', COALESCE(v_balance, 0));
  END IF;

  UPDATE public.point_redemptions
     SET status = 'approved', decided_at = now(), decided_by_device_id = v_device
   WHERE id = p_redemption_id;
  RETURN jsonb_build_object('ok', true, 'status', 'approved', 'balance', v_balance - v_req.cost_points);
END $$;

DO $$
DECLARE
  fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.point_account_totals(UUID, UUID)',
    'public.request_point_redemption(UUID, UUID, UUID, UUID)',
    'public.decide_point_redemption(UUID, UUID, TEXT, UUID)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
