-- Deleting a device now deletes its sessions.
--
-- The foreign key was ON DELETE SET NULL, so removing a device left its
-- session row behind with a null device_id. That mattered more than it looks:
-- validateSession() only checks revoked_at and expires_at, and nothing in the
-- app calls revokeSession() or revokeFamilySessions() — so the credential kept
-- working until it expired on its own.
--
-- Removing a device from Settings → Family → Devices is exactly what a family
-- does about a phone that was lost or handed on. It has to end the session,
-- not just forget the name attached to it. Devices are deleted straight from
-- the browser through PostgREST, so the database is the only place that can
-- guarantee it — an app-side revoke could always be bypassed by calling the
-- API directly.
--
-- The existing null-device rows are deleted rather than left to expire: each
-- one is a session belonging to a device somebody already chose to remove.
--
-- Safe to run more than once.

-- Kill the sessions of already-deleted devices. A session is only ever created
-- alongside a device (see /api/session/join and /api/session/create), so a null
-- device_id means the device was removed after the fact.
DELETE FROM public.device_sessions WHERE device_id IS NULL;

ALTER TABLE public.device_sessions
    DROP CONSTRAINT IF EXISTS device_sessions_device_id_fkey;

ALTER TABLE public.device_sessions
    ADD CONSTRAINT device_sessions_device_id_fkey
    FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;
