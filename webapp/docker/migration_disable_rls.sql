-- migration_disable_rls.sql
--
-- Disable Row-Level Security on all family-scoped tables.
--
-- Earlier iterations of init.sql turned RLS on with policies that
-- depend on a `current_setting('app.current_family_id')` GUC. The
-- application code doesn't reliably set that GUC on every request, so
-- the policies block legitimate writes (notably the join flow's INSERT
-- into `devices` from the anon role).
--
-- Production has run with RLS disabled on all main tables since shortly
-- after launch. This migration brings older installs into the same
-- state. New installs from the updated init.sql don't enable RLS in the
-- first place, so this is a no-op there.
--
-- Familyboard's actual security model is "trusted home network": device
-- cookies + 6-character family join codes. RLS at the postgres level
-- has been an aspirational layer that was never load-bearing in practice.

ALTER TABLE public.families               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices                DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.people                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendars              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.events                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_items         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.birthdays              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipes                DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ingredients     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_tags            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_tag_assignments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_plans             DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_plan_entries      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_catalog           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_notifications   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs      DISABLE ROW LEVEL SECURITY;

-- oauth_credentials may not exist on all installs (legacy table replaced
-- by `settings` rows). Guard.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='oauth_credentials') THEN
    ALTER TABLE public.oauth_credentials DISABLE ROW LEVEL SECURITY;
  END IF;
END $$;
