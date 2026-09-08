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

NOTIFY pgrst, 'reload schema';
