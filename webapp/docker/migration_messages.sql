-- migration_messages.sql
-- Messages said to the whole house. RFC-005 §2.
--
-- A note is a document; a message is an event. It is finished when somebody
-- says they have seen it, which is why `acknowledged_at` is the end of its life
-- and there is no soft-delete column here — a message does not belong in the
-- recycle bin.
--
-- The sender is a device rather than a person because the delivery rule is
-- "every screen but the one that sent it", and Kinboard has no per-person
-- login to make a person id anything but a guess.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'messages'
  ) THEN
    CREATE TABLE public.messages (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
      body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 200),
      -- SET NULL, not CASCADE: removing a device from Settings must not delete
      -- the household's messages. A message whose sender has since been
      -- removed is still a message, and shows on every screen — which is the
      -- right failure, since hiding it from everyone would be worse.
      sender_device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
      acknowledged_at TIMESTAMPTZ,
      acknowledged_by_device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- The widget reads "everything not yet acknowledged", newest first.
    CREATE INDEX messages_family_id_acknowledged_idx
      ON public.messages (family_id, acknowledged_at, created_at DESC);
  END IF;
END $$;

-- Realtime, or a message typed on a phone never reaches the kitchen panel:
-- `use-realtime.ts` subscribes to the table, but a table outside the
-- publication emits nothing and the subscription sits there quietly. This is
-- exactly how `timers` shipped working on one machine and dead everywhere else.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
