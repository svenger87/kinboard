-- RFC-018 §4: stored image URLs become relative.
--
-- Uploaded images (recipes, catalogue items, vehicles, birthdays, savings
-- goals) were stored with a full URL built from the install's API address,
-- e.g. http://192.168.1.10:8100/storage/v1/object/public/recipe-images/<f>/x.jpg.
-- Open Kinboard from another address — the domain instead of the LAN IP, or
-- after the address changed — and every one of those images broke. New
-- uploads store /storage/v1/object/public/<bucket>/<path>, which resolves
-- against whatever address the page was opened from; this rewrites the old
-- rows to the same form.
--
-- WHICH ROWS. A URL is rewritten only when all of these hold:
--   * it is absolute and its path is exactly
--     /storage/v1/object/public/<bucket>/<object>, with no query or fragment;
--   * <bucket> is a public bucket of THIS install, and <object> is an object
--     in it (storage.objects), compared as written and URL-decoded.
-- The host is deliberately not part of the rule. The database cannot know
-- API_EXTERNAL_URL, and the host stored with an old row is whatever the
-- address was when it was uploaded — an install that has changed address has
-- rows under several hosts, all of them its own. What makes a URL ours is
-- that the object it names is in our storage. A picture somebody pasted from
-- another site — even another Supabase-backed one, with the same path shape —
-- names an object we do not have, and is left exactly as it is.
--
-- Idempotent: a relative URL never matches, so a second run changes nothing.
-- Runs on every container start like every migration; after the first it is
-- a scan that updates no rows. Rewritten rows get a new updated_at where the
-- table keeps one.

-- %XX-decoding for an object name, NULL for anything malformed. Object names
-- Kinboard generates are plain (<family>/<time>-<random>.<ext>); this is for
-- names an import or an older upload path may have carried encoded.
CREATE OR REPLACE FUNCTION public.uri_decode_or_null(p text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_out bytea := ''::bytea;
  v_i int := 1;
  v_n int := length(p);
  v_c text;
BEGIN
  IF p IS NULL THEN
    RETURN NULL;
  END IF;
  WHILE v_i <= v_n LOOP
    v_c := substr(p, v_i, 1);
    IF v_c = '%' THEN
      IF substr(p, v_i + 1, 2) !~ '^[0-9A-Fa-f]{2}$' THEN
        RETURN NULL;
      END IF;
      v_out := v_out || decode(substr(p, v_i + 1, 2), 'hex');
      v_i := v_i + 3;
    ELSE
      v_out := v_out || convert_to(v_c, 'UTF8');
      v_i := v_i + 1;
    END IF;
  END LOOP;
  RETURN convert_from(v_out, 'UTF8');
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- The relative form of a URL that names an object in one of this install's
-- public buckets; any other value comes back unchanged.
CREATE OR REPLACE FUNCTION public.relative_storage_url(p_url text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_m text[];
BEGIN
  IF p_url IS NULL THEN
    RETURN NULL;
  END IF;
  v_m := regexp_match(
    p_url,
    '^[A-Za-z][A-Za-z0-9+.-]*://[^/?#]+(/storage/v1/object/public/([^/?#]+)/([^?#]+))$'
  );
  IF v_m IS NULL THEN
    RETURN p_url;
  END IF;
  -- No storage service (a stack without it): nothing can be proven ours.
  IF to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL THEN
    RETURN p_url;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM storage.objects o
      JOIN storage.buckets b ON b.id = o.bucket_id AND b.public
     WHERE o.bucket_id = v_m[2]
       AND (o.name = v_m[3] OR o.name = public.uri_decode_or_null(v_m[3]))
  ) THEN
    RETURN v_m[1];
  END IF;
  RETURN p_url;
END;
$$;

-- Not part of the API. The second one would tell anyone which object names
-- exist; the service role keeps it for the end-to-end check.
REVOKE ALL ON FUNCTION public.uri_decode_or_null(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.relative_storage_url(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.uri_decode_or_null(text) FROM anon;
    REVOKE ALL ON FUNCTION public.relative_storage_url(text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.uri_decode_or_null(text) FROM authenticated;
    REVOKE ALL ON FUNCTION public.relative_storage_url(text) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.uri_decode_or_null(text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.relative_storage_url(text) TO service_role;
  END IF;
END $$;

-- The rewrite. shopping_items and item_catalog are not in the RFC's list, but
-- a shopping item copies its picture from a catalogue item, and the rule above
-- touches nothing that is not our own upload.
DO $$
DECLARE
  v_table text;
  v_count bigint;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'relative_image_urls: no storage schema yet; nothing to rewrite';
    RETURN;
  END IF;
  FOREACH v_table IN ARRAY ARRAY[
    'recipes', 'catalogue_items', 'vehicles', 'birthdays', 'pocket_money_goals',
    'shopping_items', 'item_catalog'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = v_table AND column_name = 'image_url'
    ) THEN
      EXECUTE format(
        'UPDATE public.%I
            SET image_url = public.relative_storage_url(image_url)
          WHERE image_url ~* %L
            AND public.relative_storage_url(image_url) IS DISTINCT FROM image_url',
        v_table,
        '^[a-z][a-z0-9+.-]*://[^/?#]+/storage/v1/object/public/'
      );
      GET DIAGNOSTICS v_count = ROW_COUNT;
      IF v_count > 0 THEN
        RAISE NOTICE 'relative_image_urls: % row(s) in % now relative', v_count, v_table;
      END IF;
    END IF;
  END LOOP;
EXCEPTION
  -- On a first boot the storage service may not have granted anything on its
  -- tables yet (migration_zzzz_storage_write_policies.sql meets the same).
  -- Nothing is lost: old links keep working, and this runs on every start.
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'relative_image_urls: no rights on the storage tables yet; skipping (runs again on a later start)';
END $$;
