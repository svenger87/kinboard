// Turns introspect.mjs's model into src/types/database.generated.ts
// (RFC-024 §4.6 step 4). A pure function of the model, so a spec can pin it.
//
// The shape is the `Database` type @supabase/postgrest-js is typed by, as the
// Supabase CLI's generator writes it: per table `Row`, `Insert`, `Update` and
// `Relationships`; `Views`, `Functions`, `Enums`, `CompositeTypes`. Two
// things the CLI doesn't do and this does:
//
// - a text column whose CHECK constraint lists the values it may hold
//   (`kind = ANY (ARRAY['a', 'b'])`, or `kind = 'a' AND … OR kind = 'b' AND …`)
//   is typed as those literals, `"a" | "b"`. Those unions were what the
//   hand-written types added by hand; from the constraint they cannot drift.
// - nothing Supabase-specific (`__InternalSupabase`, helper generics): the
//   app's own helpers live in src/types/database.ts.

const HEADER = `// Generated from the migrated database by \`npm run db:generate\`
// (scripts/db-types/generate.mjs, RFC-024 §4.6). Do not edit: CI regenerates
// it from init.sql and every migration and fails on any difference.
// Hand-written additions belong in src/types/database.ts.
`;

const JSON_TYPE = `export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]
`;

const BASE = {
  bool: "boolean",
  int2: "number", int4: "number", int8: "number", float4: "number", float8: "number", numeric: "number", oid: "number",
  json: "Json", jsonb: "Json",
  text: "string", varchar: "string", bpchar: "string", char: "string", name: "string", citext: "string",
  uuid: "string", date: "string", time: "string", timetz: "string", timestamp: "string", timestamptz: "string",
  interval: "string", inet: "string", cidr: "string", macaddr: "string", bytea: "string", tsvector: "string",
  void: "undefined",
  record: "Record<string, unknown>",
};
const TEXTUAL = new Set(["text", "varchar", "bpchar", "char", "citext"]);

function scalar(t, schema) {
  if (!t) return "unknown";
  if (t.typtype === "d" && t.domainBase) return BASE[t.domainBase] ?? "unknown";
  if (t.typtype === "e" && t.schema === schema) return `Database[${q(schema)}]["Enums"][${q(t.name)}]`;
  if (t.typtype === "c" && t.schema === schema) {
    if (t.relkind === "c") return `Database[${q(schema)}]["CompositeTypes"][${q(t.name)}]`;
    if (t.relkind === "v" || t.relkind === "m") return `Database[${q(schema)}]["Views"][${q(t.name)}]["Row"]`;
    return `Database[${q(schema)}]["Tables"][${q(t.name)}]["Row"]`;
  }
  return BASE[t.name] ?? "unknown";
}

/** The TypeScript type of a column or argument of type `t`. */
export function tsType(t, schema = "public") {
  if (t?.elem) {
    const inner = scalar({ ...t.elem, relkind: t.relkind }, schema);
    return /[| ]/.test(inner) ? `(${inner})[]` : `${inner}[]`;
  }
  return scalar(t, schema);
}

const q = (s) => JSON.stringify(s);
const key = (s) => (/^[A-Za-z_$][\w$]*$/.test(s) ? s : q(s));

// ---------------------------------------------------------------- CHECK

/** Strip parentheses that wrap the whole expression. */
function unwrap(e) {
  e = e.trim();
  while (e.startsWith("(") && closing(e, 0) === e.length - 1) e = e.slice(1, -1).trim();
  return e;
}

/** Index of the parenthesis that closes the one at `start`, skipping string literals. */
function closing(e, start) {
  let depth = 0;
  for (let i = start; i < e.length; i++) {
    const c = e[i];
    if (c === "'") { i = endOfLiteral(e, i); continue; }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}

function endOfLiteral(e, i) {
  for (let j = i + 1; j < e.length; j++) {
    if (e[j] === "'") { if (e[j + 1] === "'") { j++; continue; } return j; }
  }
  return e.length;
}

/** Split on ` AND ` or ` OR ` outside parentheses and literals. */
function splitTop(e, op) {
  const parts = [];
  let depth = 0, last = 0;
  const sep = ` ${op} `;
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (c === "'") { i = endOfLiteral(e, i); continue; }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && e.startsWith(sep, i)) { parts.push(e.slice(last, i)); last = i + sep.length; i += sep.length - 1; }
  }
  parts.push(e.slice(last));
  return parts;
}

const LITERAL = /'((?:[^']|'')*)'::(?:text|character varying|bpchar|character)/g;
const literals = (s) => [...s.matchAll(LITERAL)].map((m) => m[1].replace(/''/g, "'"));
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The values `column` may hold under one boolean expression: a Set, or null
 * when the expression doesn't confine it. `column IS NULL` allows no value
 * (the column's nullability says whether null is allowed).
 */
function allowed(expr, column) {
  const e = unwrap(expr);
  const ors = splitTop(e, "OR");
  if (ors.length > 1) {
    const out = new Set();
    for (const part of ors) {
      const s = allowed(part, column);
      if (s === null) return null;
      s.forEach((v) => out.add(v));
    }
    return out;
  }
  const ands = splitTop(e, "AND");
  if (ands.length > 1) {
    let out = null;
    for (const part of ands) {
      const s = allowed(part, column);
      if (s !== null) out = out === null ? s : new Set([...out].filter((v) => s.has(v)));
    }
    return out;
  }
  const col = `\\(?${escape(column)}\\)?(?:::[a-z ]+)?`;
  if (new RegExp(`^${col} IS NULL$`).test(e)) return new Set();
  const any = new RegExp(`^${col} = ANY \\((.*)\\)$`).exec(e);
  if (any && /^\(*ARRAY\[/.test(any[1])) return new Set(literals(any[1]));
  const eq = new RegExp(`^${col} = ('(?:[^']|'')*'::[a-z ]+)$`).exec(e);
  if (eq) return new Set(literals(eq[1]));
  return null;
}

/** The literals a table's CHECK constraints confine `column` to, or null. */
export function checkedValues(checks, column) {
  let out = null;
  for (const def of checks) {
    const m = /^CHECK \((.*)\)( NOT VALID)?$/s.exec(def);
    if (!m || m[2]) continue; // a NOT VALID check may not hold for old rows
    const s = allowed(m[1], column);
    if (s !== null) out = out === null ? s : new Set([...out].filter((v) => s.has(v)));
  }
  return out && out.size ? [...out] : null;
}

// --------------------------------------------------------------- render

function columnType(table, c, schema) {
  if (!c.type.elem && TEXTUAL.has(c.type.typtype === "d" ? c.type.domainBase : c.type.name)) {
    const values = checkedValues(table.checks ?? [], c.name);
    if (values) return values.map(q).join(" | ");
  }
  return tsType(c.type, schema);
}

const orNull = (type, nullable) => (nullable ? `${type} | null` : type);

function block(indent, lines) {
  if (!lines.length) return "{ [_ in never]: never }";
  const pad = " ".repeat(indent);
  return `{\n${lines.map((l) => pad + "  " + l).join("\n")}\n${pad}}`;
}

function relation(rel, schema, indent, { insert, update }) {
  const row = rel.columns.map((c) => `${key(c.name)}: ${orNull(columnType(rel, c, schema), c.nullable)}`);
  const ins = rel.columns.map((c) => {
    if (c.generated || c.identityAlways) return `${key(c.name)}?: never`;
    const optional = c.nullable || c.hasDefault || insert === "all-optional";
    return `${key(c.name)}${optional ? "?" : ""}: ${orNull(columnType(rel, c, schema), c.nullable)}`;
  });
  const upd = rel.columns.map((c) => (c.generated || c.identityAlways
    ? `${key(c.name)}?: never`
    : `${key(c.name)}?: ${orNull(columnType(rel, c, schema), c.nullable)}`));
  const rels = (rel.relationships ?? []).map((r) => [
    `foreignKeyName: ${q(r.foreignKeyName)}`,
    `columns: [${r.columns.map(q).join(", ")}]`,
    `isOneToOne: ${r.isOneToOne}`,
    `referencedRelation: ${q(r.referencedRelation)}`,
    `referencedColumns: [${r.referencedColumns.map(q).join(", ")}]`,
  ]);
  const pad = " ".repeat(indent + 2);
  const lines = [`Row: ${block(indent + 2, row)}`];
  if (insert) lines.push(`Insert: ${block(indent + 2, ins)}`);
  if (update) lines.push(`Update: ${block(indent + 2, upd)}`);
  lines.push(rels.length
    ? `Relationships: [\n${rels.map((r) => `${pad}  ${block(indent + 4, r)},`).join("\n")}\n${pad}]`
    : "Relationships: []");
  return block(indent, lines);
}

function fn(f, schema, indent) {
  const args = f.args.length
    ? block(indent + 2, f.args.map((a) => `${key(a.name)}${a.hasDefault ? "?" : ""}: ${tsType(a.type, schema)}`))
    : "never";
  let returns;
  if (f.outArgs.length) {
    returns = block(indent + 2, f.outArgs.map((a) => `${key(a.name)}: ${tsType(a.type, schema)}`));
    if (f.returnsSet) returns += "[]";
  } else {
    returns = tsType(f.returns, schema);
    if (f.returnsSet) returns = /[| ]/.test(returns) ? `(${returns})[]` : `${returns}[]`;
  }
  return block(indent, [`Args: ${args}`, `Returns: ${returns}`]);
}

/** The whole file. */
export function render(model) {
  const s = model.schema;
  const tables = model.tables.map((t) => `${key(t.name)}: ${relation(t, s, 6, { insert: "rules", update: true })}`);
  const views = model.views.map((v) => `${key(v.name)}: ${relation({ ...v, relationships: [] }, s, 6, {
    insert: v.insertable ? "all-optional" : null,
    update: v.updatable,
  })}`);

  // Overloads of one name become a union of their signatures.
  const byName = new Map();
  for (const f of model.functions) {
    if (f.args.some((a) => !a.name)) continue; // PostgREST calls by argument name
    byName.set(f.name, [...(byName.get(f.name) ?? []), f]);
  }
  const functions = [...byName].map(([name, overloads]) => (overloads.length === 1
    ? `${key(name)}: ${fn(overloads[0], s, 6)}`
    : `${key(name)}:\n${overloads.map((f) => `        | ${fn(f, s, 8)}`).join("\n")}`));
  const enums = model.enums.map((e) => `${key(e.name)}: ${e.labels.map(q).join(" | ")}`);
  const composites = model.composites.map((c) => `${key(c.name)}: ${block(6, c.columns.map((col) => `${key(col.name)}: ${orNull(tsType(col.type, s), true)}`))}`);

  const schema = block(2, [
    `Tables: ${block(4, tables)}`,
    `Views: ${block(4, views)}`,
    `Functions: ${block(4, functions)}`,
    `Enums: ${block(4, enums)}`,
    `CompositeTypes: ${block(4, composites)}`,
  ]);
  return `${HEADER}\n${JSON_TYPE}\nexport type Database = ${block(0, [`${key(s)}: ${schema}`])}\n`;
}
