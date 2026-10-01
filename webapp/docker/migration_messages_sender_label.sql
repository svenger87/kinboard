-- migration_messages_sender_label.sql
-- Who sent a message, when it was not a person at a screen. RFC-011 §7.
--
-- A message from an assistant (`send_message`, Integration API) has no
-- sender device, so a screen could not tell it from one a family member
-- typed. `sender_label` carries the assistant connection's name (cut to 40
-- characters by the server); the screens show "via <label>". NULL for every
-- message a person sends, and for every message sent before this column
-- existed.
--
-- Idempotent: sorts after migration_messages.sql, which creates the table,
-- and is safe to apply any number of times.

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS sender_label TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'messages_sender_label_length'
      AND conrelid = 'public.messages'::regclass
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_sender_label_length
      CHECK (sender_label IS NULL OR char_length(sender_label) BETWEEN 1 AND 100);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
