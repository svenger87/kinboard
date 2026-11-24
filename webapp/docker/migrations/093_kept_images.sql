-- migrations/093_kept_images.sql — where a kept picture came from.
--
-- A picture chosen from the web search, or one that came with an imported
-- recipe, used to be saved as the address of the original, and every screen
-- loaded it from that site each time (src/lib/recipe-image-keep.ts). The
-- webapp now fetches such a picture once, stores a scaled copy with the
-- uploaded ones, and points the row at the copy.
--
-- That replaces an address that works anywhere with one that only works
-- where the file is. This table is the way back: for every copy, the
-- address it was made from. The JSON export writes those addresses back
-- into the rows it exports, so a backup restored on another install, or
-- without the storage volume, still has its pictures, as it did before.
--
-- Additive: one new table. The webapp records here BEFORE it changes a row
-- and leaves the row alone if it cannot, so on a database without this
-- table nothing is kept and pictures load from the web as they always did.
--
-- Server only: the browser roles get nothing.

CREATE TABLE IF NOT EXISTS public.kept_images (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    family_id   uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    local_url   text NOT NULL,
    source_url  text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (family_id, local_url)
);

ALTER TABLE public.kept_images ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.kept_images FROM PUBLIC;
REVOKE ALL ON TABLE public.kept_images FROM anon;
REVOKE ALL ON TABLE public.kept_images FROM authenticated;
GRANT ALL ON TABLE public.kept_images TO service_role;
