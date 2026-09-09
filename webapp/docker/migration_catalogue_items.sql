-- migration_catalogue_items.sql
-- One row per thing the household cares about. RFC-006 §2.
--
-- Entities, not devices: Home Assistant's device and area registries are
-- WebSocket-only and Kinboard talks to /api/states, which returns flat
-- entities. Entities are what we can read, so entities are what we model.
--
-- Nothing here caches Home Assistant state. The row is a pointer and a
-- presentation; what a lamp is doing right now is fetched at render time. A
-- stale lock state on a kitchen wall is worse than no lock on the wall.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'catalogue_items'
  ) THEN
    CREATE TABLE public.catalogue_items (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,

      -- Exactly one target is meaningful, per `kind`. A third kind (a polled
      -- URL) is M3 and deliberately absent: adding a column later is cheaper
      -- than designing auth and failure handling for it now.
      kind TEXT NOT NULL CHECK (kind IN ('ha_entity', 'builtin')),
      entity_id TEXT,
      builtin_key TEXT,

      -- The household's, not Home Assistant's.
      name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
      room TEXT,
      image_url TEXT,
      position INTEGER NOT NULL DEFAULT 0,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT catalogue_items_target CHECK (
        (kind = 'ha_entity' AND entity_id IS NOT NULL AND builtin_key IS NULL) OR
        (kind = 'builtin'   AND builtin_key IS NOT NULL AND entity_id IS NULL)
      )
    );

    -- The point of the table: one row per entity per family. Today the same
    -- entity sits in a room under one name and on a dashboard under another,
    -- and nothing notices.
    CREATE UNIQUE INDEX catalogue_items_family_entity_idx
      ON public.catalogue_items (family_id, entity_id) WHERE entity_id IS NOT NULL;
    CREATE UNIQUE INDEX catalogue_items_family_builtin_idx
      ON public.catalogue_items (family_id, builtin_key) WHERE builtin_key IS NOT NULL;
    CREATE INDEX catalogue_items_family_position_idx
      ON public.catalogue_items (family_id, position);

    CREATE TRIGGER catalogue_items_set_updated_at
      BEFORE UPDATE ON public.catalogue_items
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- Realtime, or a device renamed on a phone never reaches the panel. A
-- subscription to an unpublished table is silent, not an error — that is how
-- `timers` shipped working on one machine and dead everywhere else. Qualified
-- with schemaname because realtime.messages exists in this stack.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public'
      AND tablename='catalogue_items') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.catalogue_items;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Fold the three existing copies of this list out of settings.home_assistant.
--
-- RoomConfig.entities[], Dashboard.cards[] and the pre-multi-dashboard
-- dashboard_cards[] are all "an entity, a name, an order", written
-- independently and kept in step by hand. This is one-way: the blob is left
-- exactly as it is (RFC-006 §3.2), because a household whose data this gets
-- wrong needs somewhere to get it back from.
--
-- ON CONFLICT DO NOTHING is required rather than defensive — every migration
-- here is applied twice by design, and the second pass must be a no-op.
--
-- Every jsonb_array_elements() below is fed through a "is this actually a
-- JSON array?" guard rather than a bare COALESCE. COALESCE(x, '[]'::jsonb)
-- only substitutes when the key is *missing* — a household whose blob has
-- "dashboards": null (valid JSON, not SQL NULL) still hands
-- jsonb_array_elements a scalar, which raises "cannot extract elements from
-- a scalar" and aborts this INSERT ... SELECT for every family scanned in
-- the same statement, not just the one with the bad value. jsonb_typeof()
-- of a missing key (SQL NULL) is also SQL NULL, so the same CASE covers both
-- "absent" and "present but not an array" with one check.
--
-- (e.value ->> 'position')::int has the same install-wide blast radius for a
-- different reason: a float ("1.5") or a non-numeric string in that field
-- raises a cast error, not a type error, but the effect on the statement is
-- identical. A regexp check that only casts when the text is a plain
-- (optionally signed) integer, falling back to 0 otherwise, is safe against
-- both.
-- ---------------------------------------------------------------------------

-- Rooms first: the rooms page is where a household names things deliberately,
-- so its name is the one that survives a collision with a dashboard card.
--
-- The name must satisfy catalogue_items' CHECK (char_length(name) BETWEEN 1
-- AND 120): a household's display_name was never length-limited in the old
-- blob, and an entity_id with no dot has no suffix to derive a name from.
-- Either previously produced a name the constraint rejects, which aborts
-- this INSERT ... SELECT entirely — for every family in the same pass, not
-- just the one with the bad row. left(..., 120) clamps the length; the
-- three-deep COALESCE falls through display_name, then the derived suffix
-- (NULLIF'd so an entity_id with no dot, which derives an empty string,
-- doesn't win), then the raw entity_id itself, which the WHERE clause below
-- guarantees is non-empty.
INSERT INTO public.catalogue_items (family_id, kind, entity_id, name, room, position)
SELECT
  s.family_id,
  'ha_entity',
  e.value ->> 'entity_id',
  left(
    COALESCE(
      NULLIF(trim(e.value ->> 'display_name'), ''),
      -- No name given: make the entity id's own suffix readable —
      -- light.under_cupboard becomes "Under cupboard". Sentence case, not
      -- initcap: initcap capitalises every word ("Under Cupboard"), and this
      -- app writes sentence case everywhere else.
      NULLIF(
        upper(left(replace(split_part(e.value ->> 'entity_id', '.', 2), '_', ' '), 1))
          || substr(replace(split_part(e.value ->> 'entity_id', '.', 2), '_', ' '), 2),
        ''
      ),
      e.value ->> 'entity_id'
    ),
    120
  ),
  r.value ->> 'name',
  CASE WHEN (e.value ->> 'position') ~ '^-?[0-9]+$'
    THEN (e.value ->> 'position')::int
    ELSE 0
  END
FROM public.settings s
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(s.value -> 'rooms_config' -> 'rooms') = 'array'
    THEN s.value -> 'rooms_config' -> 'rooms'
    ELSE '[]'::jsonb
  END
) AS r(value)
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(r.value -> 'entities') = 'array'
    THEN r.value -> 'entities'
    ELSE '[]'::jsonb
  END
) AS e(value)
WHERE s.key = 'home_assistant'
  AND NULLIF(trim(e.value ->> 'entity_id'), '') IS NOT NULL
-- Also tolerates a duplicate entity_id produced within this very statement —
-- the same entity twice in one room, or repeated across two rooms of the
-- same family — silently keeping whichever of the two Postgres happens to
-- insert first; that ordering is not guaranteed.
ON CONFLICT DO NOTHING;

-- Then dashboard cards, appended after whatever the rooms wrote for that
-- family. Both sequences start at 0, so interleaving would scramble both.
-- Same name-length, empty-suffix and array-typed-value guards as the rooms
-- insert above.
INSERT INTO public.catalogue_items (family_id, kind, entity_id, name, room, position)
SELECT
  s.family_id,
  'ha_entity',
  c.value ->> 'entity_id',
  left(
    COALESCE(
      NULLIF(trim(c.value ->> 'display_name'), ''),
      NULLIF(
        upper(left(replace(split_part(c.value ->> 'entity_id', '.', 2), '_', ' '), 1))
          || substr(replace(split_part(c.value ->> 'entity_id', '.', 2), '_', ' '), 2),
        ''
      ),
      c.value ->> 'entity_id'
    ),
    120
  ),
  NULL,
  COALESCE((SELECT MAX(position) + 1 FROM public.catalogue_items ci WHERE ci.family_id = s.family_id), 0)
    + CASE WHEN (c.value ->> 'position') ~ '^-?[0-9]+$'
        THEN (c.value ->> 'position')::int
        ELSE 0
      END
FROM public.settings s
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(s.value -> 'dashboards') = 'array'
    THEN s.value -> 'dashboards'
    ELSE '[]'::jsonb
  END
) AS d(value)
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(d.value -> 'cards') = 'array'
    THEN d.value -> 'cards'
    ELSE '[]'::jsonb
  END
) AS c(value)
WHERE s.key = 'home_assistant'
  AND NULLIF(trim(c.value ->> 'entity_id'), '') IS NOT NULL
ON CONFLICT DO NOTHING;

-- Then the pre-multi-dashboard shape: `dashboard_cards`, a flat card array
-- that predates `dashboards`. use-home-assistant.ts folds it into
-- `dashboards` in memory when a household happens to read their settings,
-- but only persists that if they save something afterwards — so a blob
-- that still carries `dashboard_cards` and never picked up `dashboards`
-- would otherwise migrate its rooms and silently drop every one of these
-- cards. Same precedence as the dashboards insert (rooms already won, and
-- ON CONFLICT DO NOTHING skips anything either earlier insert already
-- wrote), same appended position, same name derivation, same guards.
INSERT INTO public.catalogue_items (family_id, kind, entity_id, name, room, position)
SELECT
  s.family_id,
  'ha_entity',
  c.value ->> 'entity_id',
  left(
    COALESCE(
      NULLIF(trim(c.value ->> 'display_name'), ''),
      NULLIF(
        upper(left(replace(split_part(c.value ->> 'entity_id', '.', 2), '_', ' '), 1))
          || substr(replace(split_part(c.value ->> 'entity_id', '.', 2), '_', ' '), 2),
        ''
      ),
      c.value ->> 'entity_id'
    ),
    120
  ),
  NULL,
  COALESCE((SELECT MAX(position) + 1 FROM public.catalogue_items ci WHERE ci.family_id = s.family_id), 0)
    + CASE WHEN (c.value ->> 'position') ~ '^-?[0-9]+$'
        THEN (c.value ->> 'position')::int
        ELSE 0
      END
FROM public.settings s
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(s.value -> 'dashboard_cards') = 'array'
    THEN s.value -> 'dashboard_cards'
    ELSE '[]'::jsonb
  END
) AS c(value)
WHERE s.key = 'home_assistant'
  AND NULLIF(trim(c.value ->> 'entity_id'), '') IS NOT NULL
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
