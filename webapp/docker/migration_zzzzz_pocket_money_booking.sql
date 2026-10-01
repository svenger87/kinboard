-- migration_zzzzz_pocket_money_booking.sql
-- One pocket-money booking, all at once. RFC-012 §3.
--
-- book_pocket_money() writes the transaction row and moves the account's
-- balance (and, for genuine earnings, lifetime_saved_cents) in one function
-- call, so in one transaction. The balance moves with a single
--
--   UPDATE … SET balance_cents = balance_cents + delta
--   WHERE id = account AND family_id = family AND balance_cents + delta >= 0
--
-- rather than the read-then-write the routes used to do: two withdrawals
-- racing on one account are serialised by the row lock, the second one's
-- WHERE is re-checked against the first one's result, and only one of two
-- that together exceed the balance goes through. A failed transaction insert
-- undoes the balance move with it.
--
-- lifetime_saved_cents drives the avatar tier and counts only genuine
-- earnings: a positive amount that is not an `adjustment`. That is the rule
-- the session route and the Home Assistant service already applied.
--
-- Answers jsonb:
--   { "ok": true, "transaction": {…the row…}, "balance_cents": n }
--   { "ok": false, "error": "insufficient_funds" }   nothing was written
--   { "ok": false, "error": "not_found" }            no such account in that family
-- and raises for anything else, which also writes nothing: a zero amount, an
-- amount whose sign contradicts its type (allowance, manual_deposit and
-- interest are positive, withdrawal negative, adjustment either), an unknown
-- type, a goal that is not this account's, a person who is not this family's.
--
-- Every balance change goes through it: the session route, the Home Assistant
-- service, an approved assistant request, and — through the functions below —
-- an approved withdrawal request (decide_pocket_money_withdrawal), the
-- allowance cron (pay_pocket_money_allowance) and the interest cron
-- (commit_pocket_money_interest).
--
-- SECURITY INVOKER: only the service role calls it (the routes' admin client),
-- and it has the table rights already. EXECUTE is taken from everyone else.
--
-- Also here, the guard Task 8 left for its pair: a pocket_money request carries
-- no Home Assistant fields (the mirror of assistant_action_requests_home_fields_check).
--
-- Sorts after migration_zzzzz_action_request_kind.sql, which adds `kind`.
-- Safe to run twice.

CREATE OR REPLACE FUNCTION public.book_pocket_money(
  p_family_id UUID,
  p_account_id UUID,
  p_amount_cents INTEGER,
  p_type TEXT,
  p_note TEXT DEFAULT NULL,
  p_related_goal_id UUID DEFAULT NULL,
  p_created_by_person_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance INTEGER;
  v_txn public.pocket_money_transactions;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents = 0 THEN
    RAISE EXCEPTION 'amount_cents must be non-zero' USING ERRCODE = '22023';
  END IF;
  -- Money in is positive, money out negative; only an adjustment goes either way.
  IF (p_type IN ('allowance', 'manual_deposit', 'interest') AND p_amount_cents < 0)
     OR (p_type = 'withdrawal' AND p_amount_cents > 0) THEN
    RAISE EXCEPTION 'amount_cents % does not match type %', p_amount_cents, p_type USING ERRCODE = '22023';
  END IF;
  -- A linked goal is one of this account's (binned or not: a withdrawal
  -- request may point at a goal binned since); a linked person is one of
  -- this family's.
  IF p_related_goal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.pocket_money_goals g
    WHERE g.id = p_related_goal_id AND g.account_id = p_account_id) THEN
    RAISE EXCEPTION 'related_goal_id is not a goal of this account' USING ERRCODE = '22023';
  END IF;
  IF p_created_by_person_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.people p
    WHERE p.id = p_created_by_person_id AND p.family_id = p_family_id) THEN
    RAISE EXCEPTION 'created_by_person_id is not a person of this family' USING ERRCODE = '22023';
  END IF;

  UPDATE public.pocket_money_accounts
     SET balance_cents = balance_cents + p_amount_cents,
         lifetime_saved_cents = lifetime_saved_cents
           + CASE WHEN p_amount_cents > 0 AND p_type <> 'adjustment' THEN p_amount_cents ELSE 0 END
   WHERE id = p_account_id
     AND family_id = p_family_id
     AND balance_cents + p_amount_cents >= 0
  RETURNING balance_cents INTO v_balance;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.pocket_money_accounts
               WHERE id = p_account_id AND family_id = p_family_id) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insufficient_funds');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  INSERT INTO public.pocket_money_transactions
    (account_id, amount_cents, type, note, related_goal_id, created_by_person_id)
  VALUES
    (p_account_id, p_amount_cents, p_type, p_note, p_related_goal_id, p_created_by_person_id)
  RETURNING * INTO v_txn;

  RETURN jsonb_build_object('ok', true, 'transaction', to_jsonb(v_txn), 'balance_cents', v_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.book_pocket_money(UUID, UUID, INTEGER, TEXT, TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.book_pocket_money(UUID, UUID, INTEGER, TEXT, TEXT, UUID, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_pocket_money(UUID, UUID, INTEGER, TEXT, TEXT, UUID, UUID) TO service_role;

-- Interest, in the same way. accrue adds the day's interest to what is
-- pending as a delta, once per day (last_accrued_date), and commit moves what
-- is pending into the balance through book_pocket_money while holding the
-- account's row lock, then takes exactly that amount off pending. Neither
-- writes an absolute value it read earlier, so an accrual, a commit and a
-- booking overlapping on one account each keep their part.
CREATE OR REPLACE FUNCTION public.accrue_pocket_money_interest(
  p_account_id UUID,
  p_add_cents INTEGER,
  p_carry_micros BIGINT,
  p_today DATE
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.pocket_money_accounts
     SET pending_interest_cents = pending_interest_cents + GREATEST(p_add_cents, 0),
         pending_interest_micros = p_carry_micros,
         last_accrued_date = p_today
   WHERE id = p_account_id
     AND last_accrued_date IS DISTINCT FROM p_today;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_pocket_money_interest(
  p_account_id UUID,
  p_note TEXT DEFAULT 'Daily interest'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_family UUID;
  v_pending INTEGER;
  v_result JSONB;
BEGIN
  SELECT family_id, pending_interest_cents INTO v_family, v_pending
    FROM public.pocket_money_accounts WHERE id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_pending <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nothing_pending');
  END IF;
  v_result := public.book_pocket_money(v_family, p_account_id, v_pending, 'interest', p_note);
  IF (v_result->>'ok')::BOOLEAN THEN
    UPDATE public.pocket_money_accounts
       SET pending_interest_cents = pending_interest_cents - v_pending,
           interest_committed_at = now()
     WHERE id = p_account_id;
  END IF;
  RETURN v_result || jsonb_build_object('amount_cents', v_pending);
END;
$$;

REVOKE ALL ON FUNCTION public.accrue_pocket_money_interest(UUID, INTEGER, BIGINT, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accrue_pocket_money_interest(UUID, INTEGER, BIGINT, DATE) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accrue_pocket_money_interest(UUID, INTEGER, BIGINT, DATE) TO service_role;
REVOKE ALL ON FUNCTION public.commit_pocket_money_interest(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_pocket_money_interest(UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_pocket_money_interest(UUID, TEXT) TO service_role;

-- The allowance, paid and recorded as paid in one transaction. The period is
-- claimed first — last_allowance_at moves only if it still holds what the
-- cron read (p_expected_last) — and the booking runs in the same call, so a
-- failure anywhere undoes both: a retry can neither pay twice nor skip a
-- payment. Another run that claimed the period first gets 'already_paid'.
CREATE OR REPLACE FUNCTION public.pay_pocket_money_allowance(
  p_account_id UUID,
  p_amount_cents INTEGER,
  p_note TEXT,
  p_expected_last TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_family UUID;
  v_result JSONB;
BEGIN
  UPDATE public.pocket_money_accounts
     SET last_allowance_at = now()
   WHERE id = p_account_id
     AND last_allowance_at IS NOT DISTINCT FROM p_expected_last
  RETURNING family_id INTO v_family;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_paid');
  END IF;
  v_result := public.book_pocket_money(v_family, p_account_id, p_amount_cents, 'allowance', p_note);
  IF NOT (v_result->>'ok')::BOOLEAN THEN
    -- Undo the claim with the rest: nothing was paid.
    RAISE EXCEPTION 'allowance not booked: %', v_result->>'error' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_result;
END;
$$;

-- A parent's decision on a child's withdrawal request, in one transaction.
-- The request row is locked, so two devices deciding at once are served one
-- after the other and the second is told it was already decided. Approving
-- books -amount as a withdrawal through book_pocket_money(); not enough money
-- denies the request instead (as the route always did). A linked goal is
-- marked bought. Answers:
--   { ok: true, status: 'approved' | 'denied' }
--   { ok: false, error: 'not_found' }                 no such request in this family
--   { ok: false, error: 'already_decided', status }   nothing changed
--   { ok: false, error: 'insufficient_funds' }        request denied, nothing booked
--   { ok: false, error: 'invalid_goal' | 'invalid_person' }  nothing changed
CREATE OR REPLACE FUNCTION public.decide_pocket_money_withdrawal(
  p_family_id UUID,
  p_request_id UUID,
  p_decision TEXT,
  p_person_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req public.pocket_money_withdrawal_requests;
  v_result JSONB;
BEGIN
  IF p_decision NOT IN ('approved', 'denied') THEN
    RAISE EXCEPTION 'decision must be approved or denied' USING ERRCODE = '22023';
  END IF;

  SELECT r.* INTO v_req
    FROM public.pocket_money_withdrawal_requests r
    JOIN public.pocket_money_accounts a ON a.id = r.account_id
   WHERE r.id = p_request_id AND a.family_id = p_family_id
     FOR UPDATE OF r;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_decided', 'status', v_req.status);
  END IF;

  IF p_decision = 'denied' THEN
    UPDATE public.pocket_money_withdrawal_requests
       SET status = 'denied', parent_decided_at = now(), parent_decided_by_person_id = p_person_id
     WHERE id = p_request_id;
    RETURN jsonb_build_object('ok', true, 'status', 'denied');
  END IF;

  -- Said cleanly rather than raised by the booking.
  IF v_req.related_goal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.pocket_money_goals g
    WHERE g.id = v_req.related_goal_id AND g.account_id = v_req.account_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_goal');
  END IF;
  IF p_person_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.people p WHERE p.id = p_person_id AND p.family_id = p_family_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_person');
  END IF;

  v_result := public.book_pocket_money(
    p_family_id, v_req.account_id, -v_req.amount_cents, 'withdrawal',
    NULLIF(v_req.reason, ''), v_req.related_goal_id, p_person_id);

  IF NOT (v_result->>'ok')::BOOLEAN THEN
    IF v_result->>'error' = 'insufficient_funds' THEN
      -- The child spent the money on something else after asking.
      UPDATE public.pocket_money_withdrawal_requests
         SET status = 'denied', parent_decided_at = now(), parent_decided_by_person_id = p_person_id
       WHERE id = p_request_id;
    END IF;
    RETURN v_result;
  END IF;

  IF v_req.related_goal_id IS NOT NULL THEN
    UPDATE public.pocket_money_goals
       SET status = 'bought', parent_confirmed_at = now()
     WHERE id = v_req.related_goal_id;
  END IF;
  UPDATE public.pocket_money_withdrawal_requests
     SET status = 'approved', parent_decided_at = now(), parent_decided_by_person_id = p_person_id
   WHERE id = p_request_id;
  RETURN jsonb_build_object('ok', true, 'status', 'approved', 'balance_cents', v_result->'balance_cents');
END;
$$;

REVOKE ALL ON FUNCTION public.pay_pocket_money_allowance(UUID, INTEGER, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pay_pocket_money_allowance(UUID, INTEGER, TEXT, TIMESTAMPTZ) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pay_pocket_money_allowance(UUID, INTEGER, TEXT, TIMESTAMPTZ) TO service_role;
REVOKE ALL ON FUNCTION public.decide_pocket_money_withdrawal(UUID, UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decide_pocket_money_withdrawal(UUID, UUID, TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_pocket_money_withdrawal(UUID, UUID, TEXT, UUID) TO service_role;

-- A pocket-money request is described by `data` alone.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.assistant_action_requests'::regclass
      AND conname = 'assistant_action_requests_pocket_money_fields_check') THEN
    ALTER TABLE public.assistant_action_requests
      ADD CONSTRAINT assistant_action_requests_pocket_money_fields_check CHECK (
        (kind <> 'pocket_money')
        OR (entity_id IS NULL AND entity_name IS NULL AND domain IS NULL AND service IS NULL)
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
