-- migration_timers.sql
-- Kitchen timers, shared across the household. RFC-004 §2.
--
-- Nothing here ticks. `started_at` plus `duration_seconds` is the whole
-- countdown; every device derives the remaining time itself, so a phone that
-- joins an hour late agrees with the panel that started it.
--
-- `finished_at` and `dismissed_at` are separate deliberately: a timer that has
-- rung and not been acknowledged is still on screen and still red. Collapsing
-- them into a delete would lose the alarm.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'timers'
  ) THEN
    CREATE TABLE public.timers (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
      label TEXT,
      duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      dismissed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- The widget reads "everything not yet dismissed", newest first.
    CREATE INDEX timers_family_id_dismissed_idx
      ON public.timers (family_id, dismissed_at, started_at DESC);

    CREATE TRIGGER timers_set_updated_at
      BEFORE UPDATE ON public.timers
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- Realtime, or a timer started on a phone never reaches the kitchen panel:
-- `use-realtime.ts` subscribes to the table, but a table outside the
-- publication emits nothing and the subscription just sits there quietly.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND tablename='timers') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.timers;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
