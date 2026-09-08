-- migration_zzzz_storage_write_policies.sql
-- Take the client-facing write policies off the image buckets.
--
-- recipe-images, vehicle-images and goal-images were each created with
-- INSERT/UPDATE/DELETE policies on storage.objects checking nothing but
-- `bucket_id`, with a comment saying "family scoping done via app". The anon
-- key is not a secret — it ships to every browser — so in practice that meant
-- anyone who could reach Kong could write to them.
--
-- Demonstrated before writing this, not assumed: a plain curl carrying the anon
-- key uploaded an arbitrary object into all three, and the UPDATE and DELETE
-- policies would equally have let it overwrite or remove a household's recipe
-- photos, vehicle pictures and savings-goal images.
--
-- Nothing legitimate used them. Every write goes through a server route —
-- /api/recipes/upload-image, /api/vehicles/upload-image,
-- /api/pocket-money/goal-image-upload — and all three use createAdminClient(),
-- which is service_role and bypasses RLS entirely. There is no browser-side
-- upload anywhere in the app, and nothing deletes objects at all.
--
-- Read stays open: the buckets are public=true and a browser fetches these
-- images directly, so SELECT has to work.
--
-- device-images was created without these policies for the same reason; this
-- brings the three older buckets in line with it.
--
-- The three bucket-creating files still contain the CREATE POLICY statements,
-- so on a fresh install the policies are created earlier in the run and dropped
-- here. That is deliberate: this file sorts last, so the end state is the same
-- on a fresh database and an existing one, and it needs no edit to migrations
-- that have already run everywhere. Removing the CREATEs would only save a
-- create-and-drop inside a single run.

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage schema not ready yet; skipping (runs again on a later start)';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "Upload recipe images" ON storage.objects;
  DROP POLICY IF EXISTS "Update recipe images" ON storage.objects;
  DROP POLICY IF EXISTS "Delete recipe images" ON storage.objects;

  DROP POLICY IF EXISTS "Upload vehicle images" ON storage.objects;
  DROP POLICY IF EXISTS "Update vehicle images" ON storage.objects;
  DROP POLICY IF EXISTS "Delete vehicle images" ON storage.objects;

  DROP POLICY IF EXISTS "Upload goal images" ON storage.objects;
  DROP POLICY IF EXISTS "Update goal images" ON storage.objects;
  DROP POLICY IF EXISTS "Delete goal images" ON storage.objects;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'no rights on the storage tables yet; skipping (runs again on a later start)';
END $$;

NOTIFY pgrst, 'reload schema';
