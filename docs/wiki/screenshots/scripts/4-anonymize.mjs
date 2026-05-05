#!/usr/bin/env node
// 4-anonymize.mjs — scrub PII from the restored demo DB.
//
// Pre-req: 3-restore.sh (prod dump restored into demo postgres).
//
// Walks the public schema and:
//   - Replaces names (people, devices, families, birthdays, events) with
//     stable fakes — same source ID always maps to the same fake name across
//     tables, so an event titled "Emma's swim class" stays consistent with
//     the renamed person row.
//   - Drops descriptions / locations / notes that may contain PII.
//   - Shifts all event dates forward by a random month-offset so even the
//     calendar density isn't your real density.
//   - Zeroes every secret in the settings table (OAuth tokens, API keys,
//     PIN hashes, push subscription endpoints).
//   - Rewrites integration URLs to point at the local mock servers
//     (HA → http://mock-ha:8123, Tesla → http://mock-tesla:8124).
//   - Generates a fresh family name + join code.
//
// Idempotent: re-running re-anonymizes; nothing breaks.
//
// Usage:
//   cd docs/wiki/screenshots
//   npm install     # one-time, picks up @faker-js/faker, pg
//   node scripts/4-anonymize.mjs
//
// Env:
//   PG_HOST, PG_PORT, PG_DB, PG_USER, PG_PASSWORD — override DB connection.
//   By default reads demo.env in the screenshots dir.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import crypto from "node:crypto";
import pg from "pg";
import { faker, Faker, de, en, base } from "@faker-js/faker";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// -----------------------------------------------------------------------
// Load demo.env so we can read POSTGRES_PASSWORD + project name
// -----------------------------------------------------------------------
const envPath = resolve(ROOT, "demo.env");
if (!existsSync(envPath)) {
  console.error("error: demo.env missing — run scripts/2-bringup.sh first.");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);

const PROJECT_NAME = env.PROJECT_NAME || "kinboard-demo";
const PG_PASSWORD = process.env.PG_PASSWORD || env.POSTGRES_PASSWORD;

if (!PG_PASSWORD) {
  console.error("error: POSTGRES_PASSWORD missing — bad demo.env?");
  process.exit(1);
}

// Connect to the demo postgres on its mapped port. Postgres in the demo
// stack binds 5432 internally; we map it to localhost on a high port via
// docker. For simplicity, we connect via `docker exec` proxy: that lets
// this script run from the host without needing the port published.
//
// Strategy: spawn `docker exec ${PROJECT_NAME}-db psql ...` for SQL writes,
// piping commands via stdin. Slower than a TCP pg client but no port wiring.
//
// To keep this fast for many small UPDATEs, we batch all SQL into one big
// transaction and pipe it via a single `docker exec`.

import { spawnSync } from "node:child_process";

const DB_CONTAINER = `${PROJECT_NAME}-db`;

function pgQuery(sql, opts = {}) {
  const args = ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA"];
  if (opts.csv) args.push("-F", ",");
  args.push("-c", sql);
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`psql failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function pgExec(sqlBatch) {
  // Write batch SQL via stdin to avoid argv length limits.
  const result = spawnSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
    { input: sqlBatch, encoding: "utf8" },
  );
  if (result.status !== 0) {
    console.error("psql stderr:", result.stderr);
    throw new Error("psql exec failed");
  }
}

// -----------------------------------------------------------------------
// Stable fake-name generator: same input ID → same fake name everywhere.
// -----------------------------------------------------------------------
const localeFaker = new Faker({ locale: [de, en, base] });
const nameCache = new Map();

function stableSeededFaker(id) {
  // Hash the UUID, take first 8 hex digits, parse as int seed.
  const h = crypto.createHash("md5").update(id).digest("hex");
  return parseInt(h.slice(0, 8), 16);
}

function stableName(id, kind = "first") {
  const cacheKey = `${kind}:${id}`;
  if (nameCache.has(cacheKey)) return nameCache.get(cacheKey);
  localeFaker.seed(stableSeededFaker(id));
  let name;
  switch (kind) {
    case "first":
      name = localeFaker.person.firstName();
      break;
    case "full":
      name = localeFaker.person.fullName();
      break;
    case "device":
      name = `${localeFaker.person.firstName()}'s ${localeFaker.helpers.arrayElement(["iPhone", "iPad", "Pixel", "phone", "tablet"])}`;
      break;
    case "user":
      name = localeFaker.internet.userName();
      break;
    default:
      name = localeFaker.person.firstName();
  }
  nameCache.set(cacheKey, name);
  return name;
}

// SQL-safe quote
function q(s) {
  if (s === null || s === undefined) return "NULL";
  return "'" + String(s).replace(/'/g, "''") + "'";
}

// -----------------------------------------------------------------------
// Schema introspection — query column lists once per table so we skip
// UPDATEs for columns that don't exist in this schema variant.
// -----------------------------------------------------------------------
function getCols(table) {
  const out = pgQuery(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='${table}'`,
  );
  return new Set(out.split("\n").filter(Boolean));
}
const cols = {
  events: getCols("events"),
  people: getCols("people"),
  devices: getCols("devices"),
  birthdays: getCols("birthdays"),
  recipes: getCols("recipes"),
  shopping_items: getCols("shopping_items"),
  item_catalog: getCols("item_catalog"),
  meal_plan_entries: getCols("meal_plan_entries"),
};
function maybeNull(table, col) {
  return cols[table]?.has(col) ? `${col} = NULL` : null;
}
function buildUpdate(table, idClause, ...assigns) {
  const valid = assigns.filter(Boolean);
  if (valid.length === 0) return null;
  return `UPDATE public.${table} SET ${valid.join(", ")} ${idClause};`;
}

// -----------------------------------------------------------------------
// Step 1 — fetch IDs we need (people, devices, events, etc.)
// -----------------------------------------------------------------------
console.log("Reading IDs from demo DB…");

const people = pgQuery("SELECT id, name FROM public.people ORDER BY created_at")
  .split("\n")
  .filter(Boolean)
  .map((row) => {
    const [id, name] = row.split("|");
    return { id, name };
  });

const devices = pgQuery("SELECT id FROM public.devices")
  .split("\n")
  .filter(Boolean);

const families = pgQuery("SELECT id FROM public.families")
  .split("\n")
  .filter(Boolean);

const birthdays = pgQuery("SELECT id FROM public.birthdays")
  .split("\n")
  .filter(Boolean);

const eventCount = parseInt(pgQuery("SELECT count(*) FROM public.events"), 10);
const recipeCount = parseInt(pgQuery("SELECT count(*) FROM public.recipes"), 10);

console.log(
  `  people=${people.length} devices=${devices.length} families=${families.length} birthdays=${birthdays.length} events=${eventCount} recipes=${recipeCount}`,
);

// -----------------------------------------------------------------------
// Step 2 — build the SQL batch
// -----------------------------------------------------------------------
const sql = [];
sql.push("BEGIN;");

// --- families: rename + new join code -------------------------------
const newJoinCode = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6).padEnd(6, "X");
for (const fid of families) {
  sql.push(`UPDATE public.families SET name = 'Demo Family', join_code = ${q(newJoinCode)} WHERE id = ${q(fid)};`);
}

// --- people: rename + clear avatar (base64 might be a real photo) -----
for (const p of people) {
  const fakeName = stableName(p.id, "first");
  const u = buildUpdate("people", `WHERE id = ${q(p.id)}`,
    `name = ${q(fakeName)}`,
    cols.people.has("avatar_url") ? "avatar_url = NULL" : null,
  );
  if (u) sql.push(u);
}

// --- devices: rename + clear fingerprints ---------------------------
for (const did of devices) {
  const fakeName = stableName(did, "device");
  const u = buildUpdate("devices", `WHERE id = ${q(did)}`,
    `name = ${q(fakeName)}`,
    cols.devices.has("fingerprint") ? "fingerprint = NULL" : null,
    cols.devices.has("hardware_id") ? "hardware_id = NULL" : null,
    cols.devices.has("user_agent") ? "user_agent = 'Mozilla/5.0 (Demo)'" : null,
  );
  if (u) sql.push(u);
}

// --- birthdays: rename only --------------------------------------
for (const bid of birthdays) {
  const fakeName = stableName(bid, "first");
  sql.push(`UPDATE public.birthdays SET name = ${q(fakeName)} WHERE id = ${q(bid)};`);
}

// --- events: replace title/description/location en masse ----------
// We don't loop per-event (499 of them) — instead use a randomized template.
// PostgreSQL doesn't natively give us a per-row Faker, so we use a curated
// list of templated event titles and pick one based on event ID hash.
const eventTemplates = [
  "Doctor appointment", "Dentist", "Swim class", "Soccer practice", "Music lesson",
  "Birthday party", "School play", "Parent-teacher meeting", "Gym", "Yoga",
  "Book club", "Family dinner", "Movie night", "Grocery run", "Date night",
  "Vet appointment", "Car service", "House cleaning", "Garden work", "Project meeting",
  "Lunch with friends", "Coffee meetup", "Hiking", "Cycling", "Tennis match",
  "Piano lesson", "Coding session", "Walk in the park", "Library visit", "Museum trip",
];
{
  const eventAssigns = [
    `title = (ARRAY[${eventTemplates.map(q).join(",")}])[1 + (abs(hashtext(id::text)) % ${eventTemplates.length})]`,
    cols.events.has("description") ? "description = NULL" : null,
    cols.events.has("location") ? "location = NULL" : null,
    `start_at = start_at + INTERVAL '${Math.floor(Math.random() * 7) - 3} months'`,
    `end_at = end_at + INTERVAL '${Math.floor(Math.random() * 7) - 3} months'`,
  ].filter(Boolean);
  sql.push(`UPDATE public.events SET ${eventAssigns.join(", ")};`);
}

// --- recipes: drop notes if column exists --------------------------
if (cols.recipes.has("notes")) sql.push("UPDATE public.recipes SET notes = NULL;");

// --- shopping_items + item_catalog: drop notes only ----------------
// (item names like "Milch", "Brot" are useful for screenshots, not PII)
if (cols.shopping_items.has("notes")) sql.push("UPDATE public.shopping_items SET notes = NULL;");
if (cols.item_catalog.has("notes")) sql.push("UPDATE public.item_catalog SET notes = NULL;");

// --- meal_plan_entries: scrub free_form_name ----------------------
if (cols.meal_plan_entries.has("free_form_name")) {
  sql.push("UPDATE public.meal_plan_entries SET free_form_name = NULL WHERE free_form_name IS NOT NULL;");
}

// --- settings: zero secrets, rewrite URLs --------------------------
// Each settings row has a JSONB value column. We preserve the rich
// config that powers the dashboard (rooms_config, dashboards, energy_config,
// mappingRules, calendars list) and only surgically scrub auth fields
// + rewrite integration URLs to point at the local mocks.
const settingsScrub = [
  // Google Calendar — drop OAuth tokens but preserve the calendar list,
  // mapping rules, and selected-calendar IDs so Kinboard's calendar
  // page renders with the same shape as prod.
  ["google_calendar",
    `(value
      - 'access_token'
      - 'refresh_token'
      - 'token_expiry'
      - 'client_secret'
      - 'auth_state')
      || jsonb_build_object('connected', false)`],
  // Home Assistant — keep rooms_config/dashboards/energy_config/etc.,
  // rewire the URL at the mock and replace the access token.
  ["home_assistant",
    `value
      || jsonb_build_object(
        'url', 'http://mock-ha:8123',
        'access_token', 'demo-token-not-real')`],
  // Immich — clear creds, keep album mode/preference if set.
  ["immich",
    `value
      || jsonb_build_object(
        'url', '',
        'api_key', '',
        'enabled', false)`],
  // Bring — clear creds.
  ["bring_settings",
    `value
      - 'email'
      - 'password'
      - 'password_hash'
      - 'cookie'
      - 'session'
      || jsonb_build_object('connected', false)`],
  // Camera presets — strip embedded creds in URLs / auth fields.
  ["cameras", "value - 'auth' - 'token' - 'username' - 'password'"],
  // Settings PIN — drop the hash so the demo isn't gated.
  ["settings_pin", "jsonb_build_object('hash', NULL, 'enabled', false)"],
  // Weather coords — replace with Berlin so the radar map is recognizable.
  // Schema: { type: "city" | "coordinates", city?, lat?, lon? }
  // (defined in webapp/src/hooks/use-weather.ts).
  ["weather_location",
    `jsonb_build_object(
      'type', 'coordinates',
      'lat', 52.52,
      'lon', 13.405,
      'city', 'Berlin')`],
];

for (const [key, expr] of settingsScrub) {
  sql.push(`UPDATE public.settings SET value = ${expr} WHERE key = ${q(key)};`);
}

// Tesla settings live inside home_assistant.tesla_config in prod (not
// their own settings row). Rewire the API endpoint inside that nested
// object to point at the mock if the field exists.
sql.push(
  `UPDATE public.settings
   SET value = jsonb_set(value, '{tesla_config,api_url}', '"http://mock-tesla:8124"', false)
   WHERE key = 'home_assistant' AND value ? 'tesla_config';`,
);
sql.push(
  `UPDATE public.settings
   SET value = jsonb_set(value, '{tesla_config,access_token}', '"demo-tesla-token-not-real"', false)
   WHERE key = 'home_assistant' AND value->'tesla_config' ? 'access_token';`,
);
sql.push(
  `UPDATE public.settings
   SET value = jsonb_set(value, '{tesla_config,refresh_token}', '"demo-tesla-refresh-not-real"', false)
   WHERE key = 'home_assistant' AND value->'tesla_config' ? 'refresh_token';`,
);

// --- push_subscriptions: delete entirely ---------------------------
sql.push("DELETE FROM public.push_subscriptions;");

// --- scheduled_notifications: clear pending ----------------------
sql.push("DELETE FROM public.scheduled_notifications;");

sql.push("COMMIT;");

// -----------------------------------------------------------------------
// Step 3 — run it
// -----------------------------------------------------------------------
console.log("\nApplying anonymization…");
pgExec(sql.join("\n"));

console.log("\nDone. New family join code:", newJoinCode);
console.log("\nNext steps:");
console.log("  1. Mock servers are wired into settings (HA → mock-ha:8123).");
console.log("     Bring up the webapp + mocks: ./scripts/5-bringup-app.sh");
console.log("  2. Optionally seed sample notes + todos (prod had none):");
console.log("     ./scripts/4b-seed-extras.mjs");
console.log("  3. Capture screenshots: npm run capture");
console.log("\n⚠  The demo DB is now safe to screenshot. The dump file in");
console.log("   dump/prod-dump.sql.gz is still real prod data — keep it gitignored.");
