-- migration_fingerprint_history.sql
--
-- Adds devices.fingerprint_history TEXT[] so device recognition
-- survives browser/OS updates that change the fingerprint hash.
--
-- Background: getDeviceFingerprint() (webapp/src/lib/device-id.ts)
-- derives a hash from navigator inputs. Some of those (UA string,
-- deviceMemory) drift across browser updates. After a Safari/Chrome
-- update, today's fingerprint != yesterday's, and the device row
-- becomes unrecognizable until the user manually re-joins via the
-- family code.
--
-- The new array tracks every fingerprint a given device has presented
-- successfully. The recognition lookup checks fingerprint == X OR
-- X = ANY(fingerprint_history); matches append the new fingerprint
-- to history. After one successful login post-update, future wipes
-- recover automatically.
--
-- Idempotent: type-guarded so start.sh's run_migrations applies on
-- every boot without diverging.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'devices'
      AND column_name = 'fingerprint_history'
  ) THEN
    ALTER TABLE public.devices
      ADD COLUMN fingerprint_history TEXT[] NOT NULL DEFAULT '{}';

    -- Backfill: for every existing device with a fingerprint, seed
    -- the history with that single value. Devices that never set a
    -- fingerprint stay with the empty-array default.
    UPDATE public.devices
       SET fingerprint_history = ARRAY[fingerprint]
     WHERE fingerprint IS NOT NULL
       AND fingerprint <> ''
       AND fingerprint_history = '{}';
  END IF;

  -- GIN index for `= ANY(fingerprint_history)` lookups. Cheap on
  -- low-row-count tables (devices is per-family + a small handful
  -- per family) but matters under load.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'devices'
      AND indexname = 'idx_devices_fingerprint_history'
  ) THEN
    CREATE INDEX idx_devices_fingerprint_history
      ON public.devices USING GIN (fingerprint_history);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
