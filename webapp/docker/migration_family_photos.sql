-- migration_family_photos.sql
-- The uploaded photo library. RFC-009.
--
-- A fifth photo source, and the first one whose contents Kinboard stores
-- rather than borrows from Immich, Unsplash, a NAS or iCloud.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- The table.
--
-- Listing the bucket would have avoided this file entirely. It also returns
-- names and sizes and nothing else — no capture date to order by, and no
-- dimensions, so nothing could adapt a photo to a screen of a different shape
-- without downloading it first. RFC-009 §3.2 and §3.4.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.family_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,

  -- Object keys inside the private `family-photos` bucket, both prefixed
  -- `<family_id>/`. UNIQUE so a retried upload cannot leave two rows pointing
  -- at one object, which would delete somebody's photo out from under a row
  -- that still lists it.
  storage_path TEXT NOT NULL UNIQUE,
  thumbnail_path TEXT,

  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,

  -- Post-rotation dimensions: the shape the photo is actually displayed at,
  -- not what its EXIF says before the orientation flag is applied. A stored
  -- width that disagreed with the rendered one would make every decision in
  -- RFC-009 §3.4 wrong for precisely the photos that need it — phone
  -- portraits. Nullable because a file sharp cannot measure is still a file.
  width INTEGER,
  height INTEGER,

  -- From EXIF where the camera recorded it. Nullable, and deliberately
  -- separate from uploaded_at: a holiday photo taken in July and uploaded in
  -- September belongs in July.
  taken_at TIMESTAMPTZ,

  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The library is always read one family at a time, newest first, falling back
-- to upload order for photos whose camera said nothing.
CREATE INDEX IF NOT EXISTS family_photos_family_taken_idx
  ON public.family_photos (family_id, taken_at DESC NULLS LAST, uploaded_at DESC);

-- ---------------------------------------------------------------------------
-- The bucket.
--
-- private = true, unlike the four that came before it.
--
-- recipe-images, vehicle-images, goal-images and device-images are public
-- because a browser fetches them directly and they are pictures of dinners,
-- cars and appliances. These are photographs of a household's children, on an
-- instance that for kinboard.app and the demo is reachable from the internet,
-- and a public bucket means any URL that ever escapes is world-readable for
-- good. Reads go through short-lived signed URLs minted by an authenticated
-- route instead. RFC-009 §3.1.
--
-- No client-facing INSERT/UPDATE/DELETE policy, and no SELECT policy either.
-- migration_zzzz_storage_write_policies.sql records why in full: the anon key
-- ships to every browser, and a plain curl carrying it uploaded an arbitrary
-- object into all three older buckets. Every write here goes through
-- /api/photos/upload with createAdminClient(), which is service_role and
-- bypasses RLS, after the session and the family have been checked.
--
-- Guarded, because the storage service creates its schema while these
-- migrations are already running — and the webapp refuses to start on a failed
-- migration, so an unguarded version means a fresh install never comes up.
-- Created on a later run, of which there is one on every container start.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage schema not ready yet; skipping family-photos bucket (created on a later run)';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('family-photos', 'family-photos', false, 26214400,
          ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
  ON CONFLICT (id) DO UPDATE
    SET public = EXCLUDED.public,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

  -- Dropped rather than merely not created, so an install that somehow
  -- acquired them loses them too. Same reasoning as device-images.
  DROP POLICY IF EXISTS "Public read family photos" ON storage.objects;
  DROP POLICY IF EXISTS "Upload family photos" ON storage.objects;
  DROP POLICY IF EXISTS "Update family photos" ON storage.objects;
  DROP POLICY IF EXISTS "Delete family photos" ON storage.objects;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'no rights on the storage tables yet; skipping family-photos bucket (created on a later run)';
END $$;

NOTIFY pgrst, 'reload schema';
