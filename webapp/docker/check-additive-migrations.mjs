// Additive-migrations lint.
//
// UPGRADING.md promises "migrations are additive, so the older image runs on
// the newer schema". That promise is what makes a rollback safe: when an
// update doesn't come up, the previous image is started again on a database
// the new image has already migrated (RFC-023 §4.11.4). Until this file the
// promise was stated and never checked.
//
// This refuses the statements that would break it — anything that takes away
// or reshapes something an older image may still read or write:
//
//   drop-table          DROP TABLE (a temp table this file creates is fine)
//   drop-column         ALTER TABLE … DROP [COLUMN] x
//   drop-object         DROP TYPE / FUNCTION / PROCEDURE / VIEW / MATERIALIZED
//                       VIEW / SCHEMA / SEQUENCE / DOMAIN / EXTENSION — unless
//                       the same file creates an object of that kind and name
//                       again. Drop-and-recreate is how a function's return
//                       type or a view's columns change, and it is common.
//   alter-column-type   ALTER COLUMN x [SET DATA] TYPE …
//   rename              any RENAME (table, column, constraint, type value, …)
//   set-not-null        SET NOT NULL on a column an older image may still
//                       leave empty: allowed only on a table this file
//                       creates, or a column this file adds with a DEFAULT
//   add-not-null        ADD COLUMN … NOT NULL with no DEFAULT on a table this
//                       file doesn't create: an older image's INSERT doesn't
//                       name the column and fails
//   truncate            TRUNCATE (REVOKE/GRANT … TRUNCATE is fine)
//   delete-without-where  DELETE FROM … with no WHERE
//
// Deliberately allowed: DROP POLICY, DROP TRIGGER, DROP INDEX, DROP
// CONSTRAINT, DROP DEFAULT, DROP NOT NULL. They don't remove anything a query
// names, and the policy and trigger pairs (drop if exists, create) are how
// every migration here stays idempotent.
//
// The escape hatch, for a change that has to be destructive: the file carries
//
//   -- not-additive: <why, and what an older image does on the new schema>
//
// AND webapp/docker/migrations-not-additive.json has an entry for the file
// naming the rules it breaks. Both, on purpose: the marker is what a reviewer
// reads in the migration, the list is one place to see every exception the
// project has accepted. A marker without an entry, an entry without a marker,
// an entry for a rule the file no longer breaks: each one fails.
//
// Files up to GRANDFATHERED_THROUGH shipped before this check existed and are
// listed with `"grandfathered": true` and no marker. They cannot get one:
// migrate.sh records each file's checksum, and an edited file is re-applied on
// every install together with every file after it.
//
// Every file is checked, not just the ones a PR adds. That needs no git
// history, and it catches an old file edited into something destructive.
//
// Matching is textual: comments are ignored, string literals are not (dynamic
// SQL in EXECUTE format('…') is checked like any other statement).
//
// The publication guard (RFC-024 §4.6 step 5), in the same pass because it
// reads the same files the same way. Since 1.15 nothing reads the
// `supabase_realtime` publication: live updates come from the
// kinboard_change_feed trigger (migrations/084_change_feed.sql), and a table
// that should stream live needs that trigger, not publication membership
// (e2e/realtime-change-feed.spec.ts checks the trigger side). Stock
// PostgreSQL installs only have the publication because db-init creates it,
// empty, so the old files still apply. So a migration numbered after
// PUBLICATION_FROZEN_THROUGH may not:
//
//   publication   CREATE PUBLICATION, ALTER PUBLICATION … ADD …, ALTER
//                 PUBLICATION … SET <tables> (SET (publish = …) is not
//                 refused), or FOR ALL TABLES anywhere
//
// whatever the case, spacing, quoting or line breaks, and in dynamic SQL too.
// There is no escape hatch: the allow-list doesn't know the rule. ALTER
// PUBLICATION … DROP TABLE and DROP PUBLICATION stay allowed: they are how
// the publication goes away one day. The older files keep their ADD TABLE
// lines; editing them would re-apply them on every install.
//
// Run: node webapp/docker/check-additive-migrations.mjs   (from repo root)
//      [--dir <migrations dir>] [--allowlist <json file>]

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const GRANDFATHERED_THROUGH = 93;
// The last migration that may still add tables to a publication.
export const PUBLICATION_FROZEN_THROUGH = 95;

const RULES = [
  "drop-table",
  "drop-column",
  "drop-object",
  "alter-column-type",
  "rename",
  "set-not-null",
  "add-not-null",
  "truncate",
  "delete-without-where",
];

const MARKER_RE = /^[ \t]*--[ \t]*not-additive:(.*)$/gim;

// ------------------------------------------------------------------ scanning

/**
 * Blank out comments (keeping newlines, so offsets stay line-accurate) and
 * split on semicolons outside string literals and quoted identifiers. Dollar
 * quotes are left as code: their bodies are SQL (DO blocks, functions) and the
 * statements in them are checked too.
 */
export function scan(sql) {
  const n = sql.length;
  let out = "";
  const statements = [];
  let start = 0;
  let i = 0;
  const blank = (s) => s.replace(/[^\n]/g, " ");
  while (i < n) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === "-" && d === "-") {
      const nl = sql.indexOf("\n", i);
      const e = nl < 0 ? n : nl;
      out += blank(sql.slice(i, e));
      i = e;
      continue;
    }
    if (c === "/" && d === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === "/" && sql[j + 1] === "*") { depth++; j += 2; }
        else if (sql[j] === "*" && sql[j + 1] === "/") { depth--; j += 2; }
        else j++;
      }
      out += blank(sql.slice(i, j));
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      const escapes = c === "'" && /[eE]/.test(sql[i - 1] ?? "") && !/\w/.test(sql[i - 2] ?? "");
      let j = i + 1;
      while (j < n) {
        if (escapes && sql[j] === "\\") { j += 2; continue; }
        if (sql[j] === c) {
          if (sql[j + 1] === c) { j += 2; continue; }
          break;
        }
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === ";") {
      statements.push({ start, end: i });
      out += c;
      start = i + 1;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  if (out.slice(start).trim()) statements.push({ start, end: n });
  return { code: out, statements: statements.map((s) => ({ ...s, text: out.slice(s.start, s.end) })) };
}

const ident = (raw) =>
  raw
    .replace(/"/g, "")
    .replace(/^public\./i, "")
    .toLowerCase();

const NAME = String.raw`((?:"[^"]+"|[\w%]+)(?:\.(?:"[^"]+"|[\w%]+))?)`;

/** Split on commas at paren depth 0, outside quotes. */
function topLevelCommas(s) {
  const parts = [];
  let depth = 0;
  let q = null;
  let cur = "";
  for (const ch of s) {
    if (q) { if (ch === q) q = null; cur += ch; continue; }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

/** Every ALTER TABLE in a statement, with its target and the text after it. */
function alterTables(text) {
  const re = new RegExp(String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${NAME}`, "gi");
  const out = [];
  for (const m of text.matchAll(re)) {
    out.push({ table: ident(m[1]), body: text.slice(m.index + m[0].length), at: m.index });
  }
  return out;
}

const OBJECT_KINDS = [
  "MATERIALIZED VIEW",
  "VIEW",
  "TYPE",
  "FUNCTION",
  "PROCEDURE",
  "SCHEMA",
  "SEQUENCE",
  "DOMAIN",
  "EXTENSION",
];

/** Names in `DROP FUNCTION IF EXISTS a(int), b() CASCADE`. */
function droppedNames(rest) {
  let s = "";
  let depth = 0;
  for (const ch of rest) {
    if (ch === "(") { depth++; continue; }
    if (ch === ")") { depth--; continue; }
    if (depth === 0) s += ch;
  }
  s = s.replace(/\b(CASCADE|RESTRICT)\b/gi, "");
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => ident(x.split(/\s+/)[0]));
}

/** What a file creates, so drop-and-recreate pairs and new tables are known. */
function inventory(code) {
  const created = new Map(); // kind -> Set(name)
  const add = (kind, name) => {
    if (!created.has(kind)) created.set(kind, new Set());
    created.get(kind).add(ident(name));
  };
  const tables = new Set();
  const tempTables = new Set();
  for (const m of code.matchAll(
    new RegExp(String.raw`\bCREATE\s+(?:(TEMP|TEMPORARY|UNLOGGED)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${NAME}`, "gi"),
  )) {
    tables.add(ident(m[2]));
    if (m[1] && /^TEMP/i.test(m[1])) tempTables.add(ident(m[2]));
  }
  for (const kind of OBJECT_KINDS) {
    const k = kind.replace(" ", String.raw`\s+`);
    const re = new RegExp(
      String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP\s+|TEMPORARY\s+|RECURSIVE\s+)?${k}\s+(?:IF\s+NOT\s+EXISTS\s+)?${NAME}`,
      "gi",
    );
    for (const m of code.matchAll(re)) add(kind, m[1]);
  }
  // Columns added with a default, per table.
  const defaulted = new Map();
  for (const at of alterTables(code)) {
    const stmtEnd = at.body.indexOf(";");
    const body = stmtEnd < 0 ? at.body : at.body.slice(0, stmtEnd);
    for (const clause of topLevelCommas(body)) {
      const m = /^\s*ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?("?[\w]+"?)\s+([\s\S]*)$/i.exec(clause);
      if (!m || /^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE)$/i.test(m[1])) continue;
      if (/\bDEFAULT\b/i.test(m[2])) {
        if (!defaulted.has(at.table)) defaulted.set(at.table, new Set());
        defaulted.get(at.table).add(ident(m[1]));
      }
    }
    for (const m of body.matchAll(/\bALTER\s+(?:COLUMN\s+)?("?[\w]+"?)\s+SET\s+DEFAULT\b/gi)) {
      if (!defaulted.has(at.table)) defaulted.set(at.table, new Set());
      defaulted.get(at.table).add(ident(m[1]));
    }
  }
  return { created, tables, tempTables, defaulted };
}

/** The destructive statements in one file: [{rule, offset, excerpt}]. */
export function findViolations(sql) {
  const { code, statements } = scan(sql);
  const inv = inventory(code);
  const found = [];
  const hit = (rule, offset, excerpt) =>
    found.push({ rule, offset, excerpt: excerpt.replace(/\s+/g, " ").trim().slice(0, 120) });

  for (const st of statements) {
    const t = st.text;

    for (const m of t.matchAll(new RegExp(String.raw`\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^;]*)`, "gi"))) {
      // ALTER PUBLICATION … DROP TABLE takes a table out of a publication, and
      // leaves the table alone.
      if (new RegExp(String.raw`\bALTER\s+PUBLICATION\s+${NAME}\s*$`, "i").test(t.slice(0, m.index))) continue;
      const names = droppedNames(m[1]);
      if (names.length && names.every((n) => inv.tempTables.has(n))) continue;
      hit("drop-table", st.start + m.index, m[0]);
    }

    for (const kind of OBJECT_KINDS) {
      const k = kind.replace(" ", String.raw`\s+`);
      // `DROP VIEW` can't match inside `DROP MATERIALIZED VIEW`: the word sits between.
      const re = new RegExp(String.raw`\bDROP\s+${k}\s+(?:IF\s+EXISTS\s+)?([^;]*)`, "gi");
      for (const m of t.matchAll(re)) {
        const names = droppedNames(m[1]);
        const again = inv.created.get(kind) ?? new Set();
        if (names.length && names.every((n) => again.has(n))) continue;
        hit("drop-object", st.start + m.index, m[0]);
      }
    }

    for (const at of alterTables(t)) {
      const off = st.start + at.at;
      for (const m of at.body.matchAll(/\bDROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?("?[\w%]+"?)/gi)) {
        if (/^(CONSTRAINT|DEFAULT|NOT|IDENTITY|EXPRESSION)$/i.test(m[1])) continue;
        hit("drop-column", off, `ALTER TABLE ${at.table} ${m[0]}`);
      }
      for (const m of at.body.matchAll(/\bALTER\s+(?:COLUMN\s+)?("?[\w%]+"?)\s+(?:SET\s+DATA\s+)?TYPE\b/gi)) {
        hit("alter-column-type", off, `ALTER TABLE ${at.table} ${m[0]}`);
      }
      for (const m of at.body.matchAll(/\bALTER\s+(?:COLUMN\s+)?("?[\w%]+"?)\s+SET\s+NOT\s+NULL\b/gi)) {
        const col = ident(m[1]);
        if (inv.tables.has(at.table)) continue;
        if (inv.defaulted.get(at.table)?.has(col)) continue;
        hit("set-not-null", off, `ALTER TABLE ${at.table} ${m[0]}`);
      }
      if (!inv.tables.has(at.table)) {
        for (const clause of topLevelCommas(at.body)) {
          const m = /^\s*ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?("?[\w]+"?)\s+([\s\S]*)$/i.exec(clause);
          if (!m || /^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE)$/i.test(m[1])) continue;
          if (/\bNOT\s+NULL\b/i.test(m[2]) && !/\b(DEFAULT|GENERATED)\b/i.test(m[2])) {
            hit("add-not-null", off, `ALTER TABLE ${at.table} ADD ${m[1]} ${m[2]}`);
          }
        }
      }
    }

    for (const m of t.matchAll(/\bRENAME\s+(?:(?:COLUMN|CONSTRAINT|VALUE|ATTRIBUTE)\s+)?(?:"[^"]+"|'[^']+'|[\w%]+)\s+TO\b|\bRENAME\s+TO\b/gi)) {
      hit("rename", st.start + m.index, t.slice(Math.max(0, m.index - 60), m.index + m[0].length + 30));
    }

    for (const m of t.matchAll(/(^\s*|\bEXECUTE\s+(?:format\s*\(\s*)?'\s*|\bTHEN\s+|\bLOOP\s+|\bBEGIN\s+|\bELSE\s+)TRUNCATE\b/gi)) {
      hit("truncate", st.start + m.index, t.slice(m.index, m.index + 80));
    }

    for (const m of t.matchAll(/\bDELETE\s+FROM\b/gi)) {
      if (/\bWHERE\b/i.test(t.slice(m.index))) continue;
      hit("delete-without-where", st.start + m.index, t.slice(m.index, m.index + 80));
    }
  }

  const lineOf = (offset) => sql.slice(0, offset).split("\n").length;
  return found.map((f) => {
    // Point at the keyword itself, not at the whitespace before it.
    // `code` has comments blanked, so a statement after a comment line points at the statement.
    const lead = code.slice(f.offset).match(/^\s*/)[0].length;
    return { ...f, line: lineOf(f.offset + lead) };
  });
}

/**
 * Statements that would put tables in a publication, or make one:
 * [{rule: "publication", line, excerpt}]. Comments are ignored; string
 * literals are not, so EXECUTE 'ALTER PUBLICATION … ADD TABLE …' counts.
 */
export function findPublicationChanges(sql) {
  const { code, statements } = scan(sql);
  const found = [];
  const res = [
    /\bCREATE\s+PUBLICATION\b/gi,
    new RegExp(String.raw`\bALTER\s+PUBLICATION\s+${NAME}\s+(?:ADD\b|SET\s+(?!\())`, "gi"),
    /\bFOR\s+ALL\s+TABLES\b/gi,
  ];
  for (const st of statements) {
    // CREATE PUBLICATION … FOR ALL TABLES is one statement, reported once.
    const make = /\bCREATE\s+PUBLICATION\b/i.test(st.text);
    for (const re of make ? res.slice(0, 2) : res) {
      for (const m of st.text.matchAll(re)) {
        const at = st.start + m.index;
        const text = code.slice(at, Math.min(st.end, at + 120));
        found.push({ rule: "publication", offset: at, excerpt: text.replace(/\s+/g, " ").trim().slice(0, 120) });
      }
    }
  }
  const lineOf = (offset) => sql.slice(0, offset).split("\n").length;
  return found.map((f) => ({ ...f, line: lineOf(f.offset) }));
}

export function markersIn(sql) {
  return [...sql.matchAll(MARKER_RE)].map((m) => m[1].trim());
}

// ------------------------------------------------------------------- checking

export function check({ dir, allowlistPath }) {
  const problems = [];
  const publication = [];
  const files = readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  let list = { entries: [] };
  if (existsSync(allowlistPath)) {
    try {
      list = JSON.parse(readFileSync(allowlistPath, "utf8"));
    } catch (e) {
      problems.push(`${allowlistPath} is not valid JSON: ${e.message}`);
      return { problems, publication, files: files.length, allowed: 0 };
    }
  }
  const entries = new Map();
  for (const e of list.entries ?? []) {
    if (!e.file || !Array.isArray(e.rules) || !e.rules.length) {
      problems.push(`allow-list entry ${JSON.stringify(e)} needs "file" and a non-empty "rules" list.`);
      continue;
    }
    if (entries.has(e.file)) problems.push(`allow-list has ${e.file} twice; merge the entries.`);
    if (!e.reason || e.reason.trim().length < 20) {
      problems.push(`allow-list entry for ${e.file} needs a "reason" a reviewer can judge (20+ characters).`);
    }
    for (const r of e.rules) if (!RULES.includes(r)) problems.push(`allow-list entry for ${e.file}: unknown rule "${r}".`);
    entries.set(e.file, e);
  }

  let allowed = 0;
  for (const f of files) {
    const sql = readFileSync(join(dir, f), "utf8");
    const num = parseInt(f, 10);
    const found = findViolations(sql);
    const markers = markersIn(sql);
    const entry = entries.get(f);
    entries.delete(f);

    if (num > PUBLICATION_FROZEN_THROUGH) {
      for (const v of findPublicationChanges(sql)) publication.push(`${f}:${v.line} [${v.rule}] ${v.excerpt}`);
    }

    if (markers.some((r) => r.length < 10)) {
      problems.push(`${f}: "-- not-additive:" needs a reason after the colon (what an older image does on this schema).`);
    }
    if (markers.length && !entry) {
      problems.push(
        `${f} carries "-- not-additive:" but has no entry in migrations-not-additive.json. ` +
          `Add one naming the rules it breaks, so the exception is reviewed where every other one is.`,
      );
    }
    if (entry) {
      if (entry.grandfathered) {
        if (num > GRANDFATHERED_THROUGH) {
          problems.push(
            `${f}: only files up to ${String(GRANDFATHERED_THROUGH).padStart(3, "0")} can be grandfathered. ` +
              `A new one needs a "-- not-additive: <reason>" line in the file instead.`,
          );
        }
      } else if (!markers.length) {
        problems.push(`${f} is in migrations-not-additive.json but the file has no "-- not-additive: <reason>" line.`);
      }
      const broken = new Set(found.map((v) => v.rule));
      for (const r of entry.rules) {
        if (!broken.has(r)) {
          problems.push(`${f}: allow-list accepts "${r}", but the file no longer does that. Remove the rule from its entry.`);
        }
      }
    }

    for (const v of found) {
      if (entry && entry.rules.includes(v.rule) && (entry.grandfathered ? num <= GRANDFATHERED_THROUGH : markers.length)) {
        allowed++;
        continue;
      }
      problems.push(`${f}:${v.line} [${v.rule}] ${v.excerpt}`);
    }
  }
  for (const f of entries.keys()) problems.push(`allow-list names ${f}, which is not a migration file. Remove the entry.`);
  return { problems, publication, files: files.length, allowed };
}

// ----------------------------------------------------------------------- main

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(name);
    return i > 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : dflt;
  };
  const dir = arg("--dir", join(here, "migrations"));
  const allowlistPath = arg("--allowlist", join(here, "migrations-not-additive.json"));
  const { problems, publication, files, allowed } = check({ dir, allowlistPath });
  if (publication.length) {
    console.error("New migrations don't add tables to a publication. Since 1.15 nothing reads");
    console.error("supabase_realtime; live updates come from the kinboard_change_feed trigger.");
    console.error("");
    for (const p of publication) console.error("  - " + p);
    console.error("");
    console.error("For a table that should update live on other screens, put the trigger on it in the same");
    console.error("migration, as migrations/086_layouts.sql does:");
    console.error("  DROP TRIGGER IF EXISTS kinboard_change_feed ON public.<table>;");
    console.error("  CREATE TRIGGER kinboard_change_feed AFTER INSERT OR UPDATE OR DELETE ON public.<table>");
    console.error("    FOR EACH ROW EXECUTE FUNCTION public.kinboard_notify_change();");
    console.error("and add the table to ALL_TABLES in src/hooks/use-realtime.ts.");
    if (problems.length) console.error("");
  }
  if (problems.length) {
    console.error("Migrations must be additive: an older image has to keep running on the newer schema,");
    console.error("because that is what an update falls back to when the new version doesn't come up.");
    console.error("");
    for (const p of problems) console.error("  - " + p);
    console.error("");
    console.error("Make the change additive (add a column instead of renaming one, keep the old one until");
    console.error("a later release stops reading it). If it truly cannot be, add a line");
    console.error("  -- not-additive: <why, and what an older image does on this schema>");
    console.error("to the migration and an entry for it in webapp/docker/migrations-not-additive.json.");
  }
  if (problems.length || publication.length) process.exit(1);
  console.log(
    `Migrations additive OK — ${files} files, ${allowed} accepted exception(s) from the allow-list; ` +
      `no publication changes after ${String(PUBLICATION_FROZEN_THROUGH).padStart(3, "0")}.`,
  );
}
