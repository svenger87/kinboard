-- migration_zzzzzzzz_reward_notifications.sql -- a per-device switch for the
-- reward pushes (RFC-017).
--
--   notification_preferences.reward_requests
--       Whether this device is told about rewards: on a parent's phone, that a
--       child asked for one ("Mia would like 🎮 An hour of Minecraft
--       (50 ⭐)"); on a child's own device, that their request was answered.
--       On by default, like every other kind of push. Settings → Notifications.
--
-- The pushes themselves are queued in scheduled_notifications as
-- `reward_requested` and `reward_decided` (lib/notifications/rewards.ts), and
-- the processor applies this switch and the device's quiet hours as for every
-- other type (lib/notifications/delivery.ts).
--
-- WHO MAY WRITE IT. The browser, as every other column of this table: each
-- device writes its own preferences under the table's family-scoped policy
-- (notification_preferences_family_scope). No column grants on this table,
-- so the new column is writable exactly like its neighbours.
--
-- Sorted after init.sql, which creates the table. It touches neither devices
-- nor any pocket_money_* table, so it needs no place relative to the device
-- owner's revoke or the pocket-money revoke; the eight-z prefix keeps it in
-- the creatures' block. Idempotent.

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS reward_requests BOOLEAN DEFAULT true;

COMMENT ON COLUMN public.notification_preferences.reward_requests IS
  'Push this device about rewards: a child asking for one (parents), or an answer to the '
  'child''s own request (the child''s device). RFC-017; lib/notifications/rewards.ts.';

NOTIFY pgrst, 'reload schema';
