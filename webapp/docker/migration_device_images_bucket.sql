-- migration_device_images_bucket.sql
-- Photos for catalogue items. RFC-006 §4.
--
-- The storage schema may not exist yet on a fresh stack's first pass, and this
-- file must not fail the batch when it doesn't — it is created on a later run,
-- of which there is one on every container start.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage schema not ready yet; skipping device-images bucket (created on a later run)';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('device-images', 'device-images', true, 5242880,
          ARRAY['image/jpeg', 'image/png', 'image/webp'])
  ON CONFLICT (id) DO NOTHING;

  DROP POLICY IF EXISTS "Public read device images" ON storage.objects;
  CREATE POLICY "Public read device images" ON storage.objects
    FOR SELECT USING (bucket_id = 'device-images');

  -- Read is public: the bucket is public=true and a browser fetches these
  -- directly, so SELECT has to be open.
  --
  -- Writing is NOT. The three sibling buckets grant INSERT/UPDATE/DELETE on
  -- nothing but `bucket_id`, and the anon key is public — it ships to every
  -- browser. That is not theoretical: with those policies in place, a plain
  -- curl carrying the anon key uploaded an arbitrary object into this bucket
  -- through Kong, and could equally have overwritten or deleted a household's
  -- pictures. So this bucket has no client-facing write policy at all.
  --
  -- Nothing legitimate needs one. `/api/catalogue/upload-image` writes with
  -- `createAdminClient()` — service_role, which bypasses RLS — after checking
  -- the session and the family. The server route is the only way in, which is
  -- what "family scoping done via app" was always supposed to mean.
  --
  -- Dropped rather than merely not created, so an install that already ran an
  -- earlier version of this file loses them too.
  DROP POLICY IF EXISTS "Upload device images" ON storage.objects;
  DROP POLICY IF EXISTS "Update device images" ON storage.objects;
  DROP POLICY IF EXISTS "Delete device images" ON storage.objects;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'no rights on the storage tables yet; skipping device-images bucket (created on a later run)';
END $$;

NOTIFY pgrst, 'reload schema';
