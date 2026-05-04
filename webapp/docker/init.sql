-- Familyboard Database Schema
-- PostgreSQL 15 with Row Level Security

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- supabase/realtime expects a `_realtime` schema (with underscore) to
-- store its own migration tracking. Some versions of supabase/postgres
-- don't create it automatically, and the realtime container crash-loops
-- with "ERROR 3F000 (invalid_schema_name) no schema has been selected"
-- if it's missing. This is benign on installs where supabase already
-- created it.
CREATE SCHEMA IF NOT EXISTS _realtime;

-- ===================
-- TABLES
-- ===================

-- Families (top-level entity)
CREATE TABLE IF NOT EXISTS public.families (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    join_code TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Devices (connected to families)
CREATE TABLE IF NOT EXISTS public.devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    user_agent TEXT,
    is_kiosk BOOLEAN DEFAULT false,
    has_presence_sensor BOOLEAN DEFAULT false,
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- People (family members)
CREATE TABLE IF NOT EXISTS public.people (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3b82f6',
    avatar_url TEXT,
    is_child BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Calendars
CREATE TABLE IF NOT EXISTS public.calendars (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    person_id UUID REFERENCES public.people(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    google_calendar_id TEXT,
    color TEXT NOT NULL DEFAULT '#3b82f6',
    sync_enabled BOOLEAN DEFAULT true,
    is_holidays BOOLEAN DEFAULT false,
    is_waste_collection BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Calendar Events
CREATE TABLE IF NOT EXISTS public.events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    calendar_id UUID NOT NULL REFERENCES public.calendars(id) ON DELETE CASCADE,
    google_event_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    location TEXT,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    all_day BOOLEAN DEFAULT false,
    recurrence_rule TEXT,
    person_id UUID REFERENCES public.people(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Todos
CREATE TABLE IF NOT EXISTS public.todos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    person_id UUID REFERENCES public.people(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    completed BOOLEAN DEFAULT false,
    due_date DATE,
    priority TEXT DEFAULT 'medium',
    recurrence TEXT DEFAULT 'once',
    last_completed TIMESTAMPTZ,
    source_device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shopping Items
CREATE TABLE IF NOT EXISTS public.shopping_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    checked BOOLEAN DEFAULT false,
    bring_item_id TEXT,
    category TEXT,
    source_device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- School Subjects (Fächer)
CREATE TABLE IF NOT EXISTS public.subjects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3b82f6',
    icon TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- School Schedules
CREATE TABLE IF NOT EXISTS public.schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    person_id UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
    time_slots JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Birthdays
CREATE TABLE IF NOT EXISTS public.birthdays (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    date DATE NOT NULL,
    notify_days_before INTEGER DEFAULT 7,
    person_id UUID REFERENCES public.people(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notes
CREATE TABLE IF NOT EXISTS public.notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    pinned BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- OAuth Credentials (encrypted)
CREATE TABLE IF NOT EXISTS public.oauth_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    encrypted_refresh_token TEXT NOT NULL,
    encrypted_access_token TEXT,
    token_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(family_id, provider)
);

-- Settings (key-value)
CREATE TABLE IF NOT EXISTS public.settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(family_id, key)
);

-- ===================
-- INDEXES
-- ===================

CREATE INDEX IF NOT EXISTS idx_devices_family ON public.devices(family_id);
CREATE INDEX IF NOT EXISTS idx_people_family ON public.people(family_id);
CREATE INDEX IF NOT EXISTS idx_calendars_family ON public.calendars(family_id);
CREATE INDEX IF NOT EXISTS idx_events_calendar ON public.events(calendar_id);
CREATE INDEX IF NOT EXISTS idx_events_start ON public.events(start_at);
CREATE INDEX IF NOT EXISTS idx_todos_family ON public.todos(family_id);
CREATE INDEX IF NOT EXISTS idx_todos_person ON public.todos(person_id);
CREATE INDEX IF NOT EXISTS idx_shopping_family ON public.shopping_items(family_id);
CREATE INDEX IF NOT EXISTS idx_subjects_family ON public.subjects(family_id);
CREATE INDEX IF NOT EXISTS idx_schedules_family ON public.schedules(family_id);
CREATE INDEX IF NOT EXISTS idx_schedules_person ON public.schedules(person_id);
CREATE INDEX IF NOT EXISTS idx_birthdays_family ON public.birthdays(family_id);
CREATE INDEX IF NOT EXISTS idx_birthdays_date ON public.birthdays(date);
CREATE INDEX IF NOT EXISTS idx_notes_family ON public.notes(family_id);
CREATE INDEX IF NOT EXISTS idx_settings_family ON public.settings(family_id);

-- ===================
-- ROW LEVEL SECURITY (currently disabled — see comment below)
-- ===================
--
-- Familyboard's threat model is "trusted home network." Authentication
-- is device-cookie-based, not row-level. Earlier iterations enabled RLS
-- here with policies keyed off a `current_setting('app.current_family_id')`
-- session GUC, but the application code doesn't reliably set that GUC on
-- every PostgREST request, so the policies blocked legitimate writes
-- (notably the join flow, which inserts into `devices` from the anon
-- role before any family membership exists).
--
-- Production has run with RLS DISABLED on all the family-scoped tables
-- since shortly after launch. Keep these tables non-RLS unless and until
-- the app is reworked to consistently set the GUC, OR a real auth model
-- (signed JWTs with embedded family_id, etc.) is wired in.
--
-- Policies remain DEFINED below as documentation for what the eventual
-- correct state should look like, but they are NOT in force.

-- (Intentionally no ENABLE ROW LEVEL SECURITY here.)

-- Family isolation policy (devices can only see their family's data)
-- Using a session variable set by the application: current_setting('app.current_family_id')

CREATE POLICY "Families are accessible by join code" ON public.families
    FOR SELECT USING (true);

CREATE POLICY "Families can be created" ON public.families
    FOR INSERT WITH CHECK (true);

-- Devices policy
CREATE POLICY "Devices belong to families" ON public.devices
    FOR ALL USING (
        family_id::text = current_setting('app.current_family_id', true)
    );

-- People policy
CREATE POLICY "People belong to families" ON public.people
    FOR ALL USING (
        family_id::text = current_setting('app.current_family_id', true)
    );

-- Calendars policy
CREATE POLICY "Calendars belong to families" ON public.calendars
    FOR ALL USING (
        family_id::text = current_setting('app.current_family_id', true)
    );

-- Events policy (through calendar)
CREATE POLICY "Events belong to family calendars" ON public.events
    FOR ALL USING (
        calendar_id IN (
            SELECT id FROM public.calendars
            WHERE family_id::text = current_setting('app.current_family_id', true)
        )
    );

-- Todos policy
CREATE POLICY "Todos belong to families" ON public.todos
    FOR ALL USING (
        family_id::text = current_setting('app.current_family_id', true)
    );

-- Shopping items policy
CREATE POLICY "Shopping items belong to families" ON public.shopping_items
    FOR ALL USING (
        family_id::text = current_setting('app.current_family_id', true)
    );

-- Subjects policy
CREATE POLICY "Subjects belong to families" ON public.subjects
    FOR ALL USING (
        family_id::text = current_setting('app.current_family_id', true)
    );

-- Schedules policy
CREATE POLICY "Schedules belong to families" ON public.schedules
    FOR ALL USING (
        family_id::text = current_setting('app.current_family_id', true)
    );

-- Birthdays policy
CREATE POLICY "Birthdays belong to families" ON public.birthdays
    FOR ALL USING (
        family_id::text = current_setting('app.current_family_id', true)
    );

-- Notes policy
CREATE POLICY "Notes belong to families" ON public.notes
    FOR ALL USING (
        family_id::text = current_setting('app.current_family_id', true)
    );

-- OAuth credentials policy
CREATE POLICY "OAuth credentials belong to families" ON public.oauth_credentials
    FOR ALL USING (
        family_id::text = current_setting('app.current_family_id', true)
    );

-- Settings policy
CREATE POLICY "Settings belong to families" ON public.settings
    FOR ALL USING (
        family_id::text = current_setting('app.current_family_id', true)
    );

-- ===================
-- TRIGGERS
-- ===================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_families_updated_at
    BEFORE UPDATE ON public.families
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_events_updated_at
    BEFORE UPDATE ON public.events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_todos_updated_at
    BEFORE UPDATE ON public.todos
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_notes_updated_at
    BEFORE UPDATE ON public.notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_oauth_updated_at
    BEFORE UPDATE ON public.oauth_credentials
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_settings_updated_at
    BEFORE UPDATE ON public.settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_subjects_updated_at
    BEFORE UPDATE ON public.subjects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ===================
-- FUNCTIONS
-- ===================

-- Generate unique join code
CREATE OR REPLACE FUNCTION generate_join_code()
RETURNS TEXT AS $$
DECLARE
    chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    result TEXT := '';
    i INTEGER;
BEGIN
    FOR i IN 1..6 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Get upcoming birthdays
CREATE OR REPLACE FUNCTION get_upcoming_birthdays(p_family_id UUID, p_days INTEGER DEFAULT 30)
RETURNS TABLE (
    id UUID,
    name TEXT,
    date DATE,
    days_until INTEGER,
    age INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.id,
        b.name,
        b.date,
        CASE
            WHEN make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, EXTRACT(MONTH FROM b.date)::int, EXTRACT(DAY FROM b.date)::int) >= CURRENT_DATE
            THEN make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, EXTRACT(MONTH FROM b.date)::int, EXTRACT(DAY FROM b.date)::int) - CURRENT_DATE
            ELSE make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int + 1, EXTRACT(MONTH FROM b.date)::int, EXTRACT(DAY FROM b.date)::int) - CURRENT_DATE
        END AS days_until,
        EXTRACT(YEAR FROM age(b.date))::int + 1 AS age
    FROM public.birthdays b
    WHERE b.family_id = p_family_id
    ORDER BY days_until
    LIMIT p_days;
END;
$$ LANGUAGE plpgsql;

-- ===================
-- RECIPES & MEAL PLANNING TABLES
-- ===================

-- Recipes
CREATE TABLE IF NOT EXISTS public.recipes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    source_url TEXT,
    source_domain TEXT,
    image_url TEXT,
    servings INTEGER DEFAULT 4,
    prep_time_minutes INTEGER,
    cook_time_minutes INTEGER,
    total_time_minutes INTEGER,
    difficulty TEXT CHECK (difficulty IN ('einfach', 'mittel', 'schwer')),
    instructions JSONB NOT NULL DEFAULT '[]',
    is_favorite BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recipe Ingredients
CREATE TABLE IF NOT EXISTS public.recipe_ingredients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipe_id UUID NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    quantity DECIMAL(10, 2),
    unit TEXT,
    group_name TEXT,
    notes TEXT,
    category TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recipe Tags
CREATE TABLE IF NOT EXISTS public.recipe_tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#6b7280',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(family_id, name)
);

-- Recipe-Tag Junction
CREATE TABLE IF NOT EXISTS public.recipe_tag_assignments (
    recipe_id UUID NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES public.recipe_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (recipe_id, tag_id)
);

-- Meal Plans (weekly container)
CREATE TABLE IF NOT EXISTS public.meal_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    week_start DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(family_id, week_start)
);

-- Meal Plan Entries (individual meals)
CREATE TABLE IF NOT EXISTS public.meal_plan_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meal_plan_id UUID NOT NULL REFERENCES public.meal_plans(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
    recipe_id UUID REFERENCES public.recipes(id) ON DELETE SET NULL,
    note TEXT,
    servings INTEGER,
    attendees UUID[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================
-- ITEM CATALOG & ENHANCED SHOPPING
-- ===================

-- Item Catalog (for shopping autocomplete)
CREATE TABLE IF NOT EXISTS public.item_catalog (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID REFERENCES public.families(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    name_normalized TEXT NOT NULL,
    barcode TEXT,
    image_url TEXT,
    thumbnail_url TEXT,
    category TEXT,
    default_unit TEXT,
    default_quantity DECIMAL(10, 2),
    nutrition_json JSONB,
    source TEXT DEFAULT 'custom',
    popularity INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(family_id, name_normalized)
);

-- Add new columns to shopping_items (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopping_items' AND column_name = 'quantity') THEN
        ALTER TABLE public.shopping_items ADD COLUMN quantity DECIMAL(10, 2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopping_items' AND column_name = 'unit') THEN
        ALTER TABLE public.shopping_items ADD COLUMN unit TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopping_items' AND column_name = 'notes') THEN
        ALTER TABLE public.shopping_items ADD COLUMN notes TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopping_items' AND column_name = 'image_url') THEN
        ALTER TABLE public.shopping_items ADD COLUMN image_url TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopping_items' AND column_name = 'catalog_item_id') THEN
        ALTER TABLE public.shopping_items ADD COLUMN catalog_item_id UUID REFERENCES public.item_catalog(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopping_items' AND column_name = 'recipe_id') THEN
        ALTER TABLE public.shopping_items ADD COLUMN recipe_id UUID REFERENCES public.recipes(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopping_items' AND column_name = 'added_by') THEN
        ALTER TABLE public.shopping_items ADD COLUMN added_by UUID REFERENCES public.people(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ===================
-- PUSH NOTIFICATIONS
-- ===================

-- Push Subscriptions
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh_key TEXT NOT NULL,
    auth_key TEXT NOT NULL,
    user_agent TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notification Preferences
CREATE TABLE IF NOT EXISTS public.notification_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE,
    shopping_reminders BOOLEAN DEFAULT true,
    shopping_collaborative BOOLEAN DEFAULT true,
    calendar_reminders BOOLEAN DEFAULT true,
    meal_prep_reminders BOOLEAN DEFAULT true,
    birthday_reminders BOOLEAN DEFAULT true,
    default_event_reminder_minutes INTEGER DEFAULT 30,
    meal_prep_advance_minutes INTEGER DEFAULT 60,
    quiet_hours_enabled BOOLEAN DEFAULT false,
    quiet_hours_start TIME DEFAULT '22:00',
    quiet_hours_end TIME DEFAULT '07:00',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(family_id, device_id)
);

-- Scheduled Notifications
CREATE TABLE IF NOT EXISTS public.scheduled_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    notification_type TEXT NOT NULL,
    scheduled_for TIMESTAMPTZ NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    data JSONB,
    related_entity_type TEXT,
    related_entity_id UUID,
    processed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notification Logs
CREATE TABLE IF NOT EXISTS public.notification_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
    notification_type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    data JSONB,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    sent_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================
-- ADDITIONAL INDEXES
-- ===================

-- Recipes indexes
CREATE INDEX IF NOT EXISTS idx_recipes_family ON public.recipes(family_id);
CREATE INDEX IF NOT EXISTS idx_recipes_favorite ON public.recipes(family_id, is_favorite);
CREATE INDEX IF NOT EXISTS idx_recipes_difficulty ON public.recipes(family_id, difficulty);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON public.recipe_ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_tags_family ON public.recipe_tags(family_id);

-- Meal plan indexes
CREATE INDEX IF NOT EXISTS idx_meal_plans_family ON public.meal_plans(family_id);
CREATE INDEX IF NOT EXISTS idx_meal_plans_week ON public.meal_plans(week_start);
CREATE INDEX IF NOT EXISTS idx_meal_plan_entries_plan ON public.meal_plan_entries(meal_plan_id);
CREATE INDEX IF NOT EXISTS idx_meal_plan_entries_date ON public.meal_plan_entries(date);
CREATE INDEX IF NOT EXISTS idx_meal_plan_entries_recipe ON public.meal_plan_entries(recipe_id);

-- Item catalog indexes
CREATE INDEX IF NOT EXISTS idx_item_catalog_family ON public.item_catalog(family_id);
CREATE INDEX IF NOT EXISTS idx_item_catalog_name ON public.item_catalog(name_normalized);
CREATE INDEX IF NOT EXISTS idx_item_catalog_barcode ON public.item_catalog(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_item_catalog_popularity ON public.item_catalog(popularity DESC);

-- Push notification indexes
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_device ON public.push_subscriptions(device_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_family ON public.push_subscriptions(family_id);
CREATE INDEX IF NOT EXISTS idx_notification_prefs_family ON public.notification_preferences(family_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_time ON public.scheduled_notifications(scheduled_for) WHERE NOT processed;
CREATE INDEX IF NOT EXISTS idx_notification_logs_family ON public.notification_logs(family_id);

-- ===================
-- ADDITIONAL RLS POLICIES (also disabled — see top-of-file note)
-- ===================
--
-- Same story as the main RLS block earlier: policies are defined for
-- documentation, but ENABLE ROW LEVEL SECURITY is intentionally NOT
-- called. Production runs with RLS off on all of these.

-- (Intentionally no ENABLE ROW LEVEL SECURITY here.)

-- Recipes policy
CREATE POLICY "Recipes belong to families" ON public.recipes
    FOR ALL USING (
        family_id::text = current_setting('app.current_family_id', true)
    );

-- Recipe ingredients policy (through recipe)
CREATE POLICY "Recipe ingredients accessible via recipe" ON public.recipe_ingredients
    FOR ALL USING (
        recipe_id IN (
            SELECT id FROM public.recipes
            WHERE family_id::text = current_setting('app.current_family_id', true)
        )
    );

-- Recipe tags policy
CREATE POLICY "Recipe tags belong to families" ON public.recipe_tags
    FOR ALL USING (
        family_id::text = current_setting('app.current_family_id', true)
    );

-- Recipe tag assignments policy
CREATE POLICY "Recipe tag assignments accessible via recipe" ON public.recipe_tag_assignments
    FOR ALL USING (
        recipe_id IN (
            SELECT id FROM public.recipes
            WHERE family_id::text = current_setting('app.current_family_id', true)
        )
    );

-- Meal plans policy
CREATE POLICY "Meal plans belong to families" ON public.meal_plans
    FOR ALL USING (
        family_id::text = current_setting('app.current_family_id', true)
    );

-- Meal plan entries policy (through meal plan)
CREATE POLICY "Meal plan entries accessible via meal plan" ON public.meal_plan_entries
    FOR ALL USING (
        meal_plan_id IN (
            SELECT id FROM public.meal_plans
            WHERE family_id::text = current_setting('app.current_family_id', true)
        )
    );

-- Item catalog policy (allow global items + family items)
CREATE POLICY "Item catalog accessible to families" ON public.item_catalog
    FOR ALL USING (
        family_id IS NULL OR family_id::text = current_setting('app.current_family_id', true)
    );

-- Push subscriptions policy
CREATE POLICY "Push subscriptions belong to families" ON public.push_subscriptions
    FOR ALL USING (
        family_id::text = current_setting('app.current_family_id', true)
    );

-- Notification preferences policy
CREATE POLICY "Notification preferences belong to families" ON public.notification_preferences
    FOR ALL USING (
        family_id::text = current_setting('app.current_family_id', true)
    );

-- Scheduled notifications policy
CREATE POLICY "Scheduled notifications belong to families" ON public.scheduled_notifications
    FOR ALL USING (
        family_id::text = current_setting('app.current_family_id', true)
    );

-- Notification logs policy
CREATE POLICY "Notification logs belong to families" ON public.notification_logs
    FOR ALL USING (
        family_id::text = current_setting('app.current_family_id', true)
    );

-- ===================
-- ADDITIONAL TRIGGERS
-- ===================

CREATE TRIGGER update_recipes_updated_at
    BEFORE UPDATE ON public.recipes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_meal_plans_updated_at
    BEFORE UPDATE ON public.meal_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_meal_plan_entries_updated_at
    BEFORE UPDATE ON public.meal_plan_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_push_subscriptions_updated_at
    BEFORE UPDATE ON public.push_subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_notification_prefs_updated_at
    BEFORE UPDATE ON public.notification_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ===================
-- NOTIFICATION QUEUE TRIGGERS
-- ===================

-- Shopping item → scheduled_notifications on INSERT
CREATE OR REPLACE FUNCTION notify_shopping_item_inserted()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.scheduled_notifications (
    family_id, notification_type, scheduled_for, title, body,
    data, related_entity_type, related_entity_id, processed
  ) VALUES (
    NEW.family_id, 'shopping_collaborative', NOW(), 'Neuer Artikel', NEW.name,
    jsonb_build_object(
      'item_name', NEW.name,
      'source_device_id', COALESCE(NEW.source_device_id::text, '')
    ),
    'shopping_item', NEW.id, false
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Todo → scheduled_notifications on INSERT
CREATE OR REPLACE FUNCTION notify_todo_inserted()
RETURNS TRIGGER AS $$
DECLARE
  person_name TEXT;
BEGIN
  IF NEW.person_id IS NOT NULL THEN
    SELECT name INTO person_name FROM public.people WHERE id = NEW.person_id;
  END IF;

  INSERT INTO public.scheduled_notifications (
    family_id, notification_type, scheduled_for, title, body,
    data, related_entity_type, related_entity_id, processed
  ) VALUES (
    NEW.family_id,
    CASE WHEN NEW.person_id IS NOT NULL THEN 'todo_assigned' ELSE 'todo_created' END,
    NOW(),
    CASE WHEN NEW.person_id IS NOT NULL THEN 'Aufgabe zugewiesen' ELSE 'Neue Aufgabe' END,
    CASE
      WHEN NEW.person_id IS NOT NULL AND person_name IS NOT NULL
        THEN NEW.title || E' \u2192 ' || person_name
      ELSE NEW.title
    END,
    jsonb_build_object(
      'todo_title', NEW.title,
      'person_name', COALESCE(person_name, ''),
      'source_device_id', COALESCE(NEW.source_device_id::text, '')
    ),
    'todo', NEW.id, false
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_shopping_item_notify
  AFTER INSERT ON public.shopping_items
  FOR EACH ROW EXECUTE FUNCTION notify_shopping_item_inserted();

CREATE TRIGGER trg_todo_notify
  AFTER INSERT ON public.todos
  FOR EACH ROW EXECUTE FUNCTION notify_todo_inserted();

-- Index for efficient polling of unprocessed notifications
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_pending
  ON public.scheduled_notifications(scheduled_for) WHERE NOT processed;

-- ===================
-- REALTIME SUBSCRIPTIONS
-- ===================

-- Enable realtime for all tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.families;
ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;
ALTER PUBLICATION supabase_realtime ADD TABLE public.people;
ALTER PUBLICATION supabase_realtime ADD TABLE public.calendars;
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.todos;
ALTER PUBLICATION supabase_realtime ADD TABLE public.shopping_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.subjects;
ALTER PUBLICATION supabase_realtime ADD TABLE public.schedules;
ALTER PUBLICATION supabase_realtime ADD TABLE public.birthdays;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.settings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.recipes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.recipe_ingredients;
ALTER PUBLICATION supabase_realtime ADD TABLE public.recipe_tags;
ALTER PUBLICATION supabase_realtime ADD TABLE public.meal_plans;
ALTER PUBLICATION supabase_realtime ADD TABLE public.meal_plan_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.item_catalog;
ALTER PUBLICATION supabase_realtime ADD TABLE public.push_subscriptions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_preferences;

-- No demo data is created on first init. Self-hosters create their first
-- family from the in-app /join wizard. Apply seed-demo.sql separately if
-- you want a populated demo dataset for development.
