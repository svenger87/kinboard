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
-- and raises for anything else (a zero amount, an unknown type, a bad goal id),
-- which also writes nothing.
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
