#!/usr/bin/env node
// Writes src/lib/schema-expectations.json: every table and column this build's
// database types declare (the `Row` of each table in
// src/types/database.generated.ts, which `npm run db:generate` writes from the
// migrated schema, RFC-024 §4.6), for the
// deep health check (`/api/health?deep=1`, lib/deep-health.ts) that the
// self-update runs after it recreates the webapp (RFC-023 §4.11.4).
//
//   node scripts/generate-schema-expectations.mjs           write it
//   node scripts/generate-schema-expectations.mjs --check   exit 1 if it is stale
//
// e2e/update-status.spec.ts fails when the JSON and the types disagree.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function parseTables(source) {
  // Tables only: views and functions follow, at the same indentation.
  const end = source.search(/^ {4}Views: /m);
  if (end >= 0) source = source.slice(0, end);
  const tables = {};
  let table = null;
  let inRow = false;
  for (const line of source.split("\n")) {
    const t = /^ {6}(\w+): \{$/.exec(line);
    if (t) { table = t[1]; inRow = false; continue; }
    if (/^ {8}Row: \{/.test(line)) { inRow = true; tables[table] = []; continue; }
    if (inRow && /^ {8}\};?$/.test(line)) { inRow = false; continue; }
    const c = inRow && /^ {10}(\w+)\??:/.exec(line);
    if (c) tables[table].push(c[1]);
  }
  return Object.fromEntries(Object.entries(tables).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [...v].sort()]));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tables = parseTables(readFileSync(join(root, "src/types/database.generated.ts"), "utf8"));
  const out = join(root, "src/lib/schema-expectations.json");
  const text = JSON.stringify(tables, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if (readFileSync(out, "utf8") !== text) {
      console.error("src/lib/schema-expectations.json is stale: run node scripts/generate-schema-expectations.mjs");
      process.exit(1);
    }
  } else {
    writeFileSync(out, text);
  }
  console.log(`${Object.keys(tables).length} tables, ${Object.values(tables).flat().length} columns`);
}
