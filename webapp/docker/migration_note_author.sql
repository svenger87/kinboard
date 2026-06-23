-- migration_note_author.sql — optional author (person) per note.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notes' AND column_name='person_id') THEN
    ALTER TABLE public.notes
      ADD COLUMN person_id UUID REFERENCES public.people(id) ON DELETE SET NULL;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
