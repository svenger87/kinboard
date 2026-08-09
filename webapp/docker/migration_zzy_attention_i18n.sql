-- migration_zzy_attention_i18n.sql — carry what a hint MEANS, not only its words.
--
-- attention_items stored `title` and `detail` as rendered English, because the
-- evaluator runs server-side and produced strings. On a German household's
-- wall display that read "Henrik needs to pack for tomorrow" in the middle of
-- an otherwise German interface.
--
-- Translating on the server would not fix it. Kinboard's locale is per DEVICE
-- — a cookie negotiated per browser, not a family setting — so a household can
-- run a German wall tablet and an English phone at the same time, and any
-- single server-side choice is wrong for one of them.
--
-- So the row carries the message and its values, and each surface says it in
-- its own words. `title` and `detail` stay: Home Assistant needs *a* string,
-- and an item raised before a translation exists must still say something
-- rather than showing a key.

ALTER TABLE public.attention_items
  ADD COLUMN IF NOT EXISTS message_key TEXT,
  ADD COLUMN IF NOT EXISTS params JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.attention_items.message_key IS
  'Translation key for the hint. NULL for rows raised before this existed, '
  'which fall back to the rendered `title`.';
COMMENT ON COLUMN public.attention_items.params IS
  'Values the message interpolates — names, counts, lists. The list contents '
  'are the family''s own words (subject names, pack items) and are never '
  'translated.';
