-- One row in every family-owned table for the family :'fam' (RLS matrix,
-- e2e/rls-matrix.spec.ts; RFC-024 §6.5). Run as the superuser, twice, once
-- per family, so each family's token has the other family's rows to try on
-- every table. The spec fails for any table with row-level security that has
-- no row here for either family: a new table needs a line in this file.
--
-- Values are the smallest that satisfy the table's NOT NULL and CHECK
-- constraints; nothing here is meant to look like real data.
\set ON_ERROR_STOP 1
BEGIN;
\set m '''rls-matrix'''

INSERT INTO people (family_id, name) VALUES (:'fam', :m);
INSERT INTO devices (family_id, name, person_id) VALUES (:'fam', :m, (SELECT id FROM people WHERE family_id = :'fam' AND name = :m));
\set person '(SELECT id FROM people WHERE family_id = ' :'fam' ' AND name = ' :m ')'
\set device '(SELECT id FROM devices WHERE family_id = ' :'fam' ' AND name = ' :m ')'

INSERT INTO calendars (family_id, name, person_id) VALUES (:'fam', :m, :person);
\set calendar '(SELECT id FROM calendars WHERE family_id = ' :'fam' ' AND name = ' :m ')'
INSERT INTO event_series (family_id, calendar_id, rule, time_zone, first_start_at, first_end_at, title, generated_through)
  VALUES (:'fam', :calendar, 'FREQ=WEEKLY', 'Europe/Berlin', now(), now() + interval '1 hour', :m, current_date);
INSERT INTO events (calendar_id, title, start_at, end_at) VALUES (:calendar, :m, now(), now() + interval '1 hour');

INSERT INTO todos (family_id, title, person_id) VALUES (:'fam', :m, :person);
\set todo '(SELECT id FROM todos WHERE family_id = ' :'fam' ' AND title = ' :m ')'
INSERT INTO todo_occurrences (family_id, todo_id, day, status) VALUES (:'fam', :todo, current_date, 'open');
INSERT INTO todo_events (family_id, kind, todo_id) VALUES (:'fam', 'created', :todo);
INSERT INTO todo_point_awards (family_id, person_id, completion_key, points, kind, todo_id)
  VALUES (:'fam', :person, 'rls-matrix', 1, 'task', :todo);

INSERT INTO shopping_items (family_id, name) VALUES (:'fam', :m);
INSERT INTO item_catalog (family_id, name, name_normalized) VALUES (:'fam', :m, :m);
INSERT INTO subjects (family_id, name) VALUES (:'fam', :m);
INSERT INTO schedules (family_id, person_id, day_of_week) VALUES (:'fam', :person, 1);
INSERT INTO birthdays (family_id, name, date) VALUES (:'fam', :m, '2000-01-01');
INSERT INTO birthday_gift_ideas (family_id, birthday_id, text)
  VALUES (:'fam', (SELECT id FROM birthdays WHERE family_id = :'fam' AND name = :m), :m);
INSERT INTO notes (family_id, content) VALUES (:'fam', :m);
INSERT INTO settings (family_id, key, value) VALUES (:'fam', 'rls-matrix', '{}');

INSERT INTO recipes (family_id, title) VALUES (:'fam', :m);
\set recipe '(SELECT id FROM recipes WHERE family_id = ' :'fam' ' AND title = ' :m ')'
INSERT INTO recipe_ingredients (recipe_id, name) VALUES (:recipe, :m);
INSERT INTO recipe_tags (family_id, name) VALUES (:'fam', :m);
INSERT INTO recipe_tag_assignments (recipe_id, tag_id)
  VALUES (:recipe, (SELECT id FROM recipe_tags WHERE family_id = :'fam' AND name = :m));
INSERT INTO meal_plans (family_id, week_start) VALUES (:'fam', date_trunc('week', now())::date);
INSERT INTO meal_plan_entries (meal_plan_id, date, meal_type)
  VALUES ((SELECT id FROM meal_plans WHERE family_id = :'fam'), current_date, 'dinner');

INSERT INTO push_subscriptions (device_id, family_id, endpoint, p256dh_key, auth_key)
  VALUES (:device, :'fam', 'https://push.invalid/' || :'fam', 'k', 'a');
INSERT INTO notification_preferences (family_id, device_id) VALUES (:'fam', :device);
INSERT INTO notification_logs (family_id, notification_type, title) VALUES (:'fam', :m, :m);
INSERT INTO scheduled_notifications (family_id, notification_type, scheduled_for, title) VALUES (:'fam', :m, now() + interval '1 day', :m);
INSERT INTO device_sessions (token_hash, family_id, device_id, expires_at)
  VALUES ('rls-matrix-' || :'fam', :'fam', :device, now() + interval '1 day');

INSERT INTO rooms (family_id, name) VALUES (:'fam', :m);
INSERT INTO catalogue_items (family_id, kind, name, builtin_key) VALUES (:'fam', 'builtin', :m, 'rls-matrix');
INSERT INTO context_rules (family_id, rule_id) VALUES (:'fam', 'rls-matrix');
INSERT INTO attention_items (family_id, rule_id, item_key, title) VALUES (:'fam', 'rls-matrix', 'rls-matrix', :m);
INSERT INTO camera_takeovers (family_id, camera_id, ends_at) VALUES (:'fam', 'rls-matrix', now() + interval '1 minute');
INSERT INTO media_players (family_id, driver, nickname) VALUES (:'fam', 'home_assistant', :m);
INSERT INTO messages (family_id, body) VALUES (:'fam', :m);
INSERT INTO assistant_action_requests (family_id, client_name, expires_at, kind)
  VALUES (:'fam', :m, now() + interval '1 hour', 'pocket_money');
INSERT INTO layouts (family_id, name, width, height) VALUES (:'fam', :m, 1080, 1920);
INSERT INTO family_photos (family_id, storage_path, mime_type, byte_size) VALUES (:'fam', 'rls-matrix/' || :'fam', 'image/png', 1);
INSERT INTO kept_images (family_id, local_url, source_url) VALUES (:'fam', '/rls-matrix/' || :'fam', 'https://images.invalid/' || :'fam');
INSERT INTO bring_removals (family_id, bring_item_id) VALUES (:'fam', 'rls-matrix');
INSERT INTO integration_secrets (family_id, key) VALUES (:'fam', 'rls-matrix');
INSERT INTO oauth_credentials (family_id, provider, encrypted_refresh_token) VALUES (:'fam', 'rls-matrix', 'x');
INSERT INTO tickers (family_id, symbol, asset_type) VALUES (:'fam', 'RLS', 'stock');
INSERT INTO timers (family_id, duration_seconds) VALUES (:'fam', 60);
INSERT INTO vehicles (family_id, vendor, nickname) VALUES (:'fam', 'generic-ev', :m);
INSERT INTO school_holidays (family_id, name, starts_on, ends_on) VALUES (:'fam', :m, current_date, current_date);

INSERT INTO pocket_money_accounts (family_id, person_id) VALUES (:'fam', :person);
\set account '(SELECT id FROM pocket_money_accounts WHERE family_id = ' :'fam' ')'
INSERT INTO pocket_money_goals (account_id, name, target_amount_cents) VALUES (:account, :m, 100);
INSERT INTO pocket_money_transactions (account_id, amount_cents, type) VALUES (:account, 100, 'manual_deposit');
INSERT INTO pocket_money_withdrawal_requests (account_id, amount_cents) VALUES (:account, 1);
INSERT INTO point_rewards (family_id, title, cost_points) VALUES (:'fam', :m, 1);
INSERT INTO point_redemptions (family_id, title, cost_points, person_id) VALUES (:'fam', :m, 1, :person);
INSERT INTO point_purchases (family_id, person_id, item_id, cost) VALUES (:'fam', :person, 'rls_matrix', 1);
INSERT INTO creatures (person_id, family_id) VALUES (:person, :'fam') ON CONFLICT DO NOTHING;
COMMIT;
