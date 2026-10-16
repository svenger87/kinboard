-- migration_bring_pull_sync.sql — what the Bring! pull sync (#407) needs to
-- tell "changed in Kinboard" from "changed in the Bring! app".
--
-- The sync (src/lib/bring-sync.ts) compares the selected Bring! list with
-- shopping_items. Comparing the two lists alone is ambiguous: an item ticked
-- in Kinboard and still open on Bring! is either a tick Bring! has not heard
-- about yet, or an item somebody put back on the list in the app. Ticks come
-- from more places than the shopping page — the shop mode, the offline queue,
-- assistants through the Integration API — and not all of them tell Bring!.
--
--   * shopping_items.bring_checked is the ticked state last agreed with
--     Bring!. checked <> bring_checked means Kinboard changed it since; equal
--     means any difference on Bring! is Bring!'s. NULL means never synced.
--
--   * shopping_items.bring_list_id is the Bring! list the link belongs to.
--     A link to another list (the family picked a different one, or signed
--     in to another account) counts as no link: otherwise every linked open
--     item would look bought there and be ticked off.
--
--   * bring_removals records an open, Bring!-linked item deleted in Kinboard,
--     by any path, so the next sync takes it off the Bring! list instead of
--     reading it straight back in. A trigger, for the same reason the recycle
--     bin is one (migration_zzz_soft_delete.sql): deletes are PostgREST calls
--     from many places, and any one missed would be a hole.
--
-- Idempotent: safe on every boot.

ALTER TABLE public.shopping_items ADD COLUMN IF NOT EXISTS bring_checked BOOLEAN;
ALTER TABLE public.shopping_items ADD COLUMN IF NOT EXISTS bring_list_id TEXT;

CREATE TABLE IF NOT EXISTS public.bring_removals (
  id BIGSERIAL PRIMARY KEY,
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  bring_item_id TEXT NOT NULL,
  bring_list_id TEXT,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bring_removals ADD COLUMN IF NOT EXISTS bring_list_id TEXT;

CREATE INDEX IF NOT EXISTS idx_bring_removals_family ON public.bring_removals(family_id);

-- Server-only: only the sync (service role) reads it; the trigger below
-- writes it as its owner. Nothing in the browser needs it.
ALTER TABLE public.bring_removals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bring_removals FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.bring_removals FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.bring_removals FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.bring_removals TO service_role;
    GRANT USAGE, SELECT ON SEQUENCE public.bring_removals_id_seq TO service_role;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.record_bring_removal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Not when the family itself is being deleted: its items go in the
  -- cascade, and a row pointing at the family would fail that delete.
  INSERT INTO public.bring_removals (family_id, bring_item_id, bring_list_id)
  SELECT OLD.family_id, OLD.bring_item_id, OLD.bring_list_id
  WHERE EXISTS (SELECT 1 FROM public.families WHERE id = OLD.family_id);
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.record_bring_removal() FROM PUBLIC;

-- Only an open item: a ticked one is in Bring!'s "recently" already, and
-- clearing ticked items is the everyday case.
DROP TRIGGER IF EXISTS trg_shopping_item_bring_removal ON public.shopping_items;
CREATE TRIGGER trg_shopping_item_bring_removal
  AFTER DELETE ON public.shopping_items
  FOR EACH ROW
  WHEN (OLD.bring_item_id IS NOT NULL AND OLD.checked IS NOT TRUE)
  EXECUTE FUNCTION public.record_bring_removal();
