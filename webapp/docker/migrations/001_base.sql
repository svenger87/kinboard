-- Migration: Add recipes, meal planning, and item catalog tables

-- Add updated_at column to calendars table (missing from init.sql)
ALTER TABLE public.calendars ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add trigger for auto-updating updated_at on calendars
DROP TRIGGER IF EXISTS update_calendars_updated_at ON public.calendars;
CREATE TRIGGER update_calendars_updated_at
    BEFORE UPDATE ON public.calendars
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Device columns
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS is_kiosk BOOLEAN DEFAULT false;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS has_presence_sensor BOOLEAN DEFAULT false;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS hardware_id TEXT;

-- Index for fast hardware_id lookups
CREATE INDEX IF NOT EXISTS idx_devices_hardware_id ON public.devices(hardware_id);

-- Recipes table
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
    difficulty TEXT,
    instructions JSONB NOT NULL DEFAULT '[]',
    is_favorite BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recipe ingredients
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

-- Recipe tags
CREATE TABLE IF NOT EXISTS public.recipe_tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#6b7280',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recipe tag assignments
CREATE TABLE IF NOT EXISTS public.recipe_tag_assignments (
    recipe_id UUID NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES public.recipe_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (recipe_id, tag_id)
);

-- Meal plans
CREATE TABLE IF NOT EXISTS public.meal_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    week_start DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Meal plan entries
CREATE TABLE IF NOT EXISTS public.meal_plan_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meal_plan_id UUID NOT NULL REFERENCES public.meal_plans(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    meal_type TEXT NOT NULL,
    recipe_id UUID REFERENCES public.recipes(id) ON DELETE SET NULL,
    note TEXT,
    servings INTEGER,
    attendees UUID[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Item catalog
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
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enhanced shopping items columns
ALTER TABLE public.shopping_items ADD COLUMN IF NOT EXISTS quantity DECIMAL(10, 2);
ALTER TABLE public.shopping_items ADD COLUMN IF NOT EXISTS unit TEXT;
ALTER TABLE public.shopping_items ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.shopping_items ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE public.shopping_items ADD COLUMN IF NOT EXISTS catalog_item_id UUID;
ALTER TABLE public.shopping_items ADD COLUMN IF NOT EXISTS recipe_id UUID;
ALTER TABLE public.shopping_items ADD COLUMN IF NOT EXISTS added_by UUID;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_recipes_family ON public.recipes(family_id);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON public.recipe_ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS idx_meal_plans_family ON public.meal_plans(family_id);
CREATE INDEX IF NOT EXISTS idx_meal_plan_entries_plan ON public.meal_plan_entries(meal_plan_id);
CREATE INDEX IF NOT EXISTS idx_meal_plan_entries_date ON public.meal_plan_entries(date);
CREATE INDEX IF NOT EXISTS idx_item_catalog_family ON public.item_catalog(family_id);

-- Enable RLS
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_plan_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_catalog ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Drop existing and recreate with permissive policies
-- (App handles family scoping via queries, RLS ensures family_id is provided)

-- Drop existing policies first
DROP POLICY IF EXISTS recipes_family_policy ON public.recipes;
DROP POLICY IF EXISTS recipe_ingredients_policy ON public.recipe_ingredients;
DROP POLICY IF EXISTS recipe_tags_policy ON public.recipe_tags;
DROP POLICY IF EXISTS recipe_tag_assignments_policy ON public.recipe_tag_assignments;
DROP POLICY IF EXISTS meal_plans_policy ON public.meal_plans;
DROP POLICY IF EXISTS meal_plan_entries_policy ON public.meal_plan_entries;
DROP POLICY IF EXISTS item_catalog_policy ON public.item_catalog;

-- Recipes: Allow all operations when family_id is provided
CREATE POLICY recipes_family_policy ON public.recipes
    FOR ALL
    USING (family_id IS NOT NULL)
    WITH CHECK (family_id IS NOT NULL);

-- Recipe ingredients: Allow all (linked via recipe_id foreign key)
CREATE POLICY recipe_ingredients_policy ON public.recipe_ingredients
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Recipe tags: Allow all when family_id is provided
CREATE POLICY recipe_tags_policy ON public.recipe_tags
    FOR ALL
    USING (family_id IS NOT NULL)
    WITH CHECK (family_id IS NOT NULL);

-- Recipe tag assignments: Allow all (linked via foreign keys)
CREATE POLICY recipe_tag_assignments_policy ON public.recipe_tag_assignments
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Meal plans: Allow all when family_id is provided
CREATE POLICY meal_plans_policy ON public.meal_plans
    FOR ALL
    USING (family_id IS NOT NULL)
    WITH CHECK (family_id IS NOT NULL);

-- Meal plan entries: Allow all (linked via meal_plan_id foreign key)
CREATE POLICY meal_plan_entries_policy ON public.meal_plan_entries
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Item catalog: Allow all (family_id can be NULL for global items)
CREATE POLICY item_catalog_policy ON public.item_catalog
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Realtime subscriptions (ignore errors if already added)
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.recipes;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.recipe_ingredients;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.recipe_tags;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.meal_plans;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.meal_plan_entries;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.item_catalog;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Grant permissions on new tables to anon and authenticated roles
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipe_ingredients TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipe_tags TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipe_tag_assignments TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meal_plans TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meal_plan_entries TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_catalog TO anon, authenticated;

-- Grant usage on sequences
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- Push notification subscriptions
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

-- Notification preferences per device
CREATE TABLE IF NOT EXISTS public.notification_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE,
    shopping_reminders BOOLEAN DEFAULT true,
    shopping_collaborative BOOLEAN DEFAULT true,
    calendar_reminders BOOLEAN DEFAULT true,
    meal_prep_reminders BOOLEAN DEFAULT true,
    birthday_reminders BOOLEAN DEFAULT true,
    default_event_reminder_minutes INTEGER DEFAULT 15,
    meal_prep_advance_minutes INTEGER DEFAULT 60,
    quiet_hours_enabled BOOLEAN DEFAULT false,
    quiet_hours_start TIME DEFAULT '22:00',
    quiet_hours_end TIME DEFAULT '07:00',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(family_id, device_id)
);

-- Indexes for notification tables
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_family ON public.push_subscriptions(family_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_device ON public.push_subscriptions(device_id);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_family ON public.notification_preferences(family_id);

-- Enable RLS on notification tables
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS push_subscriptions_policy ON public.push_subscriptions;
DROP POLICY IF EXISTS notification_preferences_policy ON public.notification_preferences;

-- RLS policies for notification tables
CREATE POLICY push_subscriptions_policy ON public.push_subscriptions
    FOR ALL
    USING (family_id IS NOT NULL)
    WITH CHECK (family_id IS NOT NULL);

CREATE POLICY notification_preferences_policy ON public.notification_preferences
    FOR ALL
    USING (family_id IS NOT NULL)
    WITH CHECK (family_id IS NOT NULL);

-- Realtime for notification tables
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.push_subscriptions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_preferences;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Grant permissions on notification tables
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO anon, authenticated;

-- Storage bucket for recipe images.
--
-- Guarded on the storage schema existing. The storage service creates it on
-- its own first start, so on a brand-new stack the migrations can win the race
-- and this whole block runs against a schema that is not there yet. It failed
-- silently for as long as the migration runner discarded exit codes; now that
-- it does not, the guard is what keeps a first boot from being reported as a
-- broken schema. The next run, once storage is up, creates the bucket.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage schema not ready yet; skipping recipe-images bucket (created on a later run)';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'recipe-images',
    'recipe-images',
    true,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
  ) ON CONFLICT (id) DO NOTHING;

  -- RLS: Anyone can read public recipe images
  DROP POLICY IF EXISTS "Public read recipe images" ON storage.objects;
  CREATE POLICY "Public read recipe images" ON storage.objects
    FOR SELECT USING (bucket_id = 'recipe-images');

  -- RLS: Anyone can upload recipe images (family scoping done via app)
  DROP POLICY IF EXISTS "Upload recipe images" ON storage.objects;
  CREATE POLICY "Upload recipe images" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'recipe-images');

  -- RLS: Anyone can delete their own recipe images
  DROP POLICY IF EXISTS "Delete recipe images" ON storage.objects;
  CREATE POLICY "Delete recipe images" ON storage.objects
    FOR DELETE USING (bucket_id = 'recipe-images');

EXCEPTION
  -- The storage service creates these tables and then grants on them, so
  -- there is a window where they exist but this role cannot write to them.
  -- Same first-boot race as the missing-schema case above, one step later.
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'no rights on the storage tables yet; skipping recipe-images bucket (created on a later run)';
END $$;

-- Add recurring task support to todos
ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS recurrence TEXT DEFAULT 'once';
ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS last_completed TIMESTAMPTZ;

-- Change priority from integer to text (app uses 'low'/'medium'/'high').
-- Guarded with a type check: on fresh installs, init.sql already creates
-- priority as TEXT, in which case the cast would fail on `WHEN 0`.
DO $$
BEGIN
  IF (SELECT data_type
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = 'todos'
         AND column_name  = 'priority') = 'integer' THEN
    ALTER TABLE public.todos
      ALTER COLUMN priority TYPE TEXT USING
        CASE priority
          WHEN 0 THEN 'medium'
          WHEN 1 THEN 'low'
          WHEN 2 THEN 'medium'
          WHEN 3 THEN 'high'
          ELSE 'medium'
        END;
  END IF;
END$$;
ALTER TABLE public.todos
  ALTER COLUMN priority SET DEFAULT 'medium';

-- Todo notification preferences
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS todo_reminders BOOLEAN DEFAULT true;
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS todo_collaborative BOOLEAN DEFAULT true;

-- Done
SELECT 'Migration completed successfully!' as status;
