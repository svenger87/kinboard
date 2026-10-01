-- migration_zzzzz_action_request_kind.sql
-- A confirmation can be for more than a Home Assistant action. RFC-012 §3.
--
-- `kind` says what an assistant_action_requests row asks for:
--
-- - `home`: a Home Assistant service call, as before. entity_id, entity_name,
--   domain and service are what runs; every row that existed before this file
--   is one of these, and the CHECK below keeps them required for it.
-- - `pocket_money`: a pocket-money booking, described entirely by `data`
--   ({ person_id, person_name, amount_cents, currency, type, note }). It has
--   no entity, so the four Home Assistant columns become nullable.
--
-- Approval is unchanged (RFC-011 §4.3): settings PIN to allow, anyone may
-- deny, two minutes, the assistant re-checked before anything runs. The server
-- dispatches on `kind` when it runs an approved request.
--
-- RLS (assistant_action_requests_family_scope), the grants and the
-- supabase_realtime membership are left exactly as
-- migration_zzzz_assistant_actions.sql set them. Restart the realtime
-- container after running this on a live install all the same: the row
-- shape it streams has a new column.
--
-- Sorts after migration_zzzz_assistant_actions.sql, which creates the table.
-- Safe to run twice: every step is guarded.

ALTER TABLE public.assistant_action_requests
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'home';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.assistant_action_requests'::regclass
      AND conname = 'assistant_action_requests_kind_check') THEN
    ALTER TABLE public.assistant_action_requests
      ADD CONSTRAINT assistant_action_requests_kind_check CHECK (kind IN ('home', 'pocket_money'));
  END IF;
END $$;

-- Nullable for the kinds that have no device. The length CHECKs on these
-- columns stay; a NULL passes them.
DO $$
DECLARE col TEXT;
BEGIN
  FOREACH col IN ARRAY ARRAY['entity_id', 'entity_name', 'domain', 'service'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'assistant_action_requests'
        AND column_name = col AND is_nullable = 'NO') THEN
      EXECUTE format('ALTER TABLE public.assistant_action_requests ALTER COLUMN %I DROP NOT NULL', col);
    END IF;
  END LOOP;
END $$;

-- A home request still names the device and the service it runs.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.assistant_action_requests'::regclass
      AND conname = 'assistant_action_requests_home_fields_check') THEN
    ALTER TABLE public.assistant_action_requests
      ADD CONSTRAINT assistant_action_requests_home_fields_check CHECK (
        (kind <> 'home')
        OR (entity_id IS NOT NULL AND domain IS NOT NULL AND service IS NOT NULL AND entity_name IS NOT NULL)
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
