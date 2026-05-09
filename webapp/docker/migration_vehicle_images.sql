-- migration_vehicle_images.sql
-- Adds vehicles.image_url for per-vehicle uploaded images, plus a
-- vehicle-images Supabase Storage bucket (public read, mirrors the
-- recipe-images pattern in migration.sql).
-- Idempotent: re-running on an already-migrated stack is a no-op.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vehicles'
      AND column_name = 'image_url'
  ) THEN
    ALTER TABLE public.vehicles ADD COLUMN image_url TEXT;
  END IF;
END $$;

-- Storage bucket — mirrors the recipe-images bucket so the upload
-- endpoint can keep the same shape (public read; family scoping done
-- by the app via path prefix `<family_id>/...`).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-images',
  'vehicle-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
) ON CONFLICT (id) DO NOTHING;

-- RLS: anyone can read public vehicle images (bucket is `public=true`
-- but RLS still gates SELECT — same pattern as recipe-images).
DROP POLICY IF EXISTS "Public read vehicle images" ON storage.objects;
CREATE POLICY "Public read vehicle images" ON storage.objects
  FOR SELECT USING (bucket_id = 'vehicle-images');

-- RLS: anyone can upload vehicle images (family scoping done via app).
DROP POLICY IF EXISTS "Upload vehicle images" ON storage.objects;
CREATE POLICY "Upload vehicle images" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'vehicle-images');

-- RLS: families can replace/delete their own vehicle images. The app
-- already restricts who can call the upload/delete endpoints; this
-- just doesn't add a second gate at the storage layer.
DROP POLICY IF EXISTS "Update vehicle images" ON storage.objects;
CREATE POLICY "Update vehicle images" ON storage.objects
  FOR UPDATE USING (bucket_id = 'vehicle-images');

DROP POLICY IF EXISTS "Delete vehicle images" ON storage.objects;
CREATE POLICY "Delete vehicle images" ON storage.objects
  FOR DELETE USING (bucket_id = 'vehicle-images');

NOTIFY pgrst, 'reload schema';
