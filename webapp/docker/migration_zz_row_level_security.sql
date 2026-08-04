-- Row-level security, so the database refuses cross-family reads rather than
-- relying on every query remembering to filter.
--
-- WHY THIS EXISTS
--
-- Kinboard's browser client talks to PostgREST directly with the anon key.
-- That key is public by design — it ships in every browser bundle. With RLS
-- disabled, publishing PostgREST meant anyone on the internet could read and
-- write every table. On 2026-08-04 an unauthenticated request from outside the
-- network returned a family's join code:
--
--   GET /rest/v1/families?select=id,name,join_code  ->  200
--
-- Application-level filtering cannot fix that, because the application isn't
-- in the request path. Only the database can.
--
-- HOW A POLICY KNOWS THE FAMILY
--
-- Every policy resolves the caller's family from a `family_id` claim in the
-- JWT the request carries: `auth.jwt() ->> 'family_id'`. The bare anon key has
-- no such claim, so with these policies in place it can read nothing at all —
-- which is the point. Clients get a family-scoped token from the app after
-- joining with the family code.
--
-- WHAT STILL BYPASSES THIS
--
-- `service_role` has BYPASSRLS, so every Next.js API route and every cron job
-- keeps working unchanged. That is deliberate: those already establish the
-- family server-side. It also means RLS is a backstop for the direct-PostgREST
-- path, not a replacement for the `family_id` filtering in the API routes.
--
-- WHY THE FILENAME STARTS WITH zz
--
-- Migrations apply in alphabetical order on every boot, and this one has to
-- run after all of them. It was called migration_enable_rls.sql, which sorts
-- early — so migration_pocket_money.sql and migration_vehicles_image.sql,
-- both of which create their own policies, ran afterwards and put legacy
-- policies back. On an existing database that went unnoticed, because those
-- tables already had what they needed. On a *fresh* install it left row-level
-- security enabled on 11 tables out of 33 with none of these policies at all
-- — a new self-hoster would have been unprotected on day one.
--
-- Sorting last is what makes that structural rather than a rule to remember.
-- A migration added later that creates a policy gets cleaned up here instead
-- of quietly winning.
--
-- Safe to run more than once.

BEGIN;

-- ---------------------------------------------------------------------------
-- Clear the policies that were already there.
--
-- init.sql defines ~36 policies keyed on `current_setting('app.current_family_id')`
-- — a mechanism nothing in the codebase ever sets. They have never been
-- enforced, because RLS was disabled on every table, so removing them changes
-- no behaviour that currently works.
--
-- They cannot be left in place. Postgres ORs permissive policies together, and
-- one of them is `"Families are accessible by join code"` with `USING (true)`.
-- Enabling RLS without this step produces a database that looks protected and
-- returns every family's join code to an unauthenticated caller — which is
-- exactly what the first test run of this migration did.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND policyname NOT LIKE '%\_family\_scope'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- Resolve the caller's family once, rather than repeating the cast in 30-odd
-- policies. STABLE so the planner can hoist it out of row loops; without that
-- this would be re-evaluated per row on every scan.
CREATE OR REPLACE FUNCTION public.current_family_id()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
  SELECT NULLIF(
    COALESCE(
      current_setting('request.jwt.claims', true)::jsonb ->> 'family_id',
      ''
    ),
    ''
  )::uuid;
$$;

COMMENT ON FUNCTION public.current_family_id() IS
  'The family_id claim from the request JWT, or NULL. NULL means every policy '
  'below evaluates false, so a token without the claim (the bare anon key) '
  'sees nothing.';

-- ---------------------------------------------------------------------------
-- Tables that carry family_id themselves.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
  direct_tables TEXT[] := ARRAY[
    'birthday_gift_ideas', 'birthdays', 'calendars', 'devices',
    'integration_secrets', 'item_catalog', 'meal_plans', 'notes',
    'notification_logs', 'notification_preferences', 'oauth_credentials',
    'people', 'pocket_money_accounts', 'push_subscriptions', 'recipe_tags',
    'recipes', 'scheduled_notifications', 'schedules', 'settings',
    'shopping_items', 'subjects', 'tickers', 'todos', 'vehicles',
    'device_sessions'
  ];
BEGIN
  FOREACH t IN ARRAY direct_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;  -- table not in this install (device_sessions on older schemas)
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_family_scope', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL '
      'USING (family_id = public.current_family_id()) '
      'WITH CHECK (family_id = public.current_family_id())',
      t || '_family_scope', t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Tables that reach a family through a parent row.
--
-- Written as EXISTS against the parent rather than a join so the policy stays
-- a filter and can't multiply rows.
-- ---------------------------------------------------------------------------

ALTER TABLE public.families ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS families_family_scope ON public.families;
CREATE POLICY families_family_scope ON public.families
  FOR ALL
  USING (id = public.current_family_id())
  WITH CHECK (id = public.current_family_id());

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS events_family_scope ON public.events;
CREATE POLICY events_family_scope ON public.events
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.calendars c
    WHERE c.id = events.calendar_id AND c.family_id = public.current_family_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.calendars c
    WHERE c.id = events.calendar_id AND c.family_id = public.current_family_id()
  ));

ALTER TABLE public.meal_plan_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meal_plan_entries_family_scope ON public.meal_plan_entries;
CREATE POLICY meal_plan_entries_family_scope ON public.meal_plan_entries
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.meal_plans m
    WHERE m.id = meal_plan_entries.meal_plan_id AND m.family_id = public.current_family_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.meal_plans m
    WHERE m.id = meal_plan_entries.meal_plan_id AND m.family_id = public.current_family_id()
  ));

ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recipe_ingredients_family_scope ON public.recipe_ingredients;
CREATE POLICY recipe_ingredients_family_scope ON public.recipe_ingredients
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.recipes r
    WHERE r.id = recipe_ingredients.recipe_id AND r.family_id = public.current_family_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.recipes r
    WHERE r.id = recipe_ingredients.recipe_id AND r.family_id = public.current_family_id()
  ));

ALTER TABLE public.recipe_tag_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recipe_tag_assignments_family_scope ON public.recipe_tag_assignments;
CREATE POLICY recipe_tag_assignments_family_scope ON public.recipe_tag_assignments
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.recipes r
    WHERE r.id = recipe_tag_assignments.recipe_id AND r.family_id = public.current_family_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.recipes r
    WHERE r.id = recipe_tag_assignments.recipe_id AND r.family_id = public.current_family_id()
  ));

-- Pocket money: three children hanging off an account.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pocket_money_goals', 'pocket_money_transactions', 'pocket_money_withdrawal_requests'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_family_scope', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL '
      'USING (EXISTS (SELECT 1 FROM public.pocket_money_accounts a '
      '               WHERE a.id = %I.account_id AND a.family_id = public.current_family_id())) '
      'WITH CHECK (EXISTS (SELECT 1 FROM public.pocket_money_accounts a '
      '               WHERE a.id = %I.account_id AND a.family_id = public.current_family_id()))',
      t || '_family_scope', t, t, t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- schema_migrations is bookkeeping with no family. Lock it away from the
-- public roles entirely rather than inventing a tenancy it doesn't have.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS schema_migrations_no_public ON public.schema_migrations';
    -- No permissive policy at all: RLS denies by default, and service_role
    -- still bypasses, which is what runs migrations.
  END IF;
END $$;

COMMIT;
