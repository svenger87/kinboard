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

  DROP POLICY IF EXISTS "Upload device images" ON storage.objects;
  CREATE POLICY "Upload device images" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'device-images');

  DROP POLICY IF EXISTS "Update device images" ON storage.objects;
  CREATE POLICY "Update device images" ON storage.objects
    FOR UPDATE USING (bucket_id = 'device-images');

  DROP POLICY IF EXISTS "Delete device images" ON storage.objects;
  CREATE POLICY "Delete device images" ON storage.objects
    FOR DELETE USING (bucket_id = 'device-images');
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'no rights on the storage tables yet; skipping device-images bucket (created on a later run)';
END $$;

NOTIFY pgrst, 'reload schema';
