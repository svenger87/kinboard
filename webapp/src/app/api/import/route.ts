import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { SECRET_FIELDS, splitSecrets } from "@/lib/integration-secrets";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { restoredSyncSetting } from "@/lib/school-sync/reconcile";
import { withHolidayRegion } from "@/lib/holidays/region";
import { clientIp, hitLimit } from "@/lib/rate-limit";
import { restorableAvatarStyle } from "@/lib/pocket-money/creatures/styles";
import { restorableLook } from "@/lib/pocket-money/creatures/look";
import { backupHasCreatures, personForOldRedemptions } from "@/lib/creatures/backup";

// POST /api/import — restore a family from a Kinboard backup file
// (Milestone D Task 3; inverts GET /api/export).
//
// Deliberately reachable without a session, and the one route in the
// family-data set that is. Restoring a backup is the first thing a fresh
// install does: /join uploads the file, this route creates the new family,
// and only then can the browser join it and be issued a session. Requiring a
// session here would mean you can only restore a backup onto an install that
// already has a family — i.e. never, on the machine that actually needs it.
//
// What that grants a stranger is bounded, and it is the same thing
// /api/session/create already grants: make a *new* family from data they
// supplied themselves. It reads nothing, and it cannot touch a family that
// already exists — every row is rewritten to a freshly generated id, and the
// join code for the result is returned only to the caller who uploaded the
// file. The exposure is disk, so that is what the rate limit below bounds.
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
//   point_rewards; people → point_redemptions (pocket_money_accounts too,
//     optionally: account_id is nullable since RFC-017)
//   people → creatures (RFC-017; a backup from before it has none, and gets
//     them derived from its accounts by the migration's own rule)
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
  /**
   * Settings keys whose *value* is a row id from another table.
   *
   * The remap works on columns, and `settings` has none that hold ids — the
   * id sits inside the JSON value. So `default_calendar_id` came through a
   * restore still naming a calendar from the source install, and the calendar
   * page's "default calendar" pointed at something that no longer existed.
   *
   * Only ids that reference another Kinboard row belong here. Real settings
   * carry plenty of other UUIDs — a camera's own id, a Home Assistant
   * dashboard's id — that are internal to the setting's own blob and must be
   * left alone.
   */
  settingValueFks: string[];
  /**
   * Fixes up a column the database would refuse, where refusing it would be
   * out of all proportion: one bad cosmetic value must not fail and roll back
   * an entire restore. Runs on the copied row, after the id remapping.
   */
  normalize?: (row: Record<string, unknown>) => void;
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
    settingValueFks: [],
    ...overrides,
  };
}

// Insertion order — every table GET /api/export writes under `data` MUST
// appear here (self-review requirement, Task 3 Step 4). 27 tables, same
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
  spec("todo_point_awards", {
    requiredFks: ["person_id"],
    nullableFks: ["todo_id"],
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
  spec("pocket_money_accounts", {
    requiredFks: ["person_id"],
    // A look this release does not know -- a backup from a newer one, or a
    // hand-edited file -- restores as classic instead of tripping the CHECK.
    // A backup from before the column existed has none, and gets the default.
    // The same for a child's own look: anything the editor would refuse --
    // an unknown key, a colour outside the sets -- restores as {}, the
    // creature's own look, so a cosmetic field never fails a restore.
    normalize: (row) => {
      if ("avatar_style" in row) row.avatar_style = restorableAvatarStyle(row.avatar_style);
      if ("avatar_look" in row) row.avatar_look = restorableLook(row.avatar_look);
    },
  }),
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
  spec("point_rewards"),
  // Devices are never carried over, so who asked and who decided is lost;
  // the request, its cost and its status are what the balance needs.
  spec("point_redemptions", {
    // Per child since RFC-017. A backup from before has only account_id; the
    // person is filled in from the backup's own accounts before this runs
    // (personForOldRedemptions).
    requiredFks: ["person_id"],
    nullableFks: ["account_id", "reward_id"],
    forceNullColumns: ["requested_by_device_id", "decided_by_device_id"],
  }),
  // Keyed by the child: no id of its own, so person_id is remapped as an FK.
  spec("creatures", {
    hasOwnId: false,
    requiredFks: ["person_id"],
    // As on the account: a style or a look this release would refuse
    // restores as classic or {}, never failing the restore.
    normalize: (row) => {
      row.style = restorableAvatarStyle(row.style);
      row.look = restorableLook(row.look);
    },
  }),
  spec("settings", { settingValueFks: [SETTINGS_KEYS.defaultCalendarId] }),
];

interface ExportPayload {
  format: string;
  version: number;
  family: { id: string; name: string };
  data: Record<string, unknown[]>;
  /**
   * Added in export version 2. Absent from version 1 backups, which is
   * why every read of it is guarded rather than assumed.
   */
  storage?: {
    included: boolean;
    object_count: number;
    objects: Array<{ table: string; row_id: string; bucket: string; path: string }>;
    note: string;
  };
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
  // Version 2 only adds the `storage` block; the data section is identical,
  // so both restore the same way. Accepting a range rather than one number
  // also means a future additive bump doesn't lock users out of their own
  // backups until they upgrade.
  const SUPPORTED_VERSIONS = [1, 2];
  if (
    body.format !== "kinboard-export" ||
    typeof body.version !== "number" ||
    !SUPPORTED_VERSIONS.includes(body.version)
  ) {
    return {
      error: `Not a Kinboard export (expected format="kinboard-export", version ${SUPPORTED_VERSIONS.join(" or ")})`,
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
      // Trim: backups from families created before name-trimming shipped can
      // carry trailing whitespace, which would re-arm the delete-confirmation
      // trap the trim fix closed.
      family: { id: family.id, name: family.name.trim() },
      data: data as Record<string, unknown[]>,
    },
  };
}

export async function POST(request: NextRequest) {
  // A 25 MB write that anyone can issue, so meter it the way
  // /api/session/create meters family creation. Restoring a backup is
  // something a person does once, twice if the first attempt failed — nobody
  // legitimately does it in a loop.
  const ip = clientIp(request);
  const limit = hitLimit(`import:ip:${ip}`, 3, 60_000);
  if (limit.limited) {
    return NextResponse.json(
      { error: "too many attempts, slow down" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

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
  // RFC-014 §4.2: a backup from before holiday_region existed carries only
  // holiday_country (or nothing, meaning Germany). Give the restored family
  // the region it effectively had, as the migration does for live ones.
  // Added before the id map below, so the row is remapped like any other.
  payload.data.settings = withHolidayRegion(payload.data.settings ?? [], () => crypto.randomUUID());
  personForOldRedemptions(payload.data);

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
    // RFC-014 §5: the family's sync choice comes back, its status does not --
    // the restored family has none of the backup's synced rows' history and
    // is due at once. A value that is not a sync setting is dropped.
    if (row.key === SETTINGS_KEYS.schoolHolidaySync) {
      const restored = restoredSyncSetting(row.value);
      if (restored) settingsRows.push({ ...row, value: restored });
      continue;
    }
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
  // Join code: same generation pattern as /api/session/create and
  // useRegenerateJoinCode (src/hooks/use-supabase-queries.ts) — 6-char
  // A-Z0-9 alphabet, retry on Postgres unique-violation (23505).
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

    if (tableSpec.settingValueFks.length > 0 && typeof row.key === "string") {
      if (tableSpec.settingValueFks.includes(row.key)) {
        const mapped = resolve(row.value);
        if (!mapped) {
          // The calendar it named didn't come across. Dropping the setting
          // leaves the app to fall back to its own default, which is a good
          // deal better than a pointer to a row in someone else's install.
          const key = `${tableSpec.table}:${row.key}`;
          skipCounts.set(key, (skipCounts.get(key) ?? 0) + 1);
          return null;
        }
        out.value = mapped;
      }
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

    tableSpec.normalize?.(out);
    return out;
  }

  async function rollback(): Promise<void> {
    // Every imported table cascades (directly or transitively) from
    // `families.id ON DELETE CASCADE` — verified against init.sql +
    // migration_vehicles.sql / migration_tickers.sql / migration_pocket_money.sql.
    // Deleting the new family row is therefore sufficient to wipe
    // everything inserted so far; no child table needs an explicit delete.
    // It goes through delete_family, which sets kinboard.hard_delete: a plain
    // delete has the recycle bin's triggers bin the cascaded rows instead of
    // deleting them, leaving them behind with no family (#344).
    await db.rpc("delete_family", { p_family_id: newFamilyId });
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

  // A backup from before RFC-017 has no creatures: derive them from its
  // accounts by the migration's own rule (creatures_from_accounts in
  // migration_zzzzzzzz_pocket_money_creatures_out.sql), so a restored child
  // has the creature they had. A backup that carries the key -- even empty,
  // a family with none switched on -- is taken as it is.
  if (!backupHasCreatures(payload.data)) {
    const { error } = await db.rpc("creatures_from_accounts", { p_family_id: newFamilyId });
    if (error) {
      await rollback();
      return NextResponse.json({ error: error.message, table: "creatures" }, { status: 500 });
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
  // Uploaded images are files in Supabase Storage, not database rows, so a
  // JSON backup carries their URLs and not the files themselves. Say so:
  // otherwise the restore reports success and the user finds broken images
  // later, with nothing connecting the two.
  const storageObjectCount =
    isRecord(payload.storage) && typeof payload.storage.object_count === "number"
      ? payload.storage.object_count
      : 0;
  if (storageObjectCount > 0) {
    warnings.push(
      `storage: ${storageObjectCount} uploaded image(s) are referenced but not contained in this backup — copy the storage volume too, or they will be missing`
    );
  }

  return NextResponse.json({
    family_id: newFamilyId,
    join_code: joinCode,
    name: payload.family.name,
    warnings,
  });
}
