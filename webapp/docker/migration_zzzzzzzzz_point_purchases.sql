-- migration_zzzzzzzzz_point_purchases.sql
-- The creature shop (RFC-017 §5, step 3): a child spends task points on
-- things for their creature -- hats, glasses, neckwear, backgrounds.
--
--   point_purchases               one row per item a child owns
--   purchase_person_point_item()  buying: one transaction under the child's lock
--   refund_person_point_purchase() a parent's refund, under the same lock
--   point_person_totals()         the balance now counts purchases too
--
-- THE CATALOGUE is in code (webapp/src/lib/pocket-money/creatures/shop.ts):
-- the item ids are stable, and the server route passes the item's price from
-- there. The browser never names a price, and nothing but the service role
-- may call the function.
--
-- WHO MAY WRITE. As #361 and the creatures: the browser roles read their
-- family's purchases (the shop, Change look and the parent's list need them,
-- and realtime streams them) and write nothing. Every write is on the
-- service role: POST /api/creatures/[personId]/purchases (buying, no PIN),
-- DELETE /api/creatures/purchases/[id] (a parent's refund, settings PIN), or
-- the restore. TRUNCATE goes with REVOKE ALL.
--
-- THE BALANCE. earned - approved redemptions - purchases, never below zero,
-- with pending redemptions held. point_person_totals() keeps its name and
-- signature (the Integration API and MCP read it) and gains a `purchased`
-- key; `spent` stays the approved redemptions. request_person_point_redemption()
-- and decide_point_redemption() check their balance through it, so a purchase
-- counts against a reward request and its approval with no change to how
-- they add up. request_person_point_redemption() is re-created below anyway,
-- with its signature, for one fix: the child's presence is checked under the
-- lock (section 4). All three take the same per-child
-- lock (point_lock_person), so a purchase and an approval for one child are
-- served in turn and cannot both spend the same points.
--
-- The stage is untouched: in points mode it follows the points EARNED
-- (todo_point_awards), never the balance, so buying never shrinks a creature.
--
-- THE NAME sorts after migration_zzzzzzzz_pocket_money_creatures_out.sql,
-- whose point_person_totals() this one replaces on every boot (the files
-- re-run in order, so this definition is the one left standing), and names no
-- pocket_money_* table, so it may sort after the pocket-money revoke.
--
-- Safe to run twice, and twice at once (the entrypoint and
-- `./start.sh migrate`): the session advisory lock serialises two runs.
--
-- After the first run, restart the realtime container: it reads the
-- publication only when it starts, and a purchase would not reach the
-- child's other screens until it does.

SELECT pg_advisory_lock(hashtextextended('migration_zzzzzzzzz_point_purchases', 0));

-- ---------------------------------------------------------------------------
-- 1. point_purchases
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.point_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  -- A catalogue id from shop.ts. Not checked against the list here, so an
  -- item retired from the catalogue stays bought (and paid for).
  item_id TEXT NOT NULL
    CONSTRAINT point_purchases_item_id_check CHECK (item_id ~ '^[a-z][a-z0-9_]{0,39}$'),
  -- What it cost on the day, in points: the balance adds these up, so a later
  -- price change never moves an old purchase.
  cost INTEGER NOT NULL
    CONSTRAINT point_purchases_cost_check CHECK (cost BETWEEN 1 AND 10000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Each item once per child: the function checks first, this is the floor.
  CONSTRAINT point_purchases_person_item_key UNIQUE (person_id, item_id)
);

CREATE INDEX IF NOT EXISTS point_purchases_family_idx ON public.point_purchases (family_id);

-- Family-scoped reads, and a child in the recycle bin takes their purchases
-- out of sight with them, like their creature and their requests. "The child
-- is there" rather than "not binned": the subquery runs under people's own
-- row-level security, which already hides a binned person.
ALTER TABLE public.point_purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS point_purchases_family_read ON public.point_purchases;
CREATE POLICY point_purchases_family_read ON public.point_purchases
  FOR SELECT USING (family_id = public.current_family_id() AND EXISTS (
    SELECT 1 FROM public.people p WHERE p.id = point_purchases.person_id AND p.deleted_at IS NULL));

-- REVOKE ALL takes TRUNCATE too.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.point_purchases FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.point_purchases FROM authenticated;
    GRANT SELECT ON TABLE public.point_purchases TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.point_purchases TO service_role;
  END IF;
END $$;

-- A purchase on the child's tablet shows on the kitchen display.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'point_purchases') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.point_purchases;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The balance
-- ---------------------------------------------------------------------------

-- A child's points: earned (todo_point_awards), spent (approved requests),
-- purchased (the shop), waiting (pending requests) and the balance,
-- max(0, earned - spent - purchased), with what is owed when a task was
-- un-ticked after its points were spent. NULL when there is no such person in
-- the family. Mirrored by pointTotals() in webapp/src/lib/pocket-money/points.ts.
CREATE OR REPLACE FUNCTION public.point_person_totals(p_family_id UUID, p_person_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_earned BIGINT;
  v_spent BIGINT;
  v_pending BIGINT;
  v_purchased BIGINT;
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
  SELECT COALESCE(sum(cost), 0) INTO v_purchased FROM public.point_purchases
   WHERE person_id = p_person_id AND family_id = p_family_id;
  RETURN jsonb_build_object(
    'earned', v_earned, 'spent', v_spent, 'purchased', v_purchased, 'pending', v_pending,
    'balance', GREATEST(0, v_earned - v_spent - v_purchased),
    'owed', GREATEST(0, v_spent + v_purchased - v_earned));
END $$;

-- ---------------------------------------------------------------------------
-- 3. Buying, and a parent's refund
-- ---------------------------------------------------------------------------

-- A child buys an item for their creature. No PIN: it is the child's own
-- action, and the route passes the catalogue's price. Answers:
--   { ok: true, purchase: {...}, balance }
--   { ok: false, error: 'not_found' }       no such child in this family, or
--                                           one in the recycle bin
--   { ok: false, error: 'no_creature' }     no creature switched on
--   { ok: false, error: 'shop_off' }        a parent turned the shop off
--   { ok: false, error: 'already_owned' }   bought before; nothing charged
--   { ok: false, error: 'insufficient_points', balance, pending }
-- Everything is checked after the child's lock is taken -- the child being
-- there too, so a purchase that waited on the lock behind a bin sees the bin
-- -- and ten taps at once
-- on two tablets are served one after the other: one buys, the rest are told
-- already_owned or insufficient_points, and nothing is charged twice. Pending
-- reward requests are held, as for a new request: a purchase cannot spend
-- points a parent is about to approve.
CREATE OR REPLACE FUNCTION public.purchase_person_point_item(
  p_family_id UUID, p_person_id UUID, p_item_id TEXT, p_cost INTEGER
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_creature public.creatures;
  v_totals JSONB;
  v_row public.point_purchases;
BEGIN
  PERFORM public.point_lock_person(p_person_id);
  IF NOT EXISTS (SELECT 1 FROM public.people
                  WHERE id = p_person_id AND family_id = p_family_id AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT * INTO v_creature FROM public.creatures
   WHERE person_id = p_person_id AND family_id = p_family_id;
  IF NOT FOUND OR NOT v_creature.enabled THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_creature');
  END IF;
  IF NOT v_creature.shop_enabled THEN
    RETURN jsonb_build_object('ok', false, 'error', 'shop_off');
  END IF;

  IF EXISTS (SELECT 1 FROM public.point_purchases
              WHERE person_id = p_person_id AND family_id = p_family_id AND item_id = p_item_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_owned');
  END IF;

  v_totals := public.point_person_totals(p_family_id, p_person_id);
  IF (v_totals->>'balance')::BIGINT - (v_totals->>'pending')::BIGINT < p_cost THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_points',
      'balance', v_totals->'balance', 'pending', v_totals->'pending');
  END IF;

  INSERT INTO public.point_purchases (family_id, person_id, item_id, cost)
  VALUES (p_family_id, p_person_id, p_item_id, p_cost)
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', true, 'purchase', to_jsonb(v_row),
    'balance', (v_totals->>'balance')::BIGINT - p_cost);
END $$;

-- A parent takes a purchase back (Settings -> Creatures & rewards, behind
-- the settings PIN). Answers:
--   { ok: true, refunded: {...}, balance }
--   { ok: false, error: 'not_found' }   no such purchase in this family
-- The row is DELETED, not marked: a purchase row means "the child owns this
-- and paid for it", which is what the balance, the ownership check, the
-- one-per-item rule and a backup all read. A refunded item is neither owned
-- nor paid for, so it leaves no row, and the child can buy it again later.
-- The parent's list shows what the child has now.
-- Under the child's lock, like a purchase: a refund and a purchase of the
-- same item, or a refund and an approval, are served in turn. A worn item
-- comes off in the same transaction -- whichever slot holds it -- so the
-- look never wears something not owned.
CREATE OR REPLACE FUNCTION public.refund_person_point_purchase(
  p_family_id UUID, p_purchase_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_person UUID;
  v_row public.point_purchases;
BEGIN
  SELECT person_id INTO v_person FROM public.point_purchases
   WHERE id = p_purchase_id AND family_id = p_family_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  PERFORM public.point_lock_person(v_person);

  DELETE FROM public.point_purchases
   WHERE id = p_purchase_id AND family_id = p_family_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;

  UPDATE public.creatures c
     SET look = c.look - ARRAY(
       SELECT e.key FROM jsonb_each_text(c.look) e
        WHERE e.key IN ('head', 'face', 'neck', 'background') AND e.value = v_row.item_id)
   WHERE c.person_id = v_row.person_id AND c.family_id = p_family_id
     AND EXISTS (SELECT 1 FROM jsonb_each_text(c.look) e
                  WHERE e.key IN ('head', 'face', 'neck', 'background') AND e.value = v_row.item_id);

  RETURN jsonb_build_object('ok', true, 'refunded', to_jsonb(v_row),
    'balance', public.point_person_totals(p_family_id, v_row.person_id)->'balance');
END $$;

-- ---------------------------------------------------------------------------
-- 4. A reward request: the child's presence checked under the lock
-- ---------------------------------------------------------------------------

-- As in migration_zzzzzzzz_pocket_money_creatures_out.sql, same name, same
-- arguments, same answers, with one change: whether the child is there (not
-- in the recycle bin) is checked after the child's lock is taken, not
-- before, so a request that waited on the lock sees a bin that landed while
-- it waited. Re-created here on every boot, after step 1's version.
CREATE OR REPLACE FUNCTION public.request_person_point_redemption(
  p_family_id UUID, p_person_id UUID, p_reward_id UUID, p_device_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_reward public.point_rewards;
  v_totals JSONB;
  v_row public.point_redemptions;
BEGIN
  PERFORM public.point_lock_person(p_person_id);
  IF NOT EXISTS (SELECT 1 FROM public.people
                  WHERE id = p_person_id AND family_id = p_family_id AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
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

-- EXECUTE for the service role only. point_person_totals() and
-- request_person_point_redemption() are re-created above, so their grants
-- are re-stated with the new functions'. Written out
-- rather than built with format(), so the grants guards can read them.
REVOKE ALL ON FUNCTION public.point_person_totals(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purchase_person_point_item(UUID, UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_person_point_purchase(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_person_point_redemption(UUID, UUID, UUID, UUID) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.point_person_totals(UUID, UUID) FROM anon;
    REVOKE ALL ON FUNCTION public.purchase_person_point_item(UUID, UUID, TEXT, INTEGER) FROM anon;
    REVOKE ALL ON FUNCTION public.refund_person_point_purchase(UUID, UUID) FROM anon;
    REVOKE ALL ON FUNCTION public.request_person_point_redemption(UUID, UUID, UUID, UUID) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.point_person_totals(UUID, UUID) FROM authenticated;
    REVOKE ALL ON FUNCTION public.purchase_person_point_item(UUID, UUID, TEXT, INTEGER) FROM authenticated;
    REVOKE ALL ON FUNCTION public.refund_person_point_purchase(UUID, UUID) FROM authenticated;
    REVOKE ALL ON FUNCTION public.request_person_point_redemption(UUID, UUID, UUID, UUID) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.point_person_totals(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION public.purchase_person_point_item(UUID, UUID, TEXT, INTEGER) TO service_role;
    GRANT EXECUTE ON FUNCTION public.refund_person_point_purchase(UUID, UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION public.request_person_point_redemption(UUID, UUID, UUID, UUID) TO service_role;
  END IF;
END $$;

SELECT pg_advisory_unlock(hashtextextended('migration_zzzzzzzzz_point_purchases', 0));

NOTIFY pgrst, 'reload schema';
