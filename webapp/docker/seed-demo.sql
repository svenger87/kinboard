-- Kinboard — demo family seed.
--
-- Apply explicitly when you want a populated dataset for the public
-- demo box, dev iteration, or screenshots:
--
--   docker exec -i kinboard-db \
--     psql -U postgres -d postgres < webapp/docker/seed-demo.sql
--
-- Or via the helper script:
--
--   ./webapp/docker/start.sh seed-demo
--
-- Idempotent: the demo family is wiped before re-insert so the script
-- always produces the same known-good state. Active browser sessions
-- attached to the demo family see the orphan-cookie redirect (1.0.4+)
-- and get bounced to /join — by design, fresh state for visitors.
--
-- Dates are relative to CURRENT_DATE so events stay current without
-- re-running the seed every week.

BEGIN;

-- =========================================================================
-- Wipe-and-reset
-- =========================================================================
-- Cascades through FKs: devices, people, calendars, events, todos,
-- shopping_items, subjects, schedules, birthdays, notes, recipes,
-- recipe_ingredients, recipe_tags, meal_plans, meal_plan_entries.
DELETE FROM public.families WHERE id = '00000000-0000-0000-0000-000000000001';

-- =========================================================================
-- Family + join code
-- =========================================================================
INSERT INTO public.families (id, name, join_code) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Demo Family', 'DEMO01');

-- =========================================================================
-- People (2 parents, 2 kids — gender-neutral names for a public demo)
-- =========================================================================
INSERT INTO public.people (id, family_id, name, color) VALUES
    ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'Alex',   '#3b82f6'),
    ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'Sam',    '#ec4899'),
    ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000001', 'Riley',  '#a855f7'),
    ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000001', 'Jordan', '#22c55e'),
    ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000001', 'Casey',  '#f59e0b');

-- =========================================================================
-- Devices — one fingerprinted "kitchen kiosk" so the family looks active
-- =========================================================================
INSERT INTO public.devices (id, family_id, name, fingerprint, hardware_id, is_kiosk, last_seen) VALUES
    ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000001',
     'Kitchen Kiosk', 'demo-kiosk-fingerprint', 'demo-kiosk-hwid', true, NOW());

-- =========================================================================
-- Calendars (one per person + family + holidays)
-- =========================================================================
INSERT INTO public.calendars (id, family_id, person_id, name, color, sync_enabled, is_holidays) VALUES
    ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', NULL,
     'Family',    '#6366f1', true, false),
    ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1',
     'Alex',      '#3b82f6', true, false),
    ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2',
     'Sam',       '#ec4899', true, false),
    ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3',
     'Riley',     '#a855f7', true, false),
    ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a4',
     'Jordan',    '#22c55e', true, false),
    ('00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a5',
     'Casey',     '#f59e0b', true, false),
    ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-000000000001', NULL,
     'Holidays',  '#dc2626', false, true);

-- =========================================================================
-- Events (next 2 weeks, distributed across people)
-- =========================================================================
INSERT INTO public.events (calendar_id, title, description, location, start_at, end_at, all_day, person_id) VALUES
    -- Today
    ('00000000-0000-0000-0000-0000000000b1', 'Family movie night',         'Bring popcorn',       'Living room',
     (CURRENT_DATE + TIME '19:30')::timestamptz, (CURRENT_DATE + TIME '21:30')::timestamptz, false, NULL),

    -- Tomorrow
    ('00000000-0000-0000-0000-0000000000b2', 'Dentist appointment',        '6-month checkup',     'Dr. Becker',
     ((CURRENT_DATE + 1) + TIME '14:00')::timestamptz, ((CURRENT_DATE + 1) + TIME '14:45')::timestamptz, false,
     '00000000-0000-0000-0000-0000000000a1'),
    ('00000000-0000-0000-0000-0000000000b4', 'Soccer practice',            'Cleats + water',      'School field',
     ((CURRENT_DATE + 1) + TIME '17:00')::timestamptz, ((CURRENT_DATE + 1) + TIME '18:30')::timestamptz, false,
     '00000000-0000-0000-0000-0000000000a3'),

    -- +2 days
    ('00000000-0000-0000-0000-0000000000b5', 'Piano lesson',               '',                    'Mrs. Lin',
     ((CURRENT_DATE + 2) + TIME '16:00')::timestamptz, ((CURRENT_DATE + 2) + TIME '16:45')::timestamptz, false,
     '00000000-0000-0000-0000-0000000000a4'),
    ('00000000-0000-0000-0000-0000000000b3', 'Yoga class',                 '',                    'Studio Nord',
     ((CURRENT_DATE + 2) + TIME '19:00')::timestamptz, ((CURRENT_DATE + 2) + TIME '20:15')::timestamptz, false,
     '00000000-0000-0000-0000-0000000000a2'),

    -- +3 days
    ('00000000-0000-0000-0000-0000000000b1', 'Grandma over for dinner',    'She''s bringing dessert', 'Home',
     ((CURRENT_DATE + 3) + TIME '18:00')::timestamptz, ((CURRENT_DATE + 3) + TIME '21:00')::timestamptz, false, NULL),

    -- +4 days
    ('00000000-0000-0000-0000-0000000000b4', 'Math test',                  'Chapter 7 — fractions', 'School',
     ((CURRENT_DATE + 4) + TIME '09:00')::timestamptz, ((CURRENT_DATE + 4) + TIME '10:00')::timestamptz, false,
     '00000000-0000-0000-0000-0000000000a3'),

    -- +5 days (weekend prep)
    ('00000000-0000-0000-0000-0000000000b1', 'Grocery run',                'Weekly Aldi + Rewe',  '',
     ((CURRENT_DATE + 5) + TIME '10:00')::timestamptz, ((CURRENT_DATE + 5) + TIME '11:30')::timestamptz, false, NULL),

    -- +6 days
    ('00000000-0000-0000-0000-0000000000b1', 'Hiking trip',                'Weather permitting',  'Ardennes',
     (CURRENT_DATE + 6)::timestamptz, (CURRENT_DATE + 6)::timestamptz, true, NULL),

    -- Next week
    ('00000000-0000-0000-0000-0000000000b2', 'Team offsite',               'Q3 planning',         'Hamburg',
     ((CURRENT_DATE + 8) + TIME '09:00')::timestamptz, ((CURRENT_DATE + 8) + TIME '17:00')::timestamptz, false,
     '00000000-0000-0000-0000-0000000000a1'),
    ('00000000-0000-0000-0000-0000000000b5', 'School trip — museum',      'Lunchbox required',   'Naturkundemuseum',
     (CURRENT_DATE + 9)::timestamptz, (CURRENT_DATE + 9)::timestamptz, true,
     '00000000-0000-0000-0000-0000000000a4'),
    ('00000000-0000-0000-0000-0000000000b3', 'Book club',                  'Hanya Yanagihara',    'Café Lieblich',
     ((CURRENT_DATE + 10) + TIME '20:00')::timestamptz, ((CURRENT_DATE + 10) + TIME '22:00')::timestamptz, false,
     '00000000-0000-0000-0000-0000000000a2'),
    ('00000000-0000-0000-0000-0000000000b1', 'Anniversary',                'Reservation at La Trattoria', 'La Trattoria',
     ((CURRENT_DATE + 12) + TIME '19:00')::timestamptz, ((CURRENT_DATE + 12) + TIME '22:30')::timestamptz, false, NULL);

-- =========================================================================
-- Birthdays — relative to today so they always look upcoming
-- =========================================================================
INSERT INTO public.birthdays (family_id, name, date, notify_days_before, person_id) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Riley',
     (CURRENT_DATE + 18 - (EXTRACT(YEAR FROM CURRENT_DATE)::int - 2014) * INTERVAL '1 year')::date,
     7, '00000000-0000-0000-0000-0000000000a3'),
    ('00000000-0000-0000-0000-000000000001', 'Grandma Eve',
     (CURRENT_DATE + 5 - (EXTRACT(YEAR FROM CURRENT_DATE)::int - 1948) * INTERVAL '1 year')::date,
     7, NULL),
    ('00000000-0000-0000-0000-000000000001', 'Uncle Theo',
     (CURRENT_DATE + 32 - (EXTRACT(YEAR FROM CURRENT_DATE)::int - 1976) * INTERVAL '1 year')::date,
     14, NULL),
    ('00000000-0000-0000-0000-000000000001', 'Jordan',
     (CURRENT_DATE + 87 - (EXTRACT(YEAR FROM CURRENT_DATE)::int - 2017) * INTERVAL '1 year')::date,
     7, '00000000-0000-0000-0000-0000000000a4'),
    ('00000000-0000-0000-0000-000000000001', 'Casey',
     (CURRENT_DATE + 51 - (EXTRACT(YEAR FROM CURRENT_DATE)::int - 2020) * INTERVAL '1 year')::date,
     7, '00000000-0000-0000-0000-0000000000a5'),
    ('00000000-0000-0000-0000-000000000001', 'Alex',
     (CURRENT_DATE + 110 - (EXTRACT(YEAR FROM CURRENT_DATE)::int - 1985) * INTERVAL '1 year')::date,
     14, '00000000-0000-0000-0000-0000000000a1'),
    ('00000000-0000-0000-0000-000000000001', 'Sam',
     (CURRENT_DATE + 175 - (EXTRACT(YEAR FROM CURRENT_DATE)::int - 1987) * INTERVAL '1 year')::date,
     14, '00000000-0000-0000-0000-0000000000a2'),
    ('00000000-0000-0000-0000-000000000001', 'Grandpa Mike',
     (CURRENT_DATE + 64 - (EXTRACT(YEAR FROM CURRENT_DATE)::int - 1946) * INTERVAL '1 year')::date,
     7, NULL),
    ('00000000-0000-0000-0000-000000000001', 'Aunt Lia',
     (CURRENT_DATE + 230 - (EXTRACT(YEAR FROM CURRENT_DATE)::int - 1980) * INTERVAL '1 year')::date,
     14, NULL),
    ('00000000-0000-0000-0000-000000000001', 'Cousin Mara',
     (CURRENT_DATE + 9 - (EXTRACT(YEAR FROM CURRENT_DATE)::int - 2012) * INTERVAL '1 year')::date,
     7, NULL);

-- =========================================================================
-- Shopping list (mix of categories + checked state)
-- =========================================================================
INSERT INTO public.shopping_items (family_id, name, checked, category) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Milk',          false, 'Dairy'),
    ('00000000-0000-0000-0000-000000000001', 'Yoghurt',       false, 'Dairy'),
    ('00000000-0000-0000-0000-000000000001', 'Eggs',          false, 'Dairy'),
    ('00000000-0000-0000-0000-000000000001', 'Bread',         false, 'Bakery'),
    ('00000000-0000-0000-0000-000000000001', 'Croissants',    false, 'Bakery'),
    ('00000000-0000-0000-0000-000000000001', 'Apples',        false, 'Produce'),
    ('00000000-0000-0000-0000-000000000001', 'Carrots',       false, 'Produce'),
    ('00000000-0000-0000-0000-000000000001', 'Spinach',       false, 'Produce'),
    ('00000000-0000-0000-0000-000000000001', 'Onions',        true,  'Produce'),
    ('00000000-0000-0000-0000-000000000001', 'Pasta',         false, 'Pantry'),
    ('00000000-0000-0000-0000-000000000001', 'Olive oil',     false, 'Pantry'),
    ('00000000-0000-0000-0000-000000000001', 'Coffee beans',  false, 'Pantry'),
    ('00000000-0000-0000-0000-000000000001', 'Toilet paper',  false, 'Household'),
    ('00000000-0000-0000-0000-000000000001', 'Dish soap',     true,  'Household'),
    ('00000000-0000-0000-0000-000000000001', 'Chicken breast',false, 'Meat'),
    ('00000000-0000-0000-0000-000000000001', 'Salmon',        false, 'Fish');

-- =========================================================================
-- Recipes (5 — covers Chefkoch-style imports + family classics)
-- =========================================================================
INSERT INTO public.recipes (id, family_id, title, description, source_url, source_domain, image_url,
                            servings, prep_time_minutes, cook_time_minutes, total_time_minutes,
                            difficulty, instructions, is_favorite) VALUES
    ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001',
     'Spaghetti Bolognese',
     'The household standard. Make a double batch and freeze half.',
     NULL, NULL, NULL,
     4, 15, 60, 75, 'einfach',
     '["Heat olive oil in a deep pan; brown the ground beef.","Add onion + garlic + carrot; cook 5 min.","Add tomato passata, stock, bay leaf, pinch of nutmeg.","Simmer uncovered 45 min, stirring occasionally.","Cook spaghetti to al dente; drain, reserve a ladle of pasta water.","Toss pasta with sauce + pasta water; finish with parmesan."]'::jsonb,
     true),
    ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000001',
     'Chicken curry (mild)',
     'Kid-approved. No spice; full coconut richness.',
     NULL, NULL, NULL,
     4, 10, 25, 35, 'einfach',
     '["Cube chicken; sear in a wok until edges brown.","Push to side; soften onion + ginger + garlic.","Stir in curry paste; cook 30 sec.","Add coconut milk + chicken stock; simmer 15 min.","Stir in spinach until wilted; finish with lime juice.","Serve over basmati rice."]'::jsonb,
     true),
    ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000001',
     'Sheet-pan salmon + veg',
     'One pan, 25 minutes, healthy.',
     NULL, NULL, NULL,
     4, 10, 20, 30, 'einfach',
     '["Heat oven to 220C.","Toss broccoli + bell pepper + chickpeas with olive oil, salt, paprika.","Spread on a sheet pan; roast 10 min.","Push veg aside; lay salmon fillets, skin down. Brush with miso + maple glaze.","Roast 12 more min until salmon flakes.","Squeeze lemon, scatter sesame seeds."]'::jsonb,
     false),
    ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-000000000001',
     'Pizza dough (overnight)',
     'Friday-night ritual. Make Thursday, bake Friday.',
     NULL, NULL, NULL,
     4, 20, 240, 1440, 'mittel',
     '["Mix flour, salt, yeast (small pinch) with water until shaggy.","Cover; rest 30 min, then 4 stretch-and-folds at 30-min intervals.","Refrigerate overnight (12-24h).","Divide into 4 balls; rest 1h at room temp before stretching.","Top + bake 7 min in a 280C oven on a hot stone.","Don''t skip the resting hours; structure is built by time."]'::jsonb,
     true),
    ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-000000000001',
     'Apple cinnamon overnight oats',
     'Kids assemble these themselves Sunday night for the week.',
     NULL, NULL, NULL,
     4, 5, 0, 5, 'einfach',
     '["Combine oats + milk + yoghurt + chia + maple syrup in 4 jars.","Top each with diced apple + cinnamon + walnut.","Lid, fridge, ready in the morning. Keeps 4 days."]'::jsonb,
     false);

-- Recipe ingredients (just enough to populate the UI; not exhaustive)
INSERT INTO public.recipe_ingredients (recipe_id, name, quantity, unit, sort_order) VALUES
    -- Bolognese
    ('00000000-0000-0000-0000-0000000000c1', 'Ground beef',     500, 'g',   1),
    ('00000000-0000-0000-0000-0000000000c1', 'Onion',           1,   'pc',  2),
    ('00000000-0000-0000-0000-0000000000c1', 'Carrot',          2,   'pc',  3),
    ('00000000-0000-0000-0000-0000000000c1', 'Garlic',          3,   'cloves', 4),
    ('00000000-0000-0000-0000-0000000000c1', 'Tomato passata',  700, 'g',   5),
    ('00000000-0000-0000-0000-0000000000c1', 'Spaghetti',       500, 'g',   6),
    ('00000000-0000-0000-0000-0000000000c1', 'Parmesan',        50,  'g',   7),
    -- Curry
    ('00000000-0000-0000-0000-0000000000c2', 'Chicken breast',  600, 'g',   1),
    ('00000000-0000-0000-0000-0000000000c2', 'Coconut milk',    400, 'ml',  2),
    ('00000000-0000-0000-0000-0000000000c2', 'Mild curry paste',2,   'tbsp',3),
    ('00000000-0000-0000-0000-0000000000c2', 'Spinach',         150, 'g',   4),
    ('00000000-0000-0000-0000-0000000000c2', 'Basmati rice',    300, 'g',   5),
    -- Salmon
    ('00000000-0000-0000-0000-0000000000c3', 'Salmon fillet',   600, 'g',   1),
    ('00000000-0000-0000-0000-0000000000c3', 'Broccoli',        1,   'head',2),
    ('00000000-0000-0000-0000-0000000000c3', 'Bell pepper',     2,   'pc',  3),
    ('00000000-0000-0000-0000-0000000000c3', 'Chickpeas',       400, 'g',   4),
    ('00000000-0000-0000-0000-0000000000c3', 'White miso',      1,   'tbsp',5),
    -- Pizza
    ('00000000-0000-0000-0000-0000000000c4', '00 flour',        500, 'g',   1),
    ('00000000-0000-0000-0000-0000000000c4', 'Water',           325, 'ml',  2),
    ('00000000-0000-0000-0000-0000000000c4', 'Salt',            10,  'g',   3),
    ('00000000-0000-0000-0000-0000000000c4', 'Fresh yeast',     2,   'g',   4),
    -- Oats
    ('00000000-0000-0000-0000-0000000000c5', 'Rolled oats',     200, 'g',   1),
    ('00000000-0000-0000-0000-0000000000c5', 'Milk',            500, 'ml',  2),
    ('00000000-0000-0000-0000-0000000000c5', 'Greek yoghurt',   200, 'g',   3),
    ('00000000-0000-0000-0000-0000000000c5', 'Chia seeds',      2,   'tbsp',4),
    ('00000000-0000-0000-0000-0000000000c5', 'Apple',           2,   'pc',  5);

-- =========================================================================
-- Meal plan — current week
-- =========================================================================
INSERT INTO public.meal_plans (id, family_id, week_start, notes) VALUES
    ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001',
     date_trunc('week', CURRENT_DATE)::date, 'Light week — leftovers Friday');

INSERT INTO public.meal_plan_entries (meal_plan_id, date, meal_type, recipe_id, servings) VALUES
    ('00000000-0000-0000-0000-0000000000e1', date_trunc('week', CURRENT_DATE)::date,                       'dinner', '00000000-0000-0000-0000-0000000000c1', 4),
    ('00000000-0000-0000-0000-0000000000e1', (date_trunc('week', CURRENT_DATE) + interval '1 day')::date,  'dinner', '00000000-0000-0000-0000-0000000000c2', 4),
    ('00000000-0000-0000-0000-0000000000e1', (date_trunc('week', CURRENT_DATE) + interval '2 days')::date, 'dinner', '00000000-0000-0000-0000-0000000000c3', 4),
    ('00000000-0000-0000-0000-0000000000e1', (date_trunc('week', CURRENT_DATE) + interval '3 days')::date, 'dinner', '00000000-0000-0000-0000-0000000000c1', 4),
    ('00000000-0000-0000-0000-0000000000e1', (date_trunc('week', CURRENT_DATE) + interval '4 days')::date, 'dinner', '00000000-0000-0000-0000-0000000000c4', 4),
    ('00000000-0000-0000-0000-0000000000e1', (date_trunc('week', CURRENT_DATE) + interval '6 days')::date, 'dinner', '00000000-0000-0000-0000-0000000000c2', 4);

-- =========================================================================
-- Todos (mix of priorities, assignments, completion states)
-- =========================================================================
INSERT INTO public.todos (family_id, person_id, title, completed, due_date, priority, recurrence) VALUES
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Pay water bill',                 false, CURRENT_DATE + 2,  'high',   'once'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', 'Sign permission slip — museum',  false, CURRENT_DATE + 4,  'medium', 'once'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3', 'Math homework — Chapter 7',      false, CURRENT_DATE + 3,  'medium', 'once'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a4', 'Practice piano (30 min)',        false, CURRENT_DATE,      'low',    'daily'),
    ('00000000-0000-0000-0000-000000000001', NULL,                                    'Take out the recycling',         false, CURRENT_DATE + 1,  'medium', 'weekly'),
    ('00000000-0000-0000-0000-000000000001', NULL,                                    'Water the plants',               false, CURRENT_DATE,      'low',    'weekly'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Book hairdresser',                false, CURRENT_DATE + 7,  'low',    'once'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', 'Renew library books',             true,  CURRENT_DATE - 2,  'low',    'once'),
    ('00000000-0000-0000-0000-000000000001', NULL,                                    'Clean out the fridge',           true,  CURRENT_DATE - 1,  'medium', 'weekly');

-- =========================================================================
-- Notes (a couple pinned, a couple normal)
-- =========================================================================
INSERT INTO public.notes (family_id, content, pinned) VALUES
    ('00000000-0000-0000-0000-000000000001',
     E'# WiFi guests\n**SSID:** KinboardDemo\n**Password:** see fridge magnet',
     true),
    ('00000000-0000-0000-0000-000000000001',
     E'# Babysitter notes\n- Riley''s asthma inhaler in bathroom cabinet (top shelf)\n- Bedtimes: Riley 21:00, Jordan 20:00\n- Emergency: 112',
     true),
    ('00000000-0000-0000-0000-000000000001',
     'Window cleaner comes Wednesday at 10. Leave the side gate unlocked.',
     false),
    ('00000000-0000-0000-0000-000000000001',
     E'Returns to drop off:\n- Amazon parcel (printer cable, wrong type)\n- Library book "The Anthropocene Reviewed"',
     false);

-- =========================================================================
-- Subjects + schedule entries (school week for Riley + Jordan)
-- =========================================================================
INSERT INTO public.subjects (family_id, name, color, icon) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Math',    '#ef4444', 'Calculator'),
    ('00000000-0000-0000-0000-000000000001', 'English', '#3b82f6', 'BookOpen'),
    ('00000000-0000-0000-0000-000000000001', 'German',  '#a855f7', 'Languages'),
    ('00000000-0000-0000-0000-000000000001', 'Physics', '#8b5cf6', 'Atom'),
    ('00000000-0000-0000-0000-000000000001', 'Biology', '#10b981', 'Leaf'),
    ('00000000-0000-0000-0000-000000000001', 'History', '#6b7280', 'Landmark'),
    ('00000000-0000-0000-0000-000000000001', 'PE',      '#ec4899', 'Dumbbell'),
    ('00000000-0000-0000-0000-000000000001', 'Art',     '#f59e0b', 'Palette'),
    ('00000000-0000-0000-0000-000000000001', 'Music',   '#06b6d4', 'Music');

-- day_of_week: 0=Sun, 1=Mon, ..., 6=Sat. time_slot.period numbered 1..n.
INSERT INTO public.schedules (family_id, person_id, day_of_week, time_slots) VALUES
    -- Riley (older kid) — Mon-Fri
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3', 1,
     '[{"period":1,"start":"08:00","end":"08:45","subject":"Math","room":"R201"},{"period":2,"start":"08:50","end":"09:35","subject":"English","room":"R107"},{"period":3,"start":"09:55","end":"10:40","subject":"Biology","room":"R304"},{"period":4,"start":"10:45","end":"11:30","subject":"PE","room":"Gym"}]'::jsonb),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3', 2,
     '[{"period":1,"start":"08:00","end":"08:45","subject":"German","room":"R107"},{"period":2,"start":"08:50","end":"09:35","subject":"Math","room":"R201"},{"period":3,"start":"09:55","end":"10:40","subject":"History","room":"R215"},{"period":4,"start":"10:45","end":"11:30","subject":"Art","room":"R401"}]'::jsonb),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3', 3,
     '[{"period":1,"start":"08:00","end":"08:45","subject":"Physics","room":"R304"},{"period":2,"start":"08:50","end":"09:35","subject":"Math","room":"R201"},{"period":3,"start":"09:55","end":"10:40","subject":"English","room":"R107"},{"period":4,"start":"10:45","end":"11:30","subject":"PE","room":"Gym"}]'::jsonb),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3', 4,
     '[{"period":1,"start":"08:00","end":"08:45","subject":"Math","room":"R201"},{"period":2,"start":"08:50","end":"09:35","subject":"German","room":"R107"},{"period":3,"start":"09:55","end":"10:40","subject":"Biology","room":"R304"},{"period":4,"start":"10:45","end":"11:30","subject":"Music","room":"R412"}]'::jsonb),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3', 5,
     '[{"period":1,"start":"08:00","end":"08:45","subject":"English","room":"R107"},{"period":2,"start":"08:50","end":"09:35","subject":"History","room":"R215"},{"period":3,"start":"09:55","end":"10:40","subject":"Math","room":"R201"}]'::jsonb),
    -- Jordan (middle kid) — Mon-Fri, shorter days
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a4', 1,
     '[{"period":1,"start":"08:00","end":"08:45","subject":"Math","room":"R102"},{"period":2,"start":"08:50","end":"09:35","subject":"German","room":"R102"},{"period":3,"start":"09:55","end":"10:40","subject":"Art","room":"R401"}]'::jsonb),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a4', 2,
     '[{"period":1,"start":"08:00","end":"08:45","subject":"PE","room":"Gym"},{"period":2,"start":"08:50","end":"09:35","subject":"Math","room":"R102"},{"period":3,"start":"09:55","end":"10:40","subject":"German","room":"R102"}]'::jsonb),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a4', 3,
     '[{"period":1,"start":"08:00","end":"08:45","subject":"Music","room":"R412"},{"period":2,"start":"08:50","end":"09:35","subject":"German","room":"R102"},{"period":3,"start":"09:55","end":"10:40","subject":"Math","room":"R102"}]'::jsonb),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a4', 4,
     '[{"period":1,"start":"08:00","end":"08:45","subject":"Math","room":"R102"},{"period":2,"start":"08:50","end":"09:35","subject":"English","room":"R107"},{"period":3,"start":"09:55","end":"10:40","subject":"PE","room":"Gym"}]'::jsonb),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a4', 5,
     '[{"period":1,"start":"08:00","end":"08:45","subject":"German","room":"R102"},{"period":2,"start":"08:50","end":"09:35","subject":"Math","room":"R102"},{"period":3,"start":"09:55","end":"10:40","subject":"Art","room":"R401"}]'::jsonb),
    -- Casey (youngest) — Mon-Fri half-days, primary-school style
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a5', 1,
     '[{"period":1,"start":"08:15","end":"09:00","subject":"German","room":"K1"},{"period":2,"start":"09:00","end":"09:45","subject":"Math","room":"K1"},{"period":3,"start":"10:00","end":"10:45","subject":"Art","room":"K1"}]'::jsonb),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a5', 2,
     '[{"period":1,"start":"08:15","end":"09:00","subject":"Math","room":"K1"},{"period":2,"start":"09:00","end":"09:45","subject":"German","room":"K1"},{"period":3,"start":"10:00","end":"10:45","subject":"PE","room":"Gym"}]'::jsonb),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a5', 3,
     '[{"period":1,"start":"08:15","end":"09:00","subject":"German","room":"K1"},{"period":2,"start":"09:00","end":"09:45","subject":"Music","room":"R412"},{"period":3,"start":"10:00","end":"10:45","subject":"Math","room":"K1"}]'::jsonb),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a5', 4,
     '[{"period":1,"start":"08:15","end":"09:00","subject":"Math","room":"K1"},{"period":2,"start":"09:00","end":"09:45","subject":"German","room":"K1"},{"period":3,"start":"10:00","end":"10:45","subject":"PE","room":"Gym"}]'::jsonb),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a5', 5,
     '[{"period":1,"start":"08:15","end":"09:00","subject":"Art","room":"K1"},{"period":2,"start":"09:00","end":"09:45","subject":"German","room":"K1"},{"period":3,"start":"10:00","end":"10:45","subject":"Math","room":"K1"}]'::jsonb);

-- =========================================================================
-- Integration settings — only takes effect on a demo deployment that
-- runs the docker-compose.demo.yml overlay. The mock-* services
-- accept any token and serve canned data. Self-hosters who don't run
-- the demo overlay won't have these hostnames resolve, which produces
-- a connection error in the HA settings page — but that's the same
-- behavior as connecting to any unreachable HA instance, so no harm.
-- =========================================================================
INSERT INTO public.settings (family_id, key, value) VALUES
    -- Home Assistant connection — points at the mock-ha container.
    -- energy_config + tesla_config wire the dashboards to the mock's
    -- sensor entities so /energy and /tesla render with believable data.
    ('00000000-0000-0000-0000-000000000001', 'home_assistant', $${
        "url": "http://mock-ha:8123",
        "access_token": "demo-token-not-real",
        "dashboards": [{
            "id": "home", "name": "Home", "type": "custom", "position": 0,
            "created_at": "2026-01-01T00:00:00Z",
            "cards": [
                {"id":"c1","entity_id":"light.wohnzimmer","display_name":"Living room","card_type":"light","size":"medium"},
                {"id":"c2","entity_id":"light.flur","display_name":"Hallway","card_type":"light","size":"medium"},
                {"id":"c3","entity_id":"light.esstisch","display_name":"Dining","card_type":"light","size":"medium"},
                {"id":"c4","entity_id":"climate.model_y_klima","display_name":"Tesla climate","card_type":"climate","size":"medium"},
                {"id":"c5","entity_id":"vacuum.roborock_s7_maxv","display_name":"Robot vacuum","card_type":"vacuum","size":"medium"}
            ]
        }],
        "energy_config": {
            "solar_power": "sensor.solarflow_800_pro_solar_input_power",
            "battery_charge_power": "sensor.solarflow_800_pro_pack_input_power",
            "battery_discharge_power": "sensor.solarflow_800_pro_output_pack_power",
            "grid_import_power": "sensor.grid_import_power",
            "grid_export_power": "sensor.grid_export_power",
            "battery_soc": "sensor.solarflow_800_pro_electric_level",
            "solar_energy_today": "sensor.solarflow_800_pro_aggr_solar",
            "battery_energy_in": "sensor.solarflow_800_pro_aggr_charge",
            "battery_energy_out": "sensor.solarflow_800_pro_aggr_discharge",
            "grid_import": "sensor.grid_import_energy",
            "grid_export": "sensor.grid_export_energy",
            "cost_per_kwh_import": 0.32,
            "cost_per_kwh_export": 0.08
        },
        "tesla_config": {
            "battery_level": "sensor.model_y_batteriestand",
            "battery_range": "sensor.model_y_batteriereichweite",
            "charging_state": "sensor.model_y_ladestatus",
            "charge_limit": "number.model_y_ladelimit",
            "time_to_full_charge": "sensor.model_y_zeit_zum_vollstandigen_aufladen",
            "charger_power": "sensor.model_y_ladegerat_leistung",
            "charge_energy_added": "sensor.model_y_ladeenergie_hinzugefugt",
            "inside_temperature": "sensor.model_y_innentemperatur",
            "outside_temperature": "sensor.model_y_aussentemperatur",
            "climate_state": "climate.model_y_klima",
            "locked": "lock.model_y_schloss",
            "windows": "cover.model_y_fenster",
            "doors": "binary_sensor.model_y_fahrertur_vorne",
            "trunk": "cover.model_y_kofferraum",
            "frunk": "cover.model_y_front_kofferraum",
            "tire_pressure_fl": "sensor.reifendruck_vorne_links",
            "tire_pressure_fr": "sensor.reifendruck_vorne_rechts",
            "tire_pressure_rl": "sensor.reifendruck_hinten_links",
            "tire_pressure_rr": "sensor.reifendruck_hinten_rechts",
            "odometer": "sensor.kilometerzahler",
            "location": "device_tracker.model_y_standort",
            "state": "binary_sensor.model_y_status",
            "show_on_dashboard": true
        }
    }$$::jsonb),

    -- Cameras — the mock-go2rtc serves three demo streams as a static SVG
    -- via /api/stream.mjpeg?src=NAME. Stream URLs go through the webapp's
    -- internal proxy, so cameras config just references the stream names.
    ('00000000-0000-0000-0000-000000000001', 'cameras',
     '{"cameras":[
        {"id":"cam1","name":"Kitchen","stream_type":"mjpeg","stream_url":"http://go2rtc:1984/api/stream.mjpeg?src=demo_kitchen","enabled":true,"position":0,"created_at":"2026-01-01T00:00:00Z"},
        {"id":"cam2","name":"Garden","stream_type":"mjpeg","stream_url":"http://go2rtc:1984/api/stream.mjpeg?src=demo_garden","enabled":true,"position":1,"created_at":"2026-01-01T00:00:00Z"},
        {"id":"cam3","name":"Front door","stream_type":"mjpeg","stream_url":"http://go2rtc:1984/api/stream.mjpeg?src=demo_front_door","enabled":true,"position":2,"created_at":"2026-01-01T00:00:00Z"}
     ]}'::jsonb);

COMMIT;

\echo
\echo 'Demo family seeded. Join code: DEMO01'
\echo
