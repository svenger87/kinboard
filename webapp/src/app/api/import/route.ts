import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { SECRET_FIELDS, splitSecrets } from "@/lib/integration-secrets";
import { SETTINGS_KEYS } from "@/lib/settings-keys";

// POST /api/import — restore a family from a Kinboard backup file
// (Milestone D Task 3; inverts GET /api/export).
//
// No auth on this route — it mirrors family creation (useCreateFamily
// inserts a new `families` row directly, no auth check, because Kinboard's
// threat model is "trusted home network": anyone on the LAN can already
// create a brand-new family via /join). Accepting an import payload from
// the LAN doesn't grant any capability a visitor didn't already have.
//
// FK-respecting import order (mirrors + extends the comment atop
// src/app/api/export/route.ts — extended here with the concrete
// column-level dependencies that determine table insertion order):
//   families → people → calendars → events / todos
//   birthdays → birthday_gift_ideas
//   notes
//   recipes → recipe_ingredients / recipe_tags → recipe_tag_assignments
//   meal_plans → meal_plan_entries
//   item_catalog → shopping_items (also needs people + recipes first)
//   families → vehicles / tickers (standalone, family-scoped)
//   people → pocket_money_accounts → pocket_money_goals →
//     pocket_money_transactions / pocket_money_withdrawal_requests
//   settings (family_id only)
//
// NEVER imported (matches export's NEVER-exported list): families.join_code
// (a fresh one is generated), devices, push_subscriptions,
// notification_preferences, scheduled_notifications, notification_logs,
// oauth_credentials, integration_secrets, settings_pin.

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const CHUNK_SIZE = 500;
const JOIN_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const JOIN_CODE_MAX_ATTEMPTS = 10;

// Per-table remap spec. Every column NOT listed here is copied through
// unchanged from the exported row (forward-compatible with new non-FK
// columns added later).
interface TableSpec {
  table: string;
  hasOwnId: boolean; // false only for recipe_tag_assignments (composite PK)
  hasFamilyId: boolean;
  requiredFks: string[]; // row is skipped (and counted) if unresolved
  nullableFks: string[]; // set to NULL if unresolved
  forceNullColumns: string[]; // external references, always nulled
  arrayFks: string[]; // uuid[] columns, remapped element-wise, unmapped elements dropped
}

function spec(table: string, overrides: Partial<TableSpec> = {}): TableSpec {
  return {
    table,
    hasOwnId: true,
    hasFamilyId: true,
    requiredFks: [],
    nullableFks: [],
    forceNullColumns: [],
    arrayFks: [],
    ...overrides,
  };
}

// Insertion order — every table GET /api/export writes under `data` MUST
// appear here (self-review requirement, Task 3 Step 4). 24 tables, same
// count as the export payload's `data` keys.
const TABLE_SPECS: TableSpec[] = [
  spec("people"),
  spec("calendars", { nullableFks: ["person_id"] }),
  spec("events", {
    hasFamilyId: false, // scoped via calendar_id, no family_id column
    requiredFks: ["calendar_id"],
    nullableFks: ["person_id"],
    forceNullColumns: ["google_event_id"], // foreign account, never valid post-import
  }),
  spec("todos", {
    nullableFks: ["person_id"],
    forceNullColumns: ["source_device_id"], // devices are never exported
  }),
  spec("subjects"),
  spec("schedules", { requiredFks: ["person_id"] }),
  spec("birthdays", { nullableFks: ["person_id"] }),
  spec("birthday_gift_ideas", { requiredFks: ["birthday_id"] }),
  spec("notes", { nullableFks: ["person_id"] }),
  spec("recipes"),
  spec("recipe_ingredients", { hasFamilyId: false, requiredFks: ["recipe_id"] }),
  spec("recipe_tags"),
  spec("recipe_tag_assignments", {
    hasOwnId: false,
    hasFamilyId: false,
    requiredFks: ["recipe_id", "tag_id"],
  }),
  spec("meal_plans"),
  spec("meal_plan_entries", {
    hasFamilyId: false,
    requiredFks: ["meal_plan_id"],
    nullableFks: ["recipe_id"],
    arrayFks: ["attendees"],
  }),
  spec("item_catalog"),
  spec("shopping_items", {
    nullableFks: ["catalog_item_id", "recipe_id", "added_by"],
    forceNullColumns: ["source_device_id"], // devices are never exported
  }),
  spec("vehicles"),
  spec("tickers"),
  spec("pocket_money_accounts", { requiredFks: ["person_id"] }),
  spec("pocket_money_goals", { hasFamilyId: false, requiredFks: ["account_id"] }),
  spec("pocket_money_transactions", {
    hasFamilyId: false,
    requiredFks: ["account_id"],
    nullableFks: ["related_goal_id", "created_by_person_id"],
  }),
  spec("pocket_money_withdrawal_requests", {
    hasFamilyId: false,
    requiredFks: ["account_id"],
    nullableFks: ["parent_decided_by_person_id", "related_goal_id"],
  }),
  spec("settings"),
];

interface ExportPayload {
  format: string;
  version: number;
  family: { id: string; name: string };
  data: Record<string, unknown[]>;
}

function generateJoinCode(): string {
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += JOIN_CODE_CHARS.charAt(Math.floor(Math.random() * JOIN_CODE_CHARS.length));
  }
  return result;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Validates request shape. Returns either the parsed payload or an
// { error, status } describing why it was rejected (Step 1).
function validatePayload(body: unknown): { payload: ExportPayload } | { error: string; status: number } {
  if (!isRecord(body)) {
    return { error: "Invalid backup file", status: 400 };
  }
  if (body.format !== "kinboard-export" || body.version !== 1) {
    return {
      error: 'Not a Kinboard export (expected format="kinboard-export", version=1)',
      status: 400,
    };
  }
  const family = body.family;
  if (!isRecord(family) || typeof family.id !== "string" || typeof family.name !== "string") {
    return { error: "Backup file is missing family metadata", status: 400 };
  }
  const data = body.data;
  if (!isRecord(data)) {
    return { error: "Backup file is missing a data object", status: 400 };
  }
  // Structural check: any known table key present must be an array.
  // Unknown keys are ignored (forward compat with future export additions).
  for (const { table } of TABLE_SPECS) {
    const value = data[table];
    if (value !== undefined && !Array.isArray(value)) {
      return { error: `data.${table} must be an array`, status: 400 };
    }
  }
  return {
    payload: {
      format: body.format as string,
      version: body.version as number,
      family: { id: family.id, name: family.name },
      data: data as Record<string, unknown[]>,
    },
  };
}

export async function POST(request: NextRequest) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BYTES) {
    return NextResponse.json({ error: "Backup file exceeds 25 MB" }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BYTES) {
      return NextResponse.json({ error: "Backup file exceeds 25 MB" }, { status: 400 });
    }
    rawBody = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Backup file is not valid JSON" }, { status: 400 });
  }

  const validated = validatePayload(rawBody);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: validated.status });
  }
  const { payload } = validated;

  const supabase = createAdminClient();
  const db = supabase as any;

  // ---- Step 2: build the old-id → new-id map -----------------------
  const newFamilyId = crypto.randomUUID();
  const idMap = new Map<string, string>();
  idMap.set(payload.family.id, newFamilyId);

  for (const { table, hasOwnId } of TABLE_SPECS) {
    if (!hasOwnId) continue;
    const rows = payload.data[table];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (isRecord(row) && typeof row.id === "string") {
        idMap.set(row.id, crypto.randomUUID());
      }
    }
  }

  // Settings: settings_pin is a pure secret (no public part) and never
  // legitimately exported — dropped defensively. Every other SECRET_FIELDS
  // key re-runs splitSecrets to strip only the secret sub-path(s); the
  // surrounding public value (e.g. HA base_url + entity/dashboard
  // selections, Immich/Unsplash URLs, Google calendar selections, Bring
  // list selections) is legitimate user config that must survive a
  // restore. splitSecrets is also defense-in-depth here: it strips any raw
  // secret or sentinel a hand-edited backup file could carry, even though
  // export already scrubbed secrets at write time.
  const secretKeys = new Set(Object.keys(SECRET_FIELDS));
  let scrubbedSettingsCount = 0;
  const settingsRows: Record<string, unknown>[] = [];
  for (const row of payload.data.settings ?? []) {
    if (!isRecord(row) || typeof row.key !== "string") continue;
    if (row.key === SETTINGS_KEYS.settingsPin) continue;
    if (secretKeys.has(row.key)) {
      const { publicValue, secretValue } = splitSecrets(row.key, row.value);
      if (secretValue && Object.keys(secretValue).length > 0) {
        scrubbedSettingsCount++;
      }
      settingsRows.push({ ...row, value: publicValue });
      continue;
    }
    settingsRows.push(row);
  }
  const droppedSettingsCount = (payload.data.settings ?? []).length - settingsRows.length;
  payload.data.settings = settingsRows;

  // ---- Create the new family row FIRST — every child table's family_id
  // (or transitive parent) FK requires it to exist before any child insert.
  // Join code: same generation pattern as useCreateFamily/useRegenerateJoinCode
  // (src/hooks/use-supabase-queries.ts) — 6-char A-Z0-9 alphabet, retry on
  // Postgres unique-violation (23505).
  let joinCode = generateJoinCode();
  let attempts = 0;
  for (;;) {
    const { error } = await db.from("families").insert({
      id: newFamilyId,
      name: payload.family.name,
      join_code: joinCode,
    });
    if (!error) break;
    if (error.code === "23505" && attempts < JOIN_CODE_MAX_ATTEMPTS) {
      joinCode = generateJoinCode();
      attempts++;
      continue;
    }
    return NextResponse.json({ error: error.message, table: "families" }, { status: 500 });
  }

  // ---- Step 2 (cont'd) + Step 3: transform + insert per table -------
  const skipCounts = new Map<string, number>(); // "table:reason" -> count

  // idMap is built from EVERY row's id up front (pass 1), before we know
  // whether a given row will later be skipped for an unresolved required
  // FK. Without tracking that separately, a row referencing a skipped
  // row's id (e.g. a pocket_money_goal pointing at a pocket_money_account
  // that got skipped for an unresolved person_id) would "resolve" to a
  // UUID that was never actually inserted — a dangling FK that fails the
  // insert instead of cascading as a clean, counted skip. skippedOldIds
  // tracks old ids of rows we decided NOT to insert so resolve() can
  // treat references to them the same as references to ids that were
  // never in the export at all.
  const skippedOldIds = new Set<string>();

  function resolve(oldValue: unknown): string | undefined {
    if (typeof oldValue !== "string") return undefined;
    if (skippedOldIds.has(oldValue)) return undefined;
    return idMap.get(oldValue);
  }

  function transformRow(
    row: Record<string, unknown>,
    tableSpec: TableSpec
  ): Record<string, unknown> | null {
    const out: Record<string, unknown> = { ...row };
    const oldId = typeof row.id === "string" ? row.id : undefined;

    if (tableSpec.hasOwnId) {
      const newId = oldId ? idMap.get(oldId) : undefined;
      if (!newId) {
        if (oldId) skippedOldIds.add(oldId);
        return null; // every id was pre-registered above; defensive only
      }
      out.id = newId;
    }

    if (tableSpec.hasFamilyId) {
      out.family_id = newFamilyId;
    }

    for (const column of tableSpec.requiredFks) {
      const mapped = resolve(row[column]);
      if (!mapped) {
        const key = `${tableSpec.table}:${column}`;
        skipCounts.set(key, (skipCounts.get(key) ?? 0) + 1);
        if (oldId) skippedOldIds.add(oldId);
        return null;
      }
      out[column] = mapped;
    }

    for (const column of tableSpec.nullableFks) {
      out[column] = resolve(row[column]) ?? null;
    }

    for (const column of tableSpec.forceNullColumns) {
      out[column] = null;
    }

    for (const column of tableSpec.arrayFks) {
      const oldValue = row[column];
      out[column] = Array.isArray(oldValue)
        ? oldValue
            .filter((v): v is string => typeof v === "string")
            .map((v) => resolve(v))
            .filter((v): v is string => v !== undefined)
        : null;
    }

    return out;
  }

  async function rollback(): Promise<void> {
    // Every imported table cascades (directly or transitively) from
    // `families.id ON DELETE CASCADE` — verified against init.sql +
    // migration_vehicles.sql / migration_tickers.sql / migration_pocket_money.sql.
    // Deleting the new family row is therefore sufficient to wipe
    // everything inserted so far; no child table needs an explicit delete.
    await db.from("families").delete().eq("id", newFamilyId);
  }

  for (const tableSpec of TABLE_SPECS) {
    const sourceRows = payload.data[tableSpec.table];
    if (!Array.isArray(sourceRows) || sourceRows.length === 0) continue;

    const rowsToInsert: Record<string, unknown>[] = [];
    for (const row of sourceRows) {
      if (!isRecord(row)) continue;
      const transformed = transformRow(row, tableSpec);
      if (transformed) rowsToInsert.push(transformed);
    }
    if (rowsToInsert.length === 0) continue;

    for (let i = 0; i < rowsToInsert.length; i += CHUNK_SIZE) {
      const chunk = rowsToInsert.slice(i, i + CHUNK_SIZE);
      const { error } = await db.from(tableSpec.table).insert(chunk);
      if (error) {
        await rollback();
        return NextResponse.json(
          { error: error.message, table: tableSpec.table },
          { status: 500 }
        );
      }
    }
  }

  const warnings: string[] = [];
  for (const [key, count] of skipCounts) {
    const [table, column] = key.split(":");
    warnings.push(`${table}: skipped ${count} row(s) — unresolved ${column}`);
  }
  if (droppedSettingsCount > 0) {
    warnings.push(
      `settings: dropped ${droppedSettingsCount} row(s) with no public value to restore (PIN) — reconnect after import`
    );
  }
  if (scrubbedSettingsCount > 0) {
    warnings.push(
      `settings: stripped secret fields from ${scrubbedSettingsCount} row(s) — reconnect those integrations after import`
    );
  }

  return NextResponse.json({
    family_id: newFamilyId,
    join_code: joinCode,
    name: payload.family.name,
    warnings,
  });
}
