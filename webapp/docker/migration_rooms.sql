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

-- ---------------------------------------------------------------------------
-- Reconcile the two stores. RFC-007 §3, in three ordered steps.
--
-- One-way: the blob and catalogue_items.room are both left exactly as they
-- are. A migration that is wrong about a household's data needs somewhere to
-- have been wrong from.
--
-- ONCE PER FAMILY, NOT ONCE PER CONTAINER START. Every migration in this
-- project is applied by the webapp entrypoint on every boot, and both legacy
-- stores it reads from are deliberately never cleared: the blob's
-- rooms_config stays, and the catalogue screen writes only room_id, leaving
-- catalogue_items.room intact as the recovery copy. So re-deriving rooms from
-- them on each start would undo the household's own later edits — a device
-- whose room was cleared gets it back, a room that was deleted comes back
-- with a new id and its devices re-linked. That is exactly the failure the
-- blob's entities[] are ignored to avoid; the room text reintroduces it
-- through the other door.
--
-- The guard is a durable per-family marker, families.rooms_reconciled_at, and
-- not "does this family have rooms yet": a household that deliberately
-- deletes every room it has would have them all recreated on the next start,
-- which is the same bug in miniature. A family with nothing to migrate is
-- stamped too, so it is never reconsidered.
--
-- All three steps are gated, step 1 included: rooms_config is a frozen legacy
-- blob that nothing writes any more and nothing deletes, so an ungated step 1
-- would resurrect a deleted blob room on every boot just as surely as step 2
-- resurrects a deleted text room.
--
-- Every extraction is guarded with jsonb_typeof: COALESCE catches a missing
-- key but not a JSON null, and a scalar where an array is expected aborts the
-- statement for every family on the install — which stops the webapp
-- container starting at all, because its entrypoint exits 1.
-- ---------------------------------------------------------------------------

ALTER TABLE public.families
  ADD COLUMN IF NOT EXISTS rooms_reconciled_at TIMESTAMPTZ;

-- One transaction: the stamp has to land with the work it records, or a
-- restart between the two would either re-run the reconciliation (stamp lost)
-- or skip a family that was never reconciled (work lost).
BEGIN;

-- 1. Blob rooms first: only they carry icon, colour and order.
INSERT INTO public.rooms (family_id, name, icon, color, position)
SELECT
  s.family_id,
  trim(r.value ->> 'name'),
  NULLIF(r.value ->> 'icon', ''),
  NULLIF(r.value ->> 'color', ''),
  CASE WHEN COALESCE(r.value ->> 'position', '') ~ '^-?[0-9]+$'
       THEN (r.value ->> 'position')::int ELSE 0 END
FROM public.settings s
JOIN public.families f ON f.id = s.family_id AND f.rooms_reconciled_at IS NULL
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(s.value -> 'rooms_config' -> 'rooms') = 'array'
       THEN s.value -> 'rooms_config' -> 'rooms' ELSE '[]'::jsonb END) AS r(value)
WHERE s.key = 'home_assistant'
  AND NULLIF(trim(COALESCE(r.value ->> 'name', '')), '') IS NOT NULL
  AND char_length(trim(r.value ->> 'name')) <= 80
ON CONFLICT DO NOTHING;

-- 2. Rooms that exist only as catalogue text, appended after the blob's.
INSERT INTO public.rooms (family_id, name, position)
SELECT DISTINCT ON (c.family_id, lower(trim(c.room)))
  c.family_id,
  trim(c.room),
  COALESCE((SELECT MAX(position) + 1 FROM public.rooms r2 WHERE r2.family_id = c.family_id), 0)
FROM public.catalogue_items c
JOIN public.families f ON f.id = c.family_id AND f.rooms_reconciled_at IS NULL
WHERE NULLIF(trim(COALESCE(c.room, '')), '') IS NOT NULL
  AND char_length(trim(c.room)) <= 80
  AND NOT EXISTS (
    SELECT 1 FROM public.rooms r
    WHERE r.family_id = c.family_id AND lower(trim(r.name)) = lower(trim(c.room))
  )
ON CONFLICT DO NOTHING;

-- 3. Resolve every device's room text to a room_id, case-insensitively.
UPDATE public.catalogue_items c
SET room_id = r.id
FROM public.rooms r, public.families f
WHERE c.room_id IS NULL
  AND c.room IS NOT NULL
  AND r.family_id = c.family_id
  AND f.id = c.family_id
  AND f.rooms_reconciled_at IS NULL
  AND lower(trim(r.name)) = lower(trim(c.room));

-- 4. Stamp everything the three steps above were allowed to touch, including
--    the families that had nothing to migrate. Same predicate, same
--    transaction, so the set is exactly the one just reconciled.
UPDATE public.families
SET rooms_reconciled_at = NOW()
WHERE rooms_reconciled_at IS NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
