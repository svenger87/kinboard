-- migration_media_players.sql
-- One row per configured media player. RFC-003 §3.
--
-- Mirrors `vehicles`: the driver owns the protocol, the row owns the naming
-- and ordering, so a driver swap does not lose what the household called it.
--
-- Credentials do NOT belong in `config` — they go in integration_secrets,
-- the lesson the settings PIN taught when it lived in an anon-readable table.
-- M1 stores no credentials here at all: the Home Assistant driver's live in
-- the existing home_assistant settings row.
--
-- Idempotent: guarded so start.sh's run_migrations can apply it on every boot.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'media_players'
  ) THEN
    CREATE TABLE public.media_players (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      -- Adding a driver later needs DROP CONSTRAINT + ADD CONSTRAINT;
      -- Postgres has no ADD CONSTRAINT IF NOT EXISTS for CHECKs.
      driver TEXT NOT NULL CHECK (driver IN ('home_assistant')),
      nickname TEXT NOT NULL,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX media_players_family_id_position_idx
      ON public.media_players (family_id, position);

    -- update_updated_at is defined in init.sql and used by every table there.
    CREATE TRIGGER media_players_set_updated_at
      BEFORE UPDATE ON public.media_players
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
