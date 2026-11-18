-- migrations/086_layouts.sql — named layouts a family designs for its screens.
--
--   layouts            one row per layout: its canvas size and the items it
--                      places, for the Home page (home) and the screensaver
--                      (screensaver), each a JSON array of layout items
--                      (webapp/src/lib/layouts/types.ts)
--   devices.layout_id  the layout a screen shows, or NULL for the built-in one
--
-- The designer draws a layout for the size a screen reports
-- (085_device_screen.sql) and a screen picks one by id.
--
-- WHO MAY WRITE THEM. Only the server, which checks the items before saving
-- them: the browser roles read their family's layouts and write nothing, so a
-- screen's token cannot save a layout the renderer would then choke on. And
-- devices.layout_id has no grant to the browser roles either:
-- 077_device_owner.sql narrowed their INSERT and UPDATE on devices to named
-- columns and this one is not among them, so one screen cannot switch
-- another's layout. Every write is on the service role.
--
-- Deleting a family takes its layouts (ON DELETE CASCADE); deleting a layout
-- leaves its screens on the built-in one (ON DELETE SET NULL). A layout's id
-- is not checked against the device's family by the key, so the server checks
-- it when it sets devices.layout_id.
--
-- updated_at is set by the server on every update; there is no trigger for it.
--
-- Live updates: the same kinboard_change_feed trigger as 084_change_feed.sql,
-- which reads family_id from the row.
--
-- Idempotent: IF NOT EXISTS, DROP/CREATE for the policy and trigger, and the
-- grants are reset to the same set each run.

CREATE TABLE IF NOT EXISTS public.layouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  width INTEGER NOT NULL CHECK (width BETWEEN 600 AND 20000),
  height INTEGER NOT NULL CHECK (height BETWEEN 300 AND 20000),
  home JSONB NOT NULL DEFAULT '[]'::jsonb,
  screensaver JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS layouts_family_idx ON public.layouts (family_id);

ALTER TABLE public.layouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS layouts_family_read ON public.layouts;
CREATE POLICY layouts_family_read ON public.layouts
  FOR SELECT USING (family_id = public.current_family_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.layouts FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.layouts FROM authenticated;
    GRANT SELECT ON TABLE public.layouts TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.layouts TO service_role;
  END IF;
END $$;

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS layout_id UUID REFERENCES public.layouts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.devices.layout_id IS
  'The layout this screen shows (NULL: the built-in one). '
  'Written only by the server; the browser roles have no INSERT or UPDATE '
  'privilege on this column.';

DROP TRIGGER IF EXISTS kinboard_change_feed ON public.layouts;
CREATE TRIGGER kinboard_change_feed AFTER INSERT OR UPDATE OR DELETE ON public.layouts
  FOR EACH ROW EXECUTE FUNCTION public.kinboard_notify_change();

NOTIFY pgrst, 'reload schema';
