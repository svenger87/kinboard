-- fill-every-table.sql: after seed-demo.sql, one or more rows in every table
-- of `public` the demo family leaves empty, so an export/import is checked on
-- every table rather than on the ones a demo happens to use. Rows belong to
-- the demo family (DEMO01). Text values carry what COPY must escape (tab,
-- newline, backslash, a quote) and characters outside ASCII, and NULLs sit
-- next to empty strings, so a lossy round trip changes a checksum.
--
-- Dummies only: no real token, key or address. Run as supabase_admin with
-- ON_ERROR_STOP; idempotent (ON CONFLICT DO NOTHING / fixed ids).
\set ON_ERROR_STOP 1
SET session_replication_role = replica;  -- the demo's own triggers (change feed, soft delete) stay quiet
DO $fill$
DECLARE
  fam uuid := (SELECT id FROM families WHERE join_code = 'DEMO01');
  dev uuid := (SELECT id FROM devices WHERE family_id = (SELECT id FROM families WHERE join_code = 'DEMO01') ORDER BY created_at LIMIT 1);
  per uuid := (SELECT id FROM people  WHERE family_id = (SELECT id FROM families WHERE join_code = 'DEMO01') ORDER BY created_at LIMIT 1);
  acct uuid := (SELECT a.id FROM pocket_money_accounts a JOIN people p ON p.id = a.person_id WHERE p.family_id = (SELECT id FROM families WHERE join_code = 'DEMO01') LIMIT 1);
  cal uuid := (SELECT id FROM calendars WHERE family_id = (SELECT id FROM families WHERE join_code = 'DEMO01') LIMIT 1);
  todo uuid := (SELECT id FROM todos WHERE family_id = (SELECT id FROM families WHERE join_code = 'DEMO01') LIMIT 1);
  rec uuid := (SELECT id FROM recipes WHERE family_id = (SELECT id FROM families WHERE join_code = 'DEMO01') LIMIT 1);
  tag uuid := (SELECT id FROM recipe_tags WHERE family_id = (SELECT id FROM families WHERE join_code = 'DEMO01') LIMIT 1);
  goal uuid := '6b1c0000-0000-4000-8000-000000000001';
  tok uuid := '6b1c0000-0000-4000-8000-000000000002';
  rew uuid := '6b1c0000-0000-4000-8000-000000000003';
  awkward text := E'tab\there, line\nbreak, back\\slash, it''s "quoted" – Grüße 👪 家';
BEGIN
  IF fam IS NULL THEN RAISE EXCEPTION 'fill-every-table: no DEMO01 family (run seed-demo.sql first)'; END IF;
  IF dev IS NULL THEN
    INSERT INTO devices (family_id, name, hardware_id) VALUES (fam, 'claude-mig-fill-device', 'claude-mig-fill-device') RETURNING id INTO dev;
  END IF;

  INSERT INTO pocket_money_goals (id, account_id, name, target_amount_cents, image_url, image_source, status)
    VALUES (goal, acct, 'Bike – Fahrrad 🚲', 12999, NULL, 'catalog', 'active') ON CONFLICT DO NOTHING;
  INSERT INTO pocket_money_transactions (account_id, amount_cents, type, note, related_goal_id)
    VALUES (acct, 500, 'allowance', awkward, goal), (acct, -120, 'withdrawal', '', NULL), (acct, 3, 'interest', NULL, NULL);
  INSERT INTO pocket_money_withdrawal_requests (account_id, amount_cents, reason, status) VALUES (acct, 250, 'Kino', 'pending');
  INSERT INTO point_rewards (id, family_id, title, cost_points, icon, active) VALUES (rew, fam, 'Extra story', 30, '📚', true) ON CONFLICT DO NOTHING;
  INSERT INTO point_redemptions (family_id, account_id, reward_id, title, icon, cost_points, status, person_id)
    VALUES (fam, acct, rew, 'Extra story', '📚', 30, 'approved', per);
  INSERT INTO point_purchases (family_id, person_id, item_id, cost) VALUES (fam, per, 'hat_wizard', 15);
  INSERT INTO todo_point_awards (family_id, person_id, todo_id, completion_key, points, kind, note)
    VALUES (fam, per, todo, 'mig-fill-' || todo, 5, 'task', NULL), (fam, per, NULL, 'mig-fill-adj', -2, 'adjustment', awkward);
  INSERT INTO todo_occurrences (family_id, todo_id, day, person_id, status, completed_at, completed_by)
    VALUES (fam, todo, current_date - 1, per, 'done', now() - interval '1 day', per), (fam, todo, current_date, per, 'open', NULL, NULL) ON CONFLICT DO NOTHING;
  INSERT INTO creatures (person_id, family_id, species, style, look, best_tier, last_seen_tier, grows_with, shop_enabled, enabled)
    VALUES (per, fam, 'fox', 'storybook', '{"hat":"wizard","colour":"#ff8800"}', 3, 2, 'points', true, true) ON CONFLICT DO NOTHING;

  INSERT INTO event_series (family_id, calendar_id, rule, time_zone, first_start_at, first_end_at, all_day, title, description, location, person_id, generated_through, skipped_days)
    VALUES (fam, cal, 'FREQ=WEEKLY;BYDAY=TU', 'Europe/Berlin', date_trunc('day', now()) + interval '17 hours', date_trunc('day', now()) + interval '18 hours',
            false, 'Schwimmen', awkward, 'Hallenbad', per, current_date + 90, ARRAY[current_date + 14]);
  INSERT INTO timers (family_id, label, duration_seconds, started_at, paused_at, paused_seconds) VALUES (fam, 'Pizza', 720, now(), now(), 30);
  INSERT INTO layouts (family_id, name, width, height, home, screensaver, grid)
    VALUES (fam, 'Küche', 1080, 1920, '{"cards":[{"type":"clock","x":0,"y":0,"w":4,"h":2},{"type":"agenda","x":0,"y":2,"w":4,"h":6}]}', '{"mode":"photos"}', 8);

  INSERT INTO attention_items (family_id, rule_id, item_key, title, detail, evidence, priority, context, state, message_key, params)
    VALUES (fam, 'birthday_soon', 'mig-fill-1', 'Oma hat Geburtstag', awkward, '{"days":3}', 2, 'home', 'active', 'attention.birthday', '{"name":"Oma"}') ON CONFLICT DO NOTHING;
  INSERT INTO context_rules (family_id, rule_id, enabled, config) VALUES (fam, 'birthday_soon', true, '{"days":7}') ON CONFLICT DO NOTHING;

  INSERT INTO family_photos (family_id, storage_path, thumbnail_path, mime_type, byte_size, width, height, taken_at)
    VALUES (fam, fam || '/mig-fill-photo.jpg', NULL, 'image/jpeg', 1234, 640, 480, now() - interval '30 days');
  INSERT INTO kept_images (family_id, local_url, source_url) VALUES (fam, '/storage/v1/object/public/recipe-images/' || fam || '/kept.jpg', 'https://example.invalid/kept.jpg') ON CONFLICT DO NOTHING;
  INSERT INTO recipe_tag_assignments (recipe_id, tag_id) SELECT rec, tag WHERE rec IS NOT NULL AND tag IS NOT NULL ON CONFLICT DO NOTHING;

  -- Integrations, OAuth and the assistant: hashes and ciphertext are dummies.
  INSERT INTO integration_tokens (id, family_id, name, token_hash, scopes, expires_at, oauth_client_id, resource, refresh_token_hash, refresh_expires_at)
    VALUES (tok, fam, 'Home Assistant', encode(sha256('mig-fill-token'), 'hex'), ARRAY['calendar:read','todos:write'], now() + interval '1 year',
            'mig-fill-client', 'http://localhost/api/mcp', encode(sha256('mig-fill-refresh'), 'hex'), now() + interval '2 years') ON CONFLICT DO NOTHING;
  INSERT INTO integration_clients (family_id, token_id, client_type, client_version, capabilities) VALUES (fam, tok, 'home_assistant', '1.2.3', '["calendar","todos"]');
  INSERT INTO integration_idempotency (family_id, idempotency_key, service, request_hash, status, response)
    VALUES (fam, 'mig-fill-idem', 'todos', encode(sha256('x'), 'hex'), 201, '{"ok":true}') ON CONFLICT DO NOTHING;
  INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES ('mig-fill-client', 'Claude-free test client', ARRAY['https://example.invalid/cb']) ON CONFLICT DO NOTHING;
  INSERT INTO oauth_authorization_requests (client_id, client_name, redirect_uri, state, code_challenge, scopes, resource, expires_at, family_id, granted_scopes, code_hash, used_at)
    VALUES ('mig-fill-client', 'test client', 'https://example.invalid/cb', 's', repeat('a', 43), ARRAY['calendar:read'], 'http://localhost/api/mcp', now() + interval '10 minutes', fam, ARRAY['calendar:read'], encode(sha256('code'), 'hex'), now());
  INSERT INTO oauth_credentials (family_id, provider, encrypted_refresh_token, encrypted_access_token, token_expires_at)
    VALUES (fam, 'google', 'v1:' || encode(sha256('refresh-dummy'), 'base64'), 'v1:' || encode(sha256('access-dummy'), 'base64'), now() + interval '1 hour');
  INSERT INTO assistant_action_requests (family_id, token_id, client_name, entity_id, entity_name, domain, service, data, status, expires_at, kind)
    VALUES (fam, tok, 'Claude-free test client', 'light.kitchen', 'Kitchen light', 'light', 'turn_on', '{"brightness":128}', 'pending', now() + interval '1 hour', 'home');
  INSERT INTO notification_logs (family_id, device_id, notification_type, title, body, data, status)
    VALUES (fam, dev, 'event_reminder', 'Schwimmen', awkward, '{"event":"x"}', 'sent');
  INSERT INTO push_subscriptions (device_id, family_id, endpoint, p256dh_key, auth_key, user_agent, is_active)
    VALUES (dev, fam, 'https://push.example.invalid/mig-fill/' || dev, 'BMigFillDummyP256dhKey', 'MigFillAuth', 'rig', true) ON CONFLICT DO NOTHING;
  INSERT INTO camera_takeovers (family_id, camera_id, device_ids, ends_at) VALUES (fam, 'doorbell', ARRAY[dev], now() + interval '4 minutes') ON CONFLICT DO NOTHING;
  INSERT INTO bring_removals (family_id, bring_item_id, bring_list_id) VALUES (fam, 'bring-mig-fill', 'list-1');
  -- integration_secrets: the plain JSON the server keeps credentials in.
  INSERT INTO integration_secrets (family_id, key, value) VALUES (fam, 'immich', '{"api_key":"mig-fill-immich-dummy"}'),
    (fam, 'home_assistant', '{"access_token":"mig-fill-ha-dummy"}') ON CONFLICT DO NOTHING;
END
$fill$;

-- From 095 on, a subscription records the key it was made with, as the app
-- does when it saves one; an older install's start fills it in (a 1.17 install
-- gets it at its update). Without it here, the target's start would fill it
-- in after an import and the table would differ for a reason of the rig's own.
DO $fp$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'push_subscriptions' AND column_name = 'vapid_key_fingerprint') THEN
    EXECUTE $u$UPDATE public.push_subscriptions SET vapid_key_fingerprint = (SELECT value FROM public.instance_settings WHERE key = 'push_vapid_key')
             WHERE vapid_key_fingerprint IS NULL AND EXISTS (SELECT 1 FROM public.instance_settings WHERE key = 'push_vapid_key')$u$;
  END IF;
END
$fp$;
