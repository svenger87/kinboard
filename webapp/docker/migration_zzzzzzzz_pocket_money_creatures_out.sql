-- migration_zzzzzzzz_pocket_money_creatures_out.sql
-- Creatures and point rewards move out of the pocket-money plugin (RFC-017,
-- step 1: the data move).
--
--   creatures                    one row per child that has a creature: the
--                                species, style, look and stage that lived on
--                                pocket_money_accounts, and what it grows with
--   point_redemptions.person_id  a child's reward requests belong to the
--                                child, not to their pocket-money account
--   point_person_totals()        a child's points, per person: no account needed
--
-- THE NAME. Despite moving data *out* of pocket money, this file has to sort
-- after migration_zzzzzzzz_pocket_money_avatar_style_look.sql (it copies
-- avatar_style and avatar_look, which only exist from there on) and before
-- migration_zzzzzzzz_pocket_money_server_only.sql (#361), which must sort
-- after every migration that names a pocket_money_* table
-- (e2e/pocket-money-grants.spec.ts). "pocket_money_creatures_out" is the name
-- that lands between the two.
--
-- WHO MAY WRITE. As #361: the browser roles read, family-scoped, and write
-- nothing. Every write is a server route on the service role: /api/creatures
-- (switching a creature on or off, the species, what it grows with and the
-- shop need the settings PIN; the style, the look and the stage the child's
-- own screen records do not), and /api/rewards (the catalogue and decisions
-- need the PIN; a child's request does not). EXECUTE on the functions belongs
-- to the service role only.
--
-- ROLLBACK TO rc.13 must keep working. What keeps it working is what this
-- file leaves in the tables, not the functions: rc.13 re-runs its own
-- migration_zzzzzzz_point_rewards.sql on boot, which puts back its own
-- point_account_totals(), request_point_redemption() and
-- decide_point_redemption() over the ones defined here. So:
--   * point_redemptions.account_id stays, nullable now, and the
--     point_redemptions_fill_keys trigger -- which rc.13 knows nothing about
--     and leaves in place -- fills it from the child's account on every insert,
--     and fills person_id from account_id. rc.13's functions insert with only
--     account_id and read per account: the new NOT NULL never refuses them,
--     and their sums still see the rows written here.
--   * the account columns (avatar_species, avatar_style, avatar_look,
--     best_tier, last_seen_tier, reward_mode) stay, with their CHECKs and the
--     best_tier trigger. The app no longer writes them, so rc.13 finds them as
--     they were on the day of the upgrade, which is a valid creature.
-- What a rollback loses: anything rc.13 writes to those columns while it
-- runs (a new account, a mode or style change) stays on the account, and the
-- creature does not pick it up on the next upgrade -- the backfill below runs
-- only when the table is created.
-- A later release drops the old columns, the wrappers and the trigger
-- (RFC-017 §7 step 5).
--
-- Safe to run twice, and twice at once: the webapp entrypoint and
-- `./start.sh migrate` can apply the same file concurrently. The session
-- advisory lock right below serialises two runs of this file -- the second
-- waits, then finds everything done -- and it is released when psql ends,
-- also when a statement fails under ON_ERROR_STOP.
--
-- The backfill runs exactly once,
-- in the same statement that creates the table: after that a new
-- pocket-money account does NOT get a creature by itself -- a parent switches
-- one on (RFC-017 §2.1) -- so re-running the backfill on every boot would be
-- wrong, not merely redundant.

SELECT pg_advisory_lock(hashtextextended('migration_zzzzzzzz_pocket_money_creatures_out', 0));

-- ---------------------------------------------------------------------------
-- 1. creatures
-- ---------------------------------------------------------------------------

-- A creature for every CHILD's pocket-money account that has none
-- (RFC-017 §3.3):
--
--   the account's species, style, look, best_tier and last_seen_tier,
--   the shop on,
--   grows_with = 'points' where reward_mode = 'points', else 'money', and
--   enabled = whether the family has the pocket-money plugin on.
--
-- §3.3 names the accounts that get one -- a drawn style, a look, a species
-- other than the dragon, points mode -- and then the classic dragons on
-- accounts that never touched any of it, "since they have one today". That is
-- every child's account: every child in the plugin sees a creature on rc.13.
-- A child with no account has none, and gets none; nor does a grown-up with
-- an account (people.is_child false), who never had a creature on screen.
--
-- `enabled` follows the plugin because on rc.13 the creature showed only with
-- pocket money on (the profile checked it too). A family that turned pocket
-- money off sees no creature appear; it is kept, switched off, for a parent to
-- switch on under Settings -> Creatures & rewards. The plugin is on unless the
-- family's enabled_plugins setting says false, as in the app.
--
-- Used by the one-time backfill below and by /api/import for a backup made
-- before this table existed, so both derive creatures by the same rule.
-- p_family_id NULL means every family. Only where the child has no creature
-- yet: one that exists -- switched off, re-styled, moved to points -- is never
-- touched. There is deliberately no ON CONFLICT: the NOT EXISTS is the rule,
-- and a broken one fails loudly on the primary key instead of passing.
CREATE OR REPLACE FUNCTION public.creatures_from_accounts(p_family_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  n INTEGER;
BEGIN
  IF to_regclass('public.creatures') IS NULL THEN RETURN 0; END IF;
  INSERT INTO public.creatures
    (person_id, family_id, species, style, look, best_tier, last_seen_tier, grows_with, shop_enabled, enabled)
  SELECT a.person_id, a.family_id,
         COALESCE(a.avatar_species, 'dragon'),
         COALESCE(a.avatar_style, 'classic'),
         CASE WHEN jsonb_typeof(a.avatar_look) = 'object' THEN a.avatar_look ELSE '{}'::jsonb END,
         LEAST(8, GREATEST(1, COALESCE(a.best_tier, 1))),
         LEAST(8, GREATEST(1, COALESCE(a.last_seen_tier, 1))),
         CASE WHEN a.reward_mode = 'points' THEN 'points' ELSE 'money' END,
         true,
         NOT EXISTS (SELECT 1 FROM public.settings s
                      WHERE s.family_id = a.family_id AND s.key = 'enabled_plugins'
                        AND s.value -> 'pocket-money' = 'false'::jsonb)
    FROM public.pocket_money_accounts a
    JOIN public.people p ON p.id = a.person_id AND p.family_id = a.family_id AND p.is_child
   WHERE (p_family_id IS NULL OR a.family_id = p_family_id)
     AND NOT EXISTS (SELECT 1 FROM public.creatures c WHERE c.person_id = a.person_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

DO $$
BEGIN
  IF to_regclass('public.creatures') IS NULL THEN
    CREATE TABLE public.creatures (
      person_id UUID PRIMARY KEY REFERENCES public.people(id) ON DELETE CASCADE,
      family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
      species TEXT NOT NULL DEFAULT 'dragon',
      style TEXT NOT NULL DEFAULT 'classic'
        CONSTRAINT creatures_style_check CHECK (style IN ('classic', 'gumdrop', 'sticker', 'storybook')),
      look JSONB NOT NULL DEFAULT '{}'::jsonb
        CONSTRAINT creatures_look_check CHECK (jsonb_typeof(look) = 'object'),
      best_tier INTEGER NOT NULL DEFAULT 1
        CONSTRAINT creatures_best_tier_range CHECK (best_tier BETWEEN 1 AND 8),
      last_seen_tier INTEGER NOT NULL DEFAULT 1
        CONSTRAINT creatures_last_seen_tier_range CHECK (last_seen_tier BETWEEN 1 AND 8),
      grows_with TEXT NOT NULL DEFAULT 'points'
        CONSTRAINT creatures_grows_with_check CHECK (grows_with IN ('points', 'money')),
      shop_enabled BOOLEAN NOT NULL DEFAULT true,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- In the statement that created the table, so it runs once and only once:
    -- a crash before this line leaves no table, and the next boot does both.
    PERFORM public.creatures_from_accounts(NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS creatures_family_idx ON public.creatures (family_id);

DROP TRIGGER IF EXISTS creatures_set_updated_at ON public.creatures;
CREATE TRIGGER creatures_set_updated_at
  BEFORE UPDATE ON public.creatures
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- best_tier is the highest stage a child reached growing with money. It only
-- climbs, and never past stage 8, as on the account
-- (migration_zzzzzzz_point_rewards.sql): a stage reached with money survives a
-- switch to points and back. The screens write it; the database keeps the
-- higher of the old and the new.
CREATE OR REPLACE FUNCTION public.creatures_best_tier_only_climbs() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.best_tier := LEAST(8, GREATEST(LEAST(8, COALESCE(OLD.best_tier, 1)), COALESCE(NEW.best_tier, 1), 1));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS creatures_best_tier_climbs ON public.creatures;
CREATE TRIGGER creatures_best_tier_climbs
  BEFORE UPDATE OF best_tier ON public.creatures
  FOR EACH ROW EXECUTE FUNCTION public.creatures_best_tier_only_climbs();

-- Read-only to the browser, family-scoped. A creature whose child sits in the
-- recycle bin is hidden with them, and comes back with a restore. Written as
-- "the child is there", not "the child is not binned": the subquery runs
-- under the people table's own row-level security, which already hides a
-- binned person, so a NOT EXISTS over binned people would never find one.
ALTER TABLE public.creatures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS creatures_family_read ON public.creatures;
CREATE POLICY creatures_family_read ON public.creatures
  FOR SELECT USING (family_id = public.current_family_id() AND EXISTS (
    SELECT 1 FROM public.people p WHERE p.id = creatures.person_id AND p.deleted_at IS NULL));

-- REVOKE ALL takes TRUNCATE too.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.creatures FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.creatures FROM authenticated;
    GRANT SELECT ON TABLE public.creatures TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.creatures TO service_role;
  END IF;
END $$;

-- A creature switched on, re-dressed or grown on one screen shows on the
-- others. The realtime container reads the publication only when it starts:
-- restart it after this runs for the first time.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'creatures') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.creatures;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. point_redemptions: from the account to the person
-- ---------------------------------------------------------------------------
ALTER TABLE public.point_redemptions
  ADD COLUMN IF NOT EXISTS person_id UUID REFERENCES public.people(id) ON DELETE CASCADE;

-- The two keys kept in step for one release: a row written with only the
-- account (rc.13, after a rollback) gets its person; a row written with only
-- the person gets the child's account when there is one, so rc.13's
-- per-account sums still see it. Created before the backfill and the NOT NULL
-- below, so an rc.13 insert that lands while this file runs is filled in
-- rather than refused.
CREATE OR REPLACE FUNCTION public.point_redemptions_fill_keys() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.person_id IS NULL AND NEW.account_id IS NOT NULL THEN
    SELECT person_id INTO NEW.person_id FROM public.pocket_money_accounts WHERE id = NEW.account_id;
  END IF;
  IF NEW.account_id IS NULL AND NEW.person_id IS NOT NULL THEN
    SELECT id INTO NEW.account_id FROM public.pocket_money_accounts WHERE person_id = NEW.person_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS point_redemptions_fill_keys ON public.point_redemptions;
CREATE TRIGGER point_redemptions_fill_keys
  BEFORE INSERT ON public.point_redemptions
  FOR EACH ROW EXECUTE FUNCTION public.point_redemptions_fill_keys();

UPDATE public.point_redemptions r
   SET person_id = a.person_id
  FROM public.pocket_money_accounts a
 WHERE r.account_id = a.id AND r.person_id IS NULL;

-- Every row has had an account until now (account_id was NOT NULL with a
-- cascading FK), so the backfill above leaves none without a person.
ALTER TABLE public.point_redemptions ALTER COLUMN person_id SET NOT NULL;
ALTER TABLE public.point_redemptions ALTER COLUMN account_id DROP NOT NULL;

-- Deleting a child's pocket-money account no longer takes their reward
-- history with it: the requests are the child's. The account reference is
-- only cleared.
DO $$
DECLARE
  c TEXT;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
     WHERE con.conrelid = 'public.point_redemptions'::regclass
       AND con.contype = 'f'
       AND con.confrelid = 'public.pocket_money_accounts'::regclass
       AND con.confdeltype <> 'n'
  LOOP
    EXECUTE format('ALTER TABLE public.point_redemptions DROP CONSTRAINT %I', c);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
     WHERE con.conrelid = 'public.point_redemptions'::regclass
       AND con.contype = 'f'
       AND con.confrelid = 'public.pocket_money_accounts'::regclass
  ) THEN
    ALTER TABLE public.point_redemptions
      ADD CONSTRAINT point_redemptions_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.pocket_money_accounts(id) ON DELETE SET NULL;
  END IF;
END $$;

DROP INDEX IF EXISTS public.point_redemptions_account_status_idx;
CREATE INDEX IF NOT EXISTS point_redemptions_person_status_idx ON public.point_redemptions (person_id, status);
CREATE INDEX IF NOT EXISTS point_redemptions_account_idx ON public.point_redemptions (account_id) WHERE account_id IS NOT NULL;


-- Family-scoped as before; a child in the recycle bin takes their requests out
-- of sight with them, like their creature.
DROP POLICY IF EXISTS point_redemptions_family_read ON public.point_redemptions;
CREATE POLICY point_redemptions_family_read ON public.point_redemptions
  FOR SELECT USING (family_id = public.current_family_id() AND EXISTS (
    SELECT 1 FROM public.people p WHERE p.id = point_redemptions.person_id AND p.deleted_at IS NULL));

-- ---------------------------------------------------------------------------
-- 3. The balance, a request, a decision -- per person
-- ---------------------------------------------------------------------------
--
-- NAMES. The per-person functions get new names: request_point_redemption(
-- family, account, reward, device) and a per-person version would have the
-- same argument types, so they cannot share a name. The account ones stay as
-- thin wrappers for one release, for anything of this release that still
-- names them; they do NOT serve an rc.13 rollback, which re-creates its own
-- versions on boot (see the top of this file). decide_point_redemption() is
-- keyed on the request, not the child, so it keeps its name and arguments and
-- only its body changes.

-- A child's points: earned (todo_point_awards), spent (approved requests),
-- waiting (pending requests) and the balance, max(0, earned - spent), with
-- what is owed when a task was un-ticked after its points were spent. NULL
-- when there is no such person in the family. Mirrored by pointTotals() in
-- webapp/src/lib/pocket-money/points.ts. No pocket-money account involved.
CREATE OR REPLACE FUNCTION public.point_person_totals(p_family_id UUID, p_person_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_earned BIGINT;
  v_spent BIGINT;
  v_pending BIGINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.people WHERE id = p_person_id AND family_id = p_family_id) THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(sum(points), 0) INTO v_earned FROM public.todo_point_awards
   WHERE person_id = p_person_id AND family_id = p_family_id;
  SELECT COALESCE(sum(cost_points) FILTER (WHERE status = 'approved'), 0),
         COALESCE(sum(cost_points) FILTER (WHERE status = 'pending'), 0)
    INTO v_spent, v_pending
    FROM public.point_redemptions WHERE person_id = p_person_id AND family_id = p_family_id;
  RETURN jsonb_build_object(
    'earned', v_earned, 'spent', v_spent, 'pending', v_pending,
    'balance', GREATEST(0, v_earned - v_spent),
    'owed', GREATEST(0, v_spent - v_earned));
END $$;

-- The account's child's points, under the old name, for one release.
CREATE OR REPLACE FUNCTION public.point_account_totals(p_family_id UUID, p_account_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT public.point_person_totals(p_family_id, a.person_id)
    FROM public.pocket_money_accounts a
   WHERE a.id = p_account_id AND a.family_id = p_family_id;
$$;

-- Every request and decision for one child is served in turn: a lock per
-- child, held to the end of the transaction. An advisory lock rather than a
-- row lock on people, so it never waits on -- or blocks -- an award's foreign
-- key check or an edit to the child; a delete of the child cascades without
-- taking it, so the two cannot deadlock.
CREATE OR REPLACE FUNCTION public.point_lock_person(p_person_id UUID) RETURNS void
LANGUAGE sql SET search_path = public, pg_temp AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('point_redemptions:' || p_person_id::text, 0));
$$;

-- A child asks for a reward. Answers:
--   { ok: true, redemption: {...} }
--   { ok: false, error: 'not_found' }        no such child in this family, or
--                                            one in the recycle bin
--   { ok: false, error: 'no_creature' }      the child has no creature switched on
--   { ok: false, error: 'no_reward' }        no such active reward in this family
--   { ok: false, error: 'insufficient_points', balance, pending }
-- What the creature grows with does not matter: points are the child's either
-- way (RFC-017 §2.2).
CREATE OR REPLACE FUNCTION public.request_person_point_redemption(
  p_family_id UUID, p_person_id UUID, p_reward_id UUID, p_device_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_reward public.point_rewards;
  v_totals JSONB;
  v_row public.point_redemptions;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.people
                  WHERE id = p_person_id AND family_id = p_family_id AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  PERFORM public.point_lock_person(p_person_id);
  IF NOT EXISTS (SELECT 1 FROM public.creatures
                  WHERE person_id = p_person_id AND family_id = p_family_id AND enabled) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_creature');
  END IF;

  SELECT * INTO v_reward FROM public.point_rewards
   WHERE id = p_reward_id AND family_id = p_family_id AND active;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'no_reward'); END IF;

  v_totals := public.point_person_totals(p_family_id, p_person_id);
  IF (v_totals->>'balance')::BIGINT - (v_totals->>'pending')::BIGINT < v_reward.cost_points THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_points',
      'balance', v_totals->'balance', 'pending', v_totals->'pending');
  END IF;

  INSERT INTO public.point_redemptions
    (family_id, person_id, reward_id, title, icon, cost_points, requested_by_device_id)
  VALUES
    (p_family_id, p_person_id, v_reward.id, v_reward.title, v_reward.icon, v_reward.cost_points,
     (SELECT id FROM public.devices WHERE id = p_device_id AND family_id = p_family_id))
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', true, 'redemption', to_jsonb(v_row));
END $$;

-- The account's child asks, under the old name, for one release.
CREATE OR REPLACE FUNCTION public.request_point_redemption(
  p_family_id UUID, p_account_id UUID, p_reward_id UUID, p_device_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_person UUID;
BEGIN
  SELECT person_id INTO v_person FROM public.pocket_money_accounts
   WHERE id = p_account_id AND family_id = p_family_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  RETURN public.request_person_point_redemption(p_family_id, v_person, p_reward_id, p_device_id);
END $$;

-- A parent decides. Answers:
--   { ok: true, status: 'approved', balance } | { ok: true, status: 'denied' }
--   { ok: false, error: 'not_found' }                 no such request in this family
--   { ok: false, error: 'already_decided', status }   nothing changed
--   { ok: false, error: 'insufficient_points', balance }  nothing changed, still pending
-- The child's lock first, then the request: every decision for this child
-- queues behind the one before, so the balance read below already counts it.
-- Two devices approving the same request: one approves, the other is told
-- already_decided. Two requests that together exceed the balance: one
-- approved, the other refused with nothing written.
CREATE OR REPLACE FUNCTION public.decide_point_redemption(
  p_family_id UUID, p_redemption_id UUID, p_decision TEXT, p_device_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_person UUID;
  v_req public.point_redemptions;
  v_device UUID;
  v_totals JSONB;
  v_balance BIGINT;
BEGIN
  IF p_decision NOT IN ('approved', 'denied') THEN
    RAISE EXCEPTION 'decision must be approved or denied' USING ERRCODE = '22023';
  END IF;

  SELECT person_id INTO v_person FROM public.point_redemptions
   WHERE id = p_redemption_id AND family_id = p_family_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  PERFORM public.point_lock_person(v_person);

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

  v_totals := public.point_person_totals(p_family_id, v_req.person_id);
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
    'public.creatures_from_accounts(UUID)',
    'public.point_person_totals(UUID, UUID)',
    'public.point_account_totals(UUID, UUID)',
    'public.point_lock_person(UUID)',
    'public.request_person_point_redemption(UUID, UUID, UUID, UUID)',
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

SELECT pg_advisory_unlock(hashtextextended('migration_zzzzzzzz_pocket_money_creatures_out', 0));

NOTIFY pgrst, 'reload schema';
