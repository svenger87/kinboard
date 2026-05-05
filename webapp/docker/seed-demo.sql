-- Kinboard — optional demo seed.
--
-- Apply explicitly when you want a populated dataset for development:
--
--   docker exec -i kinboard-db \
--     psql -U postgres -d postgres < webapp/docker/seed-demo.sql
--
-- Or via the helper script:
--
--   ./webapp/docker/start.sh seed-demo
--
-- Idempotent — re-running won't duplicate rows.

-- Demo family. Join code DEMO01 lets a second device join via /join.
INSERT INTO public.families (id, name, join_code)
VALUES ('00000000-0000-0000-0000-000000000001', 'Demo Family', 'DEMO01')
ON CONFLICT DO NOTHING;

-- Demo family members (gender-neutral placeholder names)
INSERT INTO public.people (family_id, name, color) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Alex',  '#3b82f6'),
    ('00000000-0000-0000-0000-000000000001', 'Sam',   '#ec4899'),
    ('00000000-0000-0000-0000-000000000001', 'Riley', '#a855f7'),
    ('00000000-0000-0000-0000-000000000001', 'Jordan','#22c55e')
ON CONFLICT DO NOTHING;

-- Demo school subjects
INSERT INTO public.subjects (family_id, name, color, icon) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Math',      '#ef4444', 'Calculator'),
    ('00000000-0000-0000-0000-000000000001', 'English',   '#3b82f6', 'BookOpen'),
    ('00000000-0000-0000-0000-000000000001', 'French',    '#22c55e', 'Languages'),
    ('00000000-0000-0000-0000-000000000001', 'Physics',   '#8b5cf6', 'Atom'),
    ('00000000-0000-0000-0000-000000000001', 'Chemistry', '#f97316', 'FlaskConical'),
    ('00000000-0000-0000-0000-000000000001', 'Biology',   '#10b981', 'Leaf'),
    ('00000000-0000-0000-0000-000000000001', 'History',   '#6b7280', 'Landmark'),
    ('00000000-0000-0000-0000-000000000001', 'Geography', '#06b6d4', 'Globe'),
    ('00000000-0000-0000-0000-000000000001', 'PE',        '#ec4899', 'Dumbbell'),
    ('00000000-0000-0000-0000-000000000001', 'Art',       '#f59e0b', 'Palette'),
    ('00000000-0000-0000-0000-000000000001', 'Music',     '#a855f7', 'Music')
ON CONFLICT DO NOTHING;
