-- migration_zzzzzzzzz_device_owner.sql — a device can belong to a person
-- (RFC-017 §8.2, step 2).
--
--   devices.person_id   who the device belongs to, or NULL (the family's).
--                       A non-kiosk device that belongs to a child with a
--                       creature opens on that child's Rewards page; a kiosk
--                       ignores it. Set under Settings -> Devices.
--
-- ON DELETE SET NULL: deleting the person leaves the device, belonging to
-- nobody. A person in the recycle bin keeps the link (soft delete is not a
-- delete); the screens read the child's creature through RLS, which already
-- hides a binned child, so such a device simply opens on the dashboard.
--
-- WHO MAY WRITE IT. Only the server: PATCH /api/devices/[id], behind the
-- settings PIN. Everything else about a device the browser keeps writing
-- itself, as before -- its name, the kiosk and presence switches, the
-- heartbeat's last_seen -- so this file does not take the browser's write
-- privileges away from the table. It narrows them to columns: INSERT and
-- UPDATE are revoked at table level from anon and authenticated, and granted
-- back on every column except person_id. A family token -- any screen in the
-- household, the child's own phone included -- can then not hand a device to
-- someone by writing the column directly:
--
--   UPDATE devices SET person_id = ...   -> permission denied for table devices
--
-- The grant-back names every column but person_id (below).
-- SELECT, DELETE and the RLS policy (devices_family_scope) are untouched.
--
-- Sorted after every other migration (`zzzzzzzzz`): the revoke must come after
-- anything that grants on devices, and the ALTER after init.sql, which creates
-- the table. Idempotent: ADD COLUMN IF NOT EXISTS, and REVOKE/GRANT of what is
-- already revoked/granted are no-ops.

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS person_id UUID REFERENCES public.people(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_devices_person ON public.devices(person_id) WHERE person_id IS NOT NULL;

COMMENT ON COLUMN public.devices.person_id IS
  'Who the device belongs to (RFC-017 §8.2), or NULL. Written only by the server '
  '(PATCH /api/devices/[id], settings PIN); the browser roles have no INSERT or '
  'UPDATE privilege on this column.';

-- Spelled out, not built from information_schema with format(): every grant a
-- migration makes is then readable by the grants guards
-- (e2e/pocket-money-grants.spec.ts reads every migration after its revoke).
-- The list is every column of devices but person_id; a column added later is
-- not writable by the browser until it is added here, which fails closed, and
-- e2e/device-owner-db.spec.ts names the column it finds missing.
--
-- Revoke first, then grant: a table-level REVOKE also takes away the column
-- privileges, so the other order would leave the browser with none.
--
-- Only once every column named exists. On a fresh install's first pass one
-- may not yet (start.sh migrate runs twice, the container entrypoint
-- retries), and a GRANT naming it would fail after the revokes had already
-- run, leaving the browser unable to write its own device row -- the
-- heartbeat, a join -- until the next pass. Skipped instead, with a warning;
-- the next pass applies it.
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'devices'
         AND column_name IN ('id', 'family_id', 'name', 'user_agent', 'is_kiosk', 'has_presence_sensor',
                             'last_seen', 'created_at', 'fingerprint', 'hardware_id', 'fingerprint_history')) <> 11 THEN
    RAISE WARNING 'devices is missing a column this migration grants; person_id is left writable until the next run';
    RETURN;
  END IF;

  REVOKE INSERT, UPDATE ON TABLE public.devices FROM anon, authenticated;
  -- Column privileges are separate from the table's: an old column-level
  -- grant on person_id would survive the table-level revoke.
  REVOKE INSERT (person_id), UPDATE (person_id) ON TABLE public.devices FROM anon, authenticated;
  GRANT
    INSERT (id, family_id, name, user_agent, is_kiosk, has_presence_sensor, last_seen, created_at,
            fingerprint, hardware_id, fingerprint_history),
    UPDATE (id, family_id, name, user_agent, is_kiosk, has_presence_sensor, last_seen, created_at,
            fingerprint, hardware_id, fingerprint_history)
    ON TABLE public.devices TO anon, authenticated;
END $$;
