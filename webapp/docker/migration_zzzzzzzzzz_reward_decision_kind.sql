-- migration_zzzzzzzzzz_reward_decision_kind.sql
-- An assistant may ask for a parent's decision on a child's reward request.
--
-- `reward_decision` is a third kind of assistant_action_requests row, next to
-- `home` and `pocket_money` (migration_zzzzz_action_request_kind.sql). It is
-- described entirely by `data`:
--
--   { redemption_id, decision: approve|decline, person_id, child_name,
--     reward_title, cost_points }
--
-- and, like a pocket-money booking, has no Home Assistant fields.
--
-- Nothing about how a request is decided changes: the settings PIN to allow
-- it, anyone may deny it, two minutes, the assistant re-checked. Only an
-- allowed request decides the reward, on the server, through
-- decide_point_redemption() -- the function a parent's own Approve and Deny
-- call, with its lock on the child and its checks that the request is still
-- pending and the points are still there.
--
-- RLS (assistant_action_requests_family_scope), the grants and the
-- supabase_realtime membership are left exactly as
-- migration_zzzz_assistant_actions.sql set them: the browser roles still only
-- SELECT their own family's rows, and nothing here grants anything on
-- point_redemptions. The row shape realtime streams does not change, so the
-- realtime container needs no restart for this file.
--
-- Sorts after migration_zzzzz_action_request_kind.sql (which adds `kind` and
-- its CHECK) and migration_zzzzz_pocket_money_booking.sql, in byte order and
-- under an en_US glob alike. Safe to run twice, and twice at once: the
-- advisory lock makes a second concurrent run wait, and each step only
-- changes what is not already as it should be.

SELECT pg_advisory_lock(hashtextextended('migration_zzzzzzzzzz_reward_decision_kind', 0));

-- The kind CHECK, widened. migration_zzzzz_action_request_kind.sql creates it
-- only when no constraint of that name exists, so on every later boot it
-- leaves this wider one alone.
DO $$
DECLARE
  def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.assistant_action_requests'::regclass
     AND conname = 'assistant_action_requests_kind_check';
  IF def IS NULL OR position('reward_decision' IN def) = 0 THEN
    ALTER TABLE public.assistant_action_requests DROP CONSTRAINT IF EXISTS assistant_action_requests_kind_check;
    ALTER TABLE public.assistant_action_requests
      ADD CONSTRAINT assistant_action_requests_kind_check
      CHECK (kind IN ('home', 'pocket_money', 'reward_decision'));
  END IF;
END $$;

-- A reward decision has no device: the mirror of
-- assistant_action_requests_pocket_money_fields_check.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.assistant_action_requests'::regclass
      AND conname = 'assistant_action_requests_reward_decision_fields_check') THEN
    ALTER TABLE public.assistant_action_requests
      ADD CONSTRAINT assistant_action_requests_reward_decision_fields_check CHECK (
        (kind <> 'reward_decision')
        OR (entity_id IS NULL AND entity_name IS NULL AND domain IS NULL AND service IS NULL)
      );
  END IF;
END $$;

SELECT pg_advisory_unlock(hashtextextended('migration_zzzzzzzzzz_reward_decision_kind', 0));

NOTIFY pgrst, 'reload schema';
