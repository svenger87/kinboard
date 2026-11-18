-- migrations/085_device_screen.sql — each screen's size, as it reports it.
--
--   devices.screen   { viewportWidth, viewportHeight, screenWidth,
--                      screenHeight, pixelRatio, reportedAt }, or NULL until
--                      the screen has reported. viewport* are the page's CSS
--                      pixels (what a layout is drawn in), screen* the
--                      display's own pixels, pixelRatio the browser's scaling
--                      (1.5 for Windows at 150%).
--
-- Settings -> Devices shows it, and the layout designer will draw a layout
-- for the size a screen actually has instead of a guess.
--
-- WHO MAY WRITE IT. Only the server: POST /api/screen, which writes
-- the session's own device and nothing else. No grant to the browser roles,
-- so one screen cannot write another's size directly: 077_device_owner.sql
-- narrowed their INSERT and UPDATE on devices to named columns, and this one
-- is not among them. Readable like the rest of the row.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS screen JSONB;

COMMENT ON COLUMN public.devices.screen IS
  'The screen''s size as it last reported it (viewport and display pixels, pixel ratio). '
  'Written only by the server (POST /api/screen); the browser roles have no '
  'INSERT or UPDATE privilege on this column.';
