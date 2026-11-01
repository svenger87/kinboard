// Migration-order lint.
//
// Migrations apply in numeric order (migrations/NNN_topic.sql, see migrate.sh),
// after init.sql. A migration that ALTERs a table created only by a LATER one
// will fail on a fresh install (the table doesn't exist yet) — the exact
// footgun called out in start.sh's ordering note. This catches that before
// it ships.
//
// Conservative by design: it flags ONLY the provable case (an ALTER TABLE
// whose target is CREATEd by a migration that sorts later). Tables created
// in init.sql or in an earlier/same migration are fine; tables never created
// by any tracked file are left alone (they may come from extensions/Supabase).
//
// Run: node webapp/docker/check-migration-order.mjs   (from repo root)

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));

const CREATE_RE = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:ONLY\s+)?(?:public\.)?["']?([a-zA-Z0-9_]+)/gi;
const ALTER_RE = /ALTER TABLE(?:\s+IF EXISTS)?\s+(?:ONLY\s+)?(?:public\.)?["']?([a-zA-Z0-9_]+)/gi;

const tablesIn = (sql, re) => {
  const out = [];
  for (const m of sql.matchAll(re)) out.push(m[1].toLowerCase());
  return out;
};

// init.sql runs first (mounted as zz-init), so its tables exist before any migration.
const initTables = new Set();
try {
  for (const t of tablesIn(readFileSync(join(dir, "init.sql"), "utf8"), CREATE_RE)) {
    initTables.add(t);
  }
} catch {
  // no init.sql on disk in this checkout — fine, just means fewer "safe" tables
}

const migrationsDir = join(dir, "migrations");
const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

// Every file is NNN_topic.sql, and no two share a number: two branches that
// each took the next free number would otherwise apply in an order decided by
// their topic names, which nobody chose.
const numbering = [];
const seen = new Map();
for (const f of files) {
  const m = /^(\d{3})_[a-z0-9_]+\.sql$/.exec(f);
  if (!m) {
    numbering.push(`${f} is not named NNN_topic.sql (three digits, then [a-z0-9_]).`);
    continue;
  }
  if (seen.has(m[1])) numbering.push(`${f} and ${seen.get(m[1])} share the number ${m[1]}; renumber the newer one.`);
  seen.set(m[1], f);
}
if (numbering.length) {
  console.error("Migration naming problems found:");
  for (const v of numbering) console.error("  - " + v);
  process.exit(1);
}

// First migration index that CREATEs each table.
const createdAt = new Map();
files.forEach((f, i) => {
  for (const t of tablesIn(readFileSync(join(migrationsDir, f), "utf8"), CREATE_RE)) {
    if (!createdAt.has(t)) createdAt.set(t, i);
  }
});

const violations = [];
files.forEach((f, i) => {
  for (const t of tablesIn(readFileSync(join(migrationsDir, f), "utf8"), ALTER_RE)) {
    if (initTables.has(t)) continue;
    const created = createdAt.get(t);
    if (created !== undefined && created > i) {
      violations.push(
        `${f} ALTERs "${t}", but it's only CREATEd later in ${files[created]}. ` +
          `Give the creating migration the lower number.`
      );
    }
  }
});

if (violations.length) {
  console.error("Migration ordering problems found:");
  for (const v of violations) console.error("  - " + v);
  process.exit(1);
}
console.log(`Migration order OK — ${files.length} migrations, ${createdAt.size} tables created across them.`);
