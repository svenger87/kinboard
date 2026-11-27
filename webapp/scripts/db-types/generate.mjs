#!/usr/bin/env node
// `npm run db:generate`: the database types, generated from the schema
// (RFC-024 §4.6 step 4).
//
//   node scripts/db-types/generate.mjs              write src/types/database.generated.ts
//   node scripts/db-types/generate.mjs --check      exit 1, with a diff, if it is stale
//   node scripts/db-types/generate.mjs --db-url URL read an already-migrated database instead
//
// Without --db-url it starts a throwaway PostgreSQL in Docker, applies the
// role bootstrap, init.sql and every migration exactly as a new install does
// (database.mjs), reads pg_catalog (introspect.mjs), writes the file
// (render.mjs) and removes the container. Docker and the pinned postgres
// image are all it needs: no CLI download, no registry beyond that image, no
// network once it is pulled. CI runs --check on every pull request.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { withMigratedDatabase } from "./database.mjs";
import { introspect } from "./introspect.mjs";
import { render } from "./render.mjs";

const webapp = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const target = join(webapp, "src", "types", "database.generated.ts");
const args = process.argv.slice(2);
const check = args.includes("--check");
const urlAt = args.indexOf("--db-url");
const dbUrl = urlAt >= 0 ? args[urlAt + 1] : undefined;
const log = (m) => console.error(`[db:generate] ${m}`);

async function generate(url) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return render(await introspect(sql));
  } finally {
    await sql.end();
  }
}

const text = dbUrl
  ? await generate(dbUrl)
  : await withMigratedDatabase(join(webapp, "docker"), generate, { log });

const tables = (text.match(/^ {6}\w+: \{\n {8}Row:/gm) ?? []).length;
if (check) {
  let current = "";
  try { current = readFileSync(target, "utf8"); } catch { /* missing counts as stale */ }
  if (current === text) {
    log(`src/types/database.generated.ts is up to date (${tables} tables)`);
  } else {
    const dir = mkdtempSync(join(tmpdir(), "db-types-"));
    const fresh = join(dir, "database.generated.ts");
    writeFileSync(fresh, text);
    spawnSync("diff", ["-u", "--label", "committed", "--label", "generated", target, fresh], { stdio: "inherit" });
    rmSync(dir, { recursive: true, force: true });
    log("src/types/database.generated.ts does not match the schema the migrations build.");
    log("Run `npm run db:generate` in webapp/ and commit the result; never edit the file by hand.");
    process.exit(1);
  }
} else {
  writeFileSync(target, text);
  log(`wrote src/types/database.generated.ts (${tables} tables)`);
}
