-- migration_rooms.sql
-- Rooms become rows. RFC-007 §2.
--
-- Until now a room could be edited in two places: the rooms settings page,
-- which wrote name/icon/colour/order and entity membership into
-- settings.home_assistant -> rooms_config, and the catalogue, which stores a
-- room as free text per device. Nothing reconciled them, and on the household
-- this was written against they had already diverged.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'rooms'
  ) THEN
    CREATE TABLE public.rooms (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
      -- Plain text, not an enum: RoomIcon is a TypeScript union of sixteen
      -- lucide names and the database has no business enforcing which icons
      -- the app ships. An unknown icon renders as the default.
      icon TEXT,
      color TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- One room per name per household, case-insensitively: "Flur" and "flur"
    -- are the same hallway, and a household that types both wants one room.
    CREATE UNIQUE INDEX rooms_family_name_idx
      ON public.rooms (family_id, lower(trim(name)));

    CREATE TRIGGER rooms_set_updated_at
      BEFORE UPDATE ON public.rooms
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- SET NULL, not CASCADE: deleting a room must not delete the lamps in it. A
-- device with no room is a supported state and the screens already render it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='catalogue_items' AND column_name='room_id'
  ) THEN
    ALTER TABLE public.catalogue_items
      ADD COLUMN room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL;
    CREATE INDEX catalogue_items_room_idx ON public.catalogue_items (room_id);
  END IF;
END $$;

-- Realtime. A subscription to an unpublished table is silent, not an error.
-- Qualified with schemaname because realtime.messages exists in this stack.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='rooms') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
