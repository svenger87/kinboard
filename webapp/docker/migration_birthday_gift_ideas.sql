-- migration_birthday_gift_ideas.sql — gift ideas per birthday.
CREATE TABLE IF NOT EXISTS public.birthday_gift_ideas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  birthday_id UUID NOT NULL REFERENCES public.birthdays(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  bought BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gift_ideas_birthday ON public.birthday_gift_ideas(birthday_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND tablename='birthday_gift_ideas') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.birthday_gift_ideas;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
