-- table-checksums.sql: every table of `public` and `kinboard` as
-- "<schema>.<table> <rows> <md5>", computed here rather than taken from the
-- export's own manifest, so the rig does not check the transfer with the
-- transfer's own arithmetic. Rows go through to_jsonb (keys sorted, so the
-- column order of an upgraded database and a fresh one cannot matter), in UTC.
-- kinboard.schema_migrations is the target's own record and not data.
SET TimeZone = 'UTC';
SET extra_float_digits = 1;
SELECT format('%s.%s', n.nspname, c.relname) || ' ' ||
       (xpath('/row/r/text()', query_to_xml(format(
         'SELECT count(*) || '' '' || coalesce(md5(string_agg(h, '''' ORDER BY h)), ''-'') AS r FROM (SELECT md5(to_jsonb(t)::text) AS h FROM %I.%I t) s',
         n.nspname, c.relname), false, true, '')))[1]::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND n.nspname IN ('public', 'kinboard')
   AND NOT (n.nspname = 'kinboard' AND c.relname = 'schema_migrations')
 ORDER BY 1;
