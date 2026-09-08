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
-- Fold the two existing copies of this list out of settings.home_assistant.
--
-- RoomConfig.entities[] and Dashboard.cards[] are both "an entity, a name, an
-- order", written twice and kept in step by hand. This is one-way: the blob is
-- left exactly as it is (RFC-006 §3.2), because a household whose data this
-- gets wrong needs somewhere to get it back from.
--
-- ON CONFLICT DO NOTHING is required rather than defensive — every migration
-- here is applied twice by design, and the second pass must be a no-op.
-- ---------------------------------------------------------------------------

-- Rooms first: the rooms page is where a household names things deliberately,
-- so its name is the one that survives a collision with a dashboard card.
INSERT INTO public.catalogue_items (family_id, kind, entity_id, name, room, position)
SELECT
  s.family_id,
  'ha_entity',
  e.value ->> 'entity_id',
  COALESCE(
    NULLIF(e.value ->> 'display_name', ''),
    -- No name given: make the entity id's own suffix readable —
    -- light.under_cupboard becomes "Under cupboard". Sentence case, not
    -- initcap: initcap capitalises every word ("Under Cupboard"), and this
    -- app writes sentence case everywhere else.
    upper(left(replace(split_part(e.value ->> 'entity_id', '.', 2), '_', ' '), 1))
      || substr(replace(split_part(e.value ->> 'entity_id', '.', 2), '_', ' '), 2)
  ),
  r.value ->> 'name',
  COALESCE((e.value ->> 'position')::int, 0)
FROM public.settings s
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.value -> 'rooms_config' -> 'rooms', '[]'::jsonb)) AS r(value)
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.value -> 'entities', '[]'::jsonb)) AS e(value)
WHERE s.key = 'home_assistant'
  AND e.value ->> 'entity_id' IS NOT NULL
ON CONFLICT DO NOTHING;

-- Then dashboard cards, appended after whatever the rooms wrote for that
-- family. Both sequences start at 0, so interleaving would scramble both.
INSERT INTO public.catalogue_items (family_id, kind, entity_id, name, room, position)
SELECT
  s.family_id,
  'ha_entity',
  c.value ->> 'entity_id',
  COALESCE(
    NULLIF(c.value ->> 'display_name', ''),
    upper(left(replace(split_part(c.value ->> 'entity_id', '.', 2), '_', ' '), 1))
      || substr(replace(split_part(c.value ->> 'entity_id', '.', 2), '_', ' '), 2)
  ),
  NULL,
  COALESCE((SELECT MAX(position) + 1 FROM public.catalogue_items ci WHERE ci.family_id = s.family_id), 0)
    + COALESCE((c.value ->> 'position')::int, 0)
FROM public.settings s
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.value -> 'dashboards', '[]'::jsonb)) AS d(value)
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.value -> 'cards', '[]'::jsonb)) AS c(value)
WHERE s.key = 'home_assistant'
  AND c.value ->> 'entity_id' IS NOT NULL
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
