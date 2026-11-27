// Reads the `public` schema out of pg_catalog into a plain model that
// render.mjs turns into TypeScript (RFC-024 §4.6 step 4).
//
// Only what PostgREST serves and the query builder's types describe: tables,
// views, their columns and foreign keys, functions, enums and composite types.
// Every list is ordered by name in SQL with "C" collation, so the output does
// not depend on the database's locale.

/** @param {import("postgres").Sql} sql */
export async function introspect(sql, schema = "public") {
  const relations = await sql`
    SELECT c.oid::int AS oid, c.relname AS name, c.relkind AS kind,
           pg_relation_is_updatable(c.oid, false) AS updatable
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ${schema} AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     ORDER BY c.relname COLLATE "C"`;

  const columns = await sql`
    SELECT a.attrelid::int AS rel, a.attname AS name, a.attnum AS num,
           NOT a.attnotnull AS nullable,
           a.atthasdef AS has_default, a.attidentity AS identity, a.attgenerated AS generated,
           t.typname AS type, t.typtype AS typtype, tn.nspname AS type_schema,
           et.typname AS elem, et.typtype AS elem_typtype, etn.nspname AS elem_schema,
           bt.typname AS domain_base, ebt.typname AS elem_domain_base,
           (SELECT relkind FROM pg_class WHERE oid = coalesce(et.typrelid, t.typrelid) AND coalesce(et.typrelid, t.typrelid) <> 0) AS type_relkind
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_type t ON t.oid = a.atttypid
      JOIN pg_namespace tn ON tn.oid = t.typnamespace
      LEFT JOIN pg_type et ON et.oid = t.typelem AND t.typcategory = 'A'
      LEFT JOIN pg_namespace etn ON etn.oid = et.typnamespace
      LEFT JOIN pg_type bt ON bt.oid = t.typbasetype AND t.typtype = 'd'
      LEFT JOIN pg_type ebt ON ebt.oid = et.typbasetype AND et.typtype = 'd'
     WHERE n.nspname = ${schema} AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'c')
       AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY c.relname COLLATE "C", a.attname COLLATE "C"`;

  // Single-table CHECK constraints, deparsed; render.mjs narrows text columns
  // to the literals a check allows.
  const checks = await sql`
    SELECT c.conrelid::int AS rel, c.conname AS name, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = ${schema} AND c.contype = 'c'
     ORDER BY c.conname COLLATE "C"`;

  // Foreign keys between relations of this schema. One-to-one when the
  // referencing columns are exactly a unique, non-partial index's columns.
  const foreignKeys = await sql`
    SELECT c.conrelid::int AS rel, c.conname AS name, ref.relname AS referenced,
           array(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(num, i)
                   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num ORDER BY k.i) AS columns,
           array(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(num, i)
                   JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.num ORDER BY k.i) AS referenced_columns,
           EXISTS (
             SELECT 1 FROM pg_index i
              WHERE i.indrelid = c.conrelid AND i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL
                AND (SELECT array_agg(x ORDER BY x) FROM unnest(i.indkey::int2[]) x)
                  = (SELECT array_agg(x ORDER BY x) FROM unnest(c.conkey) x)
           ) AS one_to_one
      FROM pg_constraint c
      JOIN pg_class src ON src.oid = c.conrelid
      JOIN pg_namespace sn ON sn.oid = src.relnamespace
      JOIN pg_class ref ON ref.oid = c.confrelid
      JOIN pg_namespace rn ON rn.oid = ref.relnamespace
     WHERE c.contype = 'f' AND sn.nspname = ${schema} AND rn.nspname = ${schema}
     ORDER BY c.conname COLLATE "C", ref.relname COLLATE "C"`;

  // Functions PostgREST can call: not trigger or event-trigger functions,
  // not aggregates or procedures.
  const functions = await sql`
    SELECT p.oid::int AS oid, p.proname AS name, p.proretset AS returns_set,
           p.pronargdefaults AS n_defaults, p.pronargs AS n_in,
           coalesce(p.proargnames, '{}') AS arg_names,
           coalesce(p.proargmodes::text[], '{}') AS arg_modes,
           array(SELECT x::int FROM unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) x) AS arg_types,
           p.prorettype::int AS return_type
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = ${schema} AND p.prokind = 'f'
       AND p.prorettype NOT IN ('trigger'::regtype, 'event_trigger'::regtype)
     ORDER BY p.proname COLLATE "C", pg_get_function_identity_arguments(p.oid) COLLATE "C"`;

  // Every type a function argument or result names, resolved once.
  const typeOids = [...new Set(functions.flatMap((f) => [...f.arg_types, f.return_type]))];
  const types = typeOids.length
    ? await sql`
      SELECT t.oid::int AS oid, t.typname AS type, t.typtype AS typtype, tn.nspname AS type_schema,
             et.typname AS elem, et.typtype AS elem_typtype, etn.nspname AS elem_schema,
             bt.typname AS domain_base, ebt.typname AS elem_domain_base,
             (SELECT relkind FROM pg_class WHERE oid = coalesce(et.typrelid, t.typrelid) AND coalesce(et.typrelid, t.typrelid) <> 0) AS type_relkind
        FROM pg_type t
        JOIN pg_namespace tn ON tn.oid = t.typnamespace
        LEFT JOIN pg_type et ON et.oid = t.typelem AND t.typcategory = 'A'
        LEFT JOIN pg_namespace etn ON etn.oid = et.typnamespace
        LEFT JOIN pg_type bt ON bt.oid = t.typbasetype AND t.typtype = 'd'
        LEFT JOIN pg_type ebt ON ebt.oid = et.typbasetype AND et.typtype = 'd'
       WHERE t.oid = ANY(${typeOids})`
    : [];

  const enums = await sql`
    SELECT t.typname AS name, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_enum e ON e.enumtypid = t.oid
     WHERE n.nspname = ${schema}
     GROUP BY t.typname
     ORDER BY t.typname COLLATE "C"`;

  const composites = await sql`
    SELECT c.oid::int AS oid, t.typname AS name
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_class c ON c.oid = t.typrelid
     WHERE n.nspname = ${schema} AND t.typtype = 'c' AND c.relkind = 'c'
     ORDER BY t.typname COLLATE "C"`;

  const typeRef = (r) => ({
    name: r.type, typtype: r.typtype, schema: r.type_schema,
    elem: r.elem ? { name: r.elem, typtype: r.elem_typtype, schema: r.elem_schema, domainBase: r.elem_domain_base } : null,
    domainBase: r.domain_base, relkind: r.type_relkind,
  });
  const typeByOid = new Map(types.map((t) => [t.oid, typeRef(t)]));
  const columnsOf = (oid) => columns.filter((c) => c.rel === oid).map((c) => ({
    name: c.name,
    nullable: c.nullable,
    hasDefault: c.has_default || c.identity !== "",
    identityAlways: c.identity === "a",
    generated: c.generated !== "",
    type: typeRef(c),
  }));

  return {
    schema,
    tables: relations.filter((r) => r.kind === "r" || r.kind === "p" || r.kind === "f").map((r) => ({
      name: r.name,
      columns: columnsOf(r.oid),
      checks: checks.filter((c) => c.rel === r.oid).map((c) => c.def),
      relationships: foreignKeys.filter((f) => f.rel === r.oid).map((f) => ({
        foreignKeyName: f.name, columns: f.columns, isOneToOne: f.one_to_one,
        referencedRelation: f.referenced, referencedColumns: f.referenced_columns,
      })),
    })),
    views: relations.filter((r) => r.kind === "v" || r.kind === "m").map((r) => ({
      name: r.name,
      // pg_relation_is_updatable's bitmask: 4 UPDATE, 8 INSERT.
      insertable: (r.updatable & 8) === 8,
      updatable: (r.updatable & 4) === 4,
      columns: columnsOf(r.oid),
    })),
    functions: functions.map((f) => {
      // proargmodes is empty when every argument is IN.
      const modes = f.arg_modes.length ? f.arg_modes : f.arg_types.map(() => "i");
      const args = f.arg_types.map((oid, i) => ({ name: f.arg_names[i] ?? "", mode: modes[i], type: typeByOid.get(oid) }));
      const inArgs = args.filter((a) => a.mode === "i" || a.mode === "b" || a.mode === "v");
      // The last pronargdefaults IN arguments have defaults.
      inArgs.forEach((a, i) => { a.hasDefault = i >= inArgs.length - f.n_defaults; });
      return {
        name: f.name,
        returnsSet: f.returns_set,
        args: inArgs,
        outArgs: args.filter((a) => a.mode === "o" || a.mode === "b" || a.mode === "t"),
        returns: typeByOid.get(f.return_type),
      };
    }),
    enums: enums.map((e) => ({ name: e.name, labels: e.labels })),
    composites: composites.map((c) => ({ name: c.name, columns: columnsOf(c.oid) })),
  };
}
