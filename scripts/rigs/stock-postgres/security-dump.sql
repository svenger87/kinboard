-- The security surface of a Kinboard database, one fact per line, for the
-- comparison in test-stock-postgres.sh (RFC-024 §6.5): supabase/postgres 15
-- against stock 15 (the image's own differences), then stock 15 against
-- stock 17 (the major version's). Run as the superuser after init.sql and
-- the full migration run; the output is sorted by the caller (LC_ALL=C).
--
-- Every privilege is read from the ACL itself (aclexplode), with the
-- built-in default where the ACL is still NULL (acldefault), so a grant that
-- exists only implicitly, such as EXECUTE for PUBLIC on a new function, is
-- compared too. Grantees: the API roles and PUBLIC, which is everything
-- PostgREST can act as.
\pset footer off
\pset tuples_only on
\pset format unaligned
\pset fieldsep '|'
\pset null '∅'

CREATE TEMP VIEW api_roles AS
  SELECT oid, rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'authenticator')
  UNION ALL SELECT 0, 'PUBLIC';
CREATE TEMP VIEW kb_roles AS
  SELECT oid, rolname FROM pg_roles
   WHERE rolname IN ('anon', 'authenticated', 'service_role', 'authenticator', 'postgres', 'supabase_admin');

-- Row-level security policies on every table outside the system schemas.
SELECT 'policy', schemaname || '.' || tablename, policyname, permissive,
       array_to_string(ARRAY(SELECT unnest(roles) ORDER BY 1), ','), cmd, qual, with_check
  FROM pg_policies
 WHERE schemaname IN ('public', 'kinboard', 'extensions');

-- RLS enabled / forced, for every table in public.
SELECT 'rls', n.nspname || '.' || c.relname, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname IN ('public', 'kinboard') AND c.relkind IN ('r', 'p');

-- Table, view and sequence privileges for the API roles and PUBLIC.
SELECT 'relacl', c.relkind, n.nspname || '.' || c.relname, a.rolname, x.privilege_type, x.is_grantable
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END::"char", c.relowner))) x
  JOIN api_roles a ON a.oid = x.grantee
 WHERE n.nspname IN ('public', 'kinboard', 'extensions') AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S');

-- Column privileges (a REVOKE on a table with a column grant left behind).
SELECT 'colacl', n.nspname || '.' || c.relname || '.' || at.attname, a.rolname, x.privilege_type, x.is_grantable
  FROM pg_attribute at
  JOIN pg_class c ON c.oid = at.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(at.attacl) x
  JOIN api_roles a ON a.oid = x.grantee
 WHERE n.nspname IN ('public', 'kinboard', 'extensions') AND at.attacl IS NOT NULL;

-- Function privileges: what PostgREST's /rpc and the policies can call.
SELECT 'procacl', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       a.rolname, x.privilege_type, x.is_grantable, p.prosecdef
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
  JOIN api_roles a ON a.oid = x.grantee
 WHERE n.nspname IN ('public', 'kinboard', 'extensions');

-- Which schemas the API roles may enter, all of them.
SELECT 'nspacl', n.nspname, a.rolname, x.privilege_type, x.is_grantable
  FROM pg_namespace n
  CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) x
  JOIN api_roles a ON a.oid = x.grantee
 WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema';

SELECT 'nspowner', n.nspname, pg_get_userbyid(n.nspowner)
  FROM pg_namespace n WHERE n.nspname IN ('public', 'extensions', 'kinboard');

-- Role attributes.
SELECT 'role', rolname, 'super=' || rolsuper, 'inherit=' || rolinherit, 'createrole=' || rolcreaterole,
       'createdb=' || rolcreatedb, 'login=' || rolcanlogin, 'replication=' || rolreplication,
       'bypassrls=' || rolbypassrls, 'connlimit=' || rolconnlimit, 'validuntil=' || coalesce(rolvaliduntil::text, '∅')
  FROM pg_roles WHERE rolname IN (SELECT rolname FROM kb_roles);

-- Memberships in either direction. inherit/set exist from PostgreSQL 16; on
-- 15 a membership inherits when the member does, and SET ROLE is always
-- allowed, which is what the coalesce spells out.
SELECT 'member', m.rolname, 'in', r.rolname, 'admin=' || a.admin_option,
       'inherit=' || coalesce(to_jsonb(a) ->> 'inherit_option', m.rolinherit::text),
       'set=' || coalesce(to_jsonb(a) ->> 'set_option', 'true')
  FROM pg_auth_members a
  JOIN pg_roles m ON m.oid = a.member
  JOIN pg_roles r ON r.oid = a.roleid
 WHERE m.rolname IN (SELECT rolname FROM kb_roles) OR r.rolname IN (SELECT rolname FROM kb_roles);

-- Per-role settings, one per line.
SELECT 'setting', r.rolname, coalesce(d.datname, '*'), cfg
  FROM pg_db_role_setting s
  JOIN pg_roles r ON r.oid = s.setrole
  LEFT JOIN pg_database d ON d.oid = s.setdatabase
  CROSS JOIN LATERAL unnest(s.setconfig) AS cfg
 WHERE r.rolname IN (SELECT rolname FROM kb_roles);

-- Default privileges, every schema.
SELECT 'defacl', pg_get_userbyid(d.defaclrole), coalesce(n.nspname, '*'), d.defaclobjtype,
       CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END, x.privilege_type, x.is_grantable
  FROM pg_default_acl d
  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) x;

SELECT 'extension', e.extname, n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace;

SELECT 'publication', p.pubname, pg_get_userbyid(p.pubowner), 'alltables=' || p.puballtables
  FROM pg_publication p;
SELECT 'publication-table', pubname, schemaname || '.' || tablename FROM pg_publication_tables;

SELECT 'database-owner', datname, pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database();

SELECT 'migrations-recorded', count(*) FROM kinboard.schema_migrations;

-- Last, so a dump cut short by an error can't compare equal to another cut
-- short at the same place: compare-dumps.sh requires this line.
SELECT 'end-of-dump';
