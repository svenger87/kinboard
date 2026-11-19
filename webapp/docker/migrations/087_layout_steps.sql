-- migrations/087_layout_steps.sql — layouts move from cells to quarter-cell steps.
--
--   layouts.grid   the columns a layout's positions count: 12 (cells, every
--                  layout saved before this migration) or 48 (steps, four to a
--                  cell). The app only reads and writes 48.
--
-- Each item's x, y, w and h in home and screensaver are multiplied by four,
-- which places every box exactly where it was; the rest of the item (id,
-- widget, text, options) is kept as it is. Only rows with grid = 12 are
-- converted, and they are set to 48 in the same statement, so a row is never
-- converted twice.
--
-- The column is added with DEFAULT 12, so the rows already there count as
-- cells; the default then becomes 48 for the rows the app writes from now on.
--
-- updated_at is left alone, so an editor open across the upgrade is not told
-- the layout changed meanwhile (the server refuses its saves anyway, 409
-- grid_changed, because its bundle sends no grid). The UPDATE still fires the
-- kinboard_change_feed trigger (086_layouts.sql), so screens refetch.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, the conversion only touches
-- grid = 12, and setting the default again is a no-op.

ALTER TABLE public.layouts ADD COLUMN IF NOT EXISTS grid smallint NOT NULL DEFAULT 12;

UPDATE public.layouts SET
  screensaver = (SELECT coalesce(jsonb_agg(i || jsonb_build_object('x',(i->>'x')::int*4,'y',(i->>'y')::int*4,'w',(i->>'w')::int*4,'h',(i->>'h')::int*4)), '[]'::jsonb) FROM jsonb_array_elements(screensaver) i),
  home        = (SELECT coalesce(jsonb_agg(i || jsonb_build_object('x',(i->>'x')::int*4,'y',(i->>'y')::int*4,'w',(i->>'w')::int*4,'h',(i->>'h')::int*4)), '[]'::jsonb) FROM jsonb_array_elements(home) i),
  grid = 48
WHERE grid = 12;

ALTER TABLE public.layouts ALTER COLUMN grid SET DEFAULT 48;

COMMENT ON COLUMN public.layouts.grid IS
  'The columns the positions in home and screensaver count: 48 (quarter-cell '
  'steps). 12 marks a row still in cells; the app treats it as no layout.';

NOTIFY pgrst, 'reload schema';

-- Going back (manual, not run by the app): an image from before this change
-- reads 48-step items as out of bounds and shows the built-in screensaver, so
-- it is safe without this, but the layouts come back only after:
--
--   UPDATE public.layouts SET
--     screensaver = (SELECT coalesce(jsonb_agg(i || jsonb_build_object('x',round((i->>'x')::numeric/4)::int,'y',round((i->>'y')::numeric/4)::int,'w',greatest(1,round((i->>'w')::numeric/4)::int),'h',greatest(1,round((i->>'h')::numeric/4)::int))), '[]'::jsonb) FROM jsonb_array_elements(screensaver) i),
--     home        = (SELECT coalesce(jsonb_agg(i || jsonb_build_object('x',round((i->>'x')::numeric/4)::int,'y',round((i->>'y')::numeric/4)::int,'w',greatest(1,round((i->>'w')::numeric/4)::int),'h',greatest(1,round((i->>'h')::numeric/4)::int))), '[]'::jsonb) FROM jsonb_array_elements(home) i),
--     grid = 12
--   WHERE grid = 48;
--   ALTER TABLE public.layouts ALTER COLUMN grid SET DEFAULT 12;
--
-- Rounding can make two boxes overlap or one reach past the last row; the old
-- image then refuses that layout's save until the box is moved.
