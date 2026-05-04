#!/usr/bin/env node
// 4b-seed-extras.mjs — add synthetic notes + todos to the demo DB.
//
// Prod has zero rows in public.notes and public.todos, but the wiki
// pages for those features need content. This script adds a small,
// believable dataset.
//
// Idempotent: clears existing notes/todos before inserting.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const envPath = resolve(ROOT, "demo.env");
if (!existsSync(envPath)) {
  console.error("error: demo.env missing — run scripts/2-bringup.sh first.");
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envPath, "utf8").split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const PROJECT_NAME = env.PROJECT_NAME || "familyboard-demo";
const DB_CONTAINER = `${PROJECT_NAME}-db`;

function pgQuery(sql) {
  const r = spawnSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr}`);
  return r.stdout.trim();
}
function pgExec(batch) {
  const r = spawnSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: batch, encoding: "utf8" });
  if (r.status !== 0) { console.error("psql:", r.stderr); throw new Error("psql exec failed"); }
}
const q = (s) => s === null ? "NULL" : "'" + String(s).replace(/'/g, "''") + "'";

// -----------------------------------------------------------------------
// Read family + people IDs from anonymized DB
// -----------------------------------------------------------------------
const familyId = pgQuery("SELECT id FROM public.families LIMIT 1");
if (!familyId) {
  console.error("error: no families in demo DB. Did you run restore + anonymize?");
  process.exit(1);
}

const people = pgQuery("SELECT id, name FROM public.people").split("\n").filter(Boolean)
  .map((r) => { const [id, name] = r.split("|"); return { id, name }; });
if (people.length === 0) {
  console.error("error: no people. Did anonymize succeed?");
  process.exit(1);
}

// -----------------------------------------------------------------------
// Seed notes — table is (content TEXT, pinned BOOLEAN). Content is free-form
// markdown; for screenshots we put a heading on line 1 so it reads like a
// titled note.
// -----------------------------------------------------------------------
const notes = [
  { content: "**Wifi-Gast**\n\nSSID: GuestHouse\nPasswort: kitchen-2026", pinned: true },
  { content: "**Paket Dienstag**\n\nAmazon-Paket kommt Dienstag zwischen 10-12 Uhr. Bitte beim Nachbarn abgeben falls niemand zu Hause.", pinned: false },
  { content: "**Schlüssel beim Nachbarn**\n\nReserveschlüssel ist bei den Müllers (Hausnummer 47).", pinned: false },
  { content: "**Pflanzen gießen**\n\nDie Monstera braucht *jeden Mittwoch* Wasser. Nicht zu viel — Erde nur leicht feucht halten.", pinned: false },
];

// -----------------------------------------------------------------------
// Seed todos — mix of states/priorities/people
// (schema: completed BOOLEAN, recurrence TEXT, source_device_id UUID)
// -----------------------------------------------------------------------
const todos = [
  // Overdue
  { title: "Zahnarzttermin verschieben", priority: "high", days_offset: -3, person_idx: 0, completed: false },
  // Today
  { title: "Müll rausbringen", priority: "normal", days_offset: 0, person_idx: 1, completed: false },
  { title: "Spülmaschine ausräumen", priority: "low", days_offset: 0, person_idx: null, completed: false },
  // This week
  { title: "Geschenk für Oma kaufen", priority: "high", days_offset: 4, person_idx: 0, completed: false },
  { title: "Auto zum TÜV", priority: "urgent", days_offset: 5, person_idx: 0, completed: false },
  { title: "Steuererklärung anfangen", priority: "normal", days_offset: 6, person_idx: 0, completed: false },
  { title: "Druckerpapier nachkaufen", priority: "low", days_offset: 2, person_idx: null, completed: false },
  // Later
  { title: "Garten mähen", priority: "normal", days_offset: 12, person_idx: 1, completed: false },
  { title: "Familienurlaub buchen", priority: "high", days_offset: 21, person_idx: 0, completed: false },
  // No date
  { title: "Buch zurück in Bibliothek bringen", priority: "low", days_offset: null, person_idx: 2, completed: false },
  // Completed (recent)
  { title: "Geburtstagskarte schreiben", priority: "normal", days_offset: -1, person_idx: 0, completed: true },
  { title: "Teppich saugen", priority: "low", days_offset: -2, person_idx: 1, completed: true },
];

// -----------------------------------------------------------------------
// Build SQL
// -----------------------------------------------------------------------
const sql = ["BEGIN;", "TRUNCATE public.notes, public.todos CASCADE;"];

// Helper to detect schema columns at insert time
const noteCols = pgQuery("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='notes'").split("\n").filter(Boolean);
const todoCols = pgQuery("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='todos'").split("\n").filter(Boolean);

if (noteCols.length === 0) {
  console.warn("warning: public.notes table missing — skipping notes seed.");
} else {
  console.log("Seeding notes…");
  for (const n of notes) {
    const colList = ["family_id", "content"];
    const valList = [q(familyId), q(n.content)];
    if (noteCols.includes("pinned")) { colList.push("pinned"); valList.push(n.pinned ? "true" : "false"); }
    sql.push(`INSERT INTO public.notes (${colList.join(", ")}) VALUES (${valList.join(", ")});`);
  }
}

if (todoCols.length === 0) {
  console.warn("warning: public.todos table missing — skipping todos seed.");
} else {
  console.log("Seeding todos…");
  for (const t of todos) {
    const dueExpr = t.days_offset === null ? "NULL" : `(CURRENT_DATE + INTERVAL '${t.days_offset} days')`;
    const personId = t.person_idx === null ? "NULL" : q(people[t.person_idx % people.length].id);
    const lastCompleted = t.completed ? "(NOW() - INTERVAL '1 day')" : "NULL";

    const colList = ["family_id", "title", "priority"];
    const valList = [q(familyId), q(t.title), q(t.priority)];

    if (todoCols.includes("due_date")) { colList.push("due_date"); valList.push(dueExpr); }
    if (todoCols.includes("person_id")) { colList.push("person_id"); valList.push(personId); }
    if (todoCols.includes("completed")) { colList.push("completed"); valList.push(t.completed ? "true" : "false"); }
    if (todoCols.includes("last_completed")) { colList.push("last_completed"); valList.push(lastCompleted); }

    sql.push(`INSERT INTO public.todos (${colList.join(", ")}) VALUES (${valList.join(", ")});`);
  }
}

sql.push("COMMIT;");
pgExec(sql.join("\n"));

const noteCount = noteCols.length ? pgQuery("SELECT count(*) FROM public.notes") : "0";
const todoCount = todoCols.length ? pgQuery("SELECT count(*) FROM public.todos") : "0";
console.log(`\nSeeded. notes=${noteCount}, todos=${todoCount}.`);
