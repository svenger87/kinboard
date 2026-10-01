-- Server-side settings unlock (RFC-010 §3.5).
--
-- The settings PIN used to be enforced only in the browser: PinGuard asked
-- for it before rendering Settings, but /api/pin's "set"/"remove" and
-- /api/integration-tokens took any device session at all. A joined device
-- could therefore drop the PIN with one POST, set its own, and connect an
-- assistant — the PIN guarded the screen, not the actions behind it.
--
-- A correct PIN entry now records an unlock on the device session that made
-- it, valid for 15 minutes; the routes that change the PIN, mint or revoke
-- integration tokens, or switch AI assistants on check it on the server.
-- It lives on device_sessions rather than in memory so it survives a server
-- restart and is per device: unlocking the kitchen tablet does not unlock a
-- phone in the same family.
--
-- Sorts after migration_device_sessions.sql ('s' > 'd'), which creates the
-- table. Safe to run twice: the entrypoint applies every file on every start.

ALTER TABLE public.device_sessions
  ADD COLUMN IF NOT EXISTS settings_unlocked_until TIMESTAMPTZ;
