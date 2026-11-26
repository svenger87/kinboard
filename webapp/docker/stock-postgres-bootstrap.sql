-- The role bootstrap for stock PostgreSQL (RFC-024 §4.2.1).
--
-- Run by kinboard-db-init as the image's superuser (supabase_admin), in one
-- transaction, once: on stock PostgreSQL (kinboard-postgres), before init.sql,
-- when `authenticator` does not exist yet. Never on supabase/postgres, whose
-- own init creates all of this; kinboard-db-init tells the two apart first.
--
-- It reproduces what supabase/postgres:15.14.1.159 has and Kinboard relies on,
-- value for value (read from pg_roles, pg_auth_members, pg_db_role_setting,
-- pg_default_acl and pg_namespace on that image, 2026-11-26), and nothing
-- more. A mistake here is silent: a BYPASSRLS on the wrong role lets every
-- family see every other family's rows, an INHERIT on authenticator gives its
-- sessions its members' rights before PostgREST switches role, and a default
-- privilege too many opens a table that relies on a later REVOKE. So the
-- policy, grant and role comparison in scripts/rigs/test-stock-postgres.sh
-- checks this file against supabase/postgres on every change (RFC-024 §6.5).
--
-- :'pw' is the database password, passed by kinboard-db-init as a psql
-- variable so it is never part of the SQL text.

-- The API roles. Every attribute is spelled out, defaults included, so the
-- file says what each role is without knowing PostgreSQL's defaults.
CREATE ROLE anon          NOSUPERUSER INHERIT   NOCREATEROLE NOCREATEDB NOLOGIN NOREPLICATION NOBYPASSRLS;
CREATE ROLE authenticated NOSUPERUSER INHERIT   NOCREATEROLE NOCREATEDB NOLOGIN NOREPLICATION NOBYPASSRLS;
-- The server's role: API routes see every family's rows, as today.
CREATE ROLE service_role  NOSUPERUSER INHERIT   NOCREATEROLE NOCREATEDB NOLOGIN NOREPLICATION BYPASSRLS;
-- PostgREST's login. NOINHERIT: it holds no right of its own until PostgREST
-- switches to anon, authenticated or service_role for a request.
CREATE ROLE authenticator NOSUPERUSER NOINHERIT NOCREATEROLE NOCREATEDB LOGIN   NOREPLICATION NOBYPASSRLS
  PASSWORD :'pw';
-- The migration runner's and the webapp's role. Not a superuser, as on
-- supabase/postgres. Created by the superuser and never granted ADMIN OPTION
-- on the API roles, so from PostgreSQL 16 on its CREATEROLE cannot alter
-- them (what supautils' reserved_roles does on supabase/postgres).
CREATE ROLE postgres      NOSUPERUSER INHERIT   CREATEROLE   CREATEDB   LOGIN   REPLICATION   BYPASSRLS
  PASSWORD :'pw';

ALTER ROLE anon          SET statement_timeout = '3s';
ALTER ROLE authenticated SET statement_timeout = '8s';
ALTER ROLE authenticator SET statement_timeout = '8s';
ALTER ROLE authenticator SET lock_timeout = '8s';
-- Every session through PostgREST refuses an UPDATE or DELETE without a WHERE
-- clause, the service role's included. supabase/postgres preloads
-- `supautils, safeupdate`; supautils does not exist here and is not needed
-- (RFC-024 §4.2.1). kinboard-postgres carries safeupdate.so; kinboard-db-init
-- refuses a database that cannot load it before this file runs.
ALTER ROLE authenticator SET session_preload_libraries = 'safeupdate';
ALTER ROLE postgres      SET search_path = "$user", public, extensions;
-- As on supabase/postgres (its `auth` schema does not exist here, and a
-- missing schema in a search_path is skipped). init.sql runs as this role and
-- calls uuid_generate_v4(), which lives in `extensions`.
ALTER ROLE supabase_admin SET search_path = "$user", public, auth, extensions;
ALTER ROLE supabase_admin SET log_statement = 'none';

-- PostgREST's role switch, without admin option.
GRANT anon, authenticated, service_role TO authenticator;
GRANT anon, authenticated, service_role, pg_monitor, pg_read_all_data, pg_signal_backend TO postgres;

-- On supabase/postgres the database belongs to `postgres`, and with it the
-- `public` schema (owned by pg_database_owner): the migrations create their
-- tables there as `postgres`.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I OWNER TO postgres', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;

-- New objects in public. Isolation rests on row-level security plus the
-- migrations' explicit REVOKEs, which assume these grants exist
-- (camera-takeover-grants, school-holidays-grants). The privileges are
-- listed rather than ALL: from PostgreSQL 17, ALL on a table includes
-- MAINTAIN, which supabase/postgres 15 never granted.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO postgres, anon, authenticated, service_role;

-- uuid-ossp in its own schema, as supabase/postgres has it. In `public`, the
-- default privileges above would hand its functions to anon, authenticated
-- and service_role (30 routine grants, caught by the comparison).
CREATE SCHEMA extensions AUTHORIZATION postgres;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA extensions
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO postgres WITH GRANT OPTION;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA extensions
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO postgres WITH GRANT OPTION;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA extensions
  GRANT EXECUTE ON FUNCTIONS TO postgres WITH GRANT OPTION;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- PostgREST serves `public,graphql_public` (PGRST_DB_SCHEMAS in compose.yml
-- and the legacy compose file), and refuses to load its schema cache, answering
-- every request 503, while a listed schema is missing. On supabase/postgres it
-- holds pg_graphql's entry point, which Kinboard never calls; here it stays
-- empty, with supabase/postgres's grants, so one PostgREST configuration
-- serves both images.
CREATE SCHEMA graphql_public;
GRANT USAGE ON SCHEMA graphql_public TO postgres WITH GRANT OPTION;
GRANT USAGE ON SCHEMA graphql_public TO anon, authenticated, service_role;

-- Named by init.sql and 20 migrations (ALTER PUBLICATION … ADD TABLE). Owned
-- by postgres, as on supabase/postgres: the migrations run as postgres, and
-- only a publication's owner may add tables to it. Without a subscriber it
-- holds no replication slot and costs nothing.
-- wal_level stays `replica`: nothing subscribes, so PostgreSQL's warning that
-- logical changes can't be published is true and irrelevant.
SET LOCAL client_min_messages = error;
CREATE PUBLICATION supabase_realtime;
ALTER PUBLICATION supabase_realtime OWNER TO postgres;
