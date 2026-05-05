-- Intentionally empty. Mounted into the demo postgres container at
-- /docker-entrypoint-initdb.d/init.sql to neutralize the prod-compose's
-- mount of the real init.sql there (which would fail because the supabase
-- image's role-creation migrate.sh hasn't run yet at that lexical order).
-- The real init.sql is then re-mounted at zz-kinboard-init.sql so it
-- runs AFTER migrate.sh has set up the supabase roles.
SELECT 1;
