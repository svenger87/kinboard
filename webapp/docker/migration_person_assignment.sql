-- migration_person_assignment.sql
--
-- Adds per-person attribution to events + birthdays + a child/student flag
-- on people. Aligns the canonical schema (init.sql) with what production
-- has been running for a while; existing prod installs already have these
-- columns, fresh installs get them via init.sql, and any in-between
-- installs get patched up by this migration.
--
-- Idempotent: re-running is a no-op.

DO $$
BEGIN
    -- people.is_child — flags school-aged kids so /schedule + pack-list
    -- features show up only for them.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'people' AND column_name = 'is_child'
    ) THEN
        ALTER TABLE public.people ADD COLUMN is_child BOOLEAN DEFAULT false;
    END IF;

    -- events.person_id — direct event-to-person assignment override
    -- (in addition to whole-calendar → person mapping).
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'person_id'
    ) THEN
        ALTER TABLE public.events
            ADD COLUMN person_id UUID REFERENCES public.people(id) ON DELETE SET NULL;
    END IF;

    -- birthdays.person_id — links a tracked birthday to a family-member
    -- so the colored dot on the year-ring picks up that person's color.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'birthdays' AND column_name = 'person_id'
    ) THEN
        ALTER TABLE public.birthdays
            ADD COLUMN person_id UUID REFERENCES public.people(id) ON DELETE SET NULL;
    END IF;
END $$;
