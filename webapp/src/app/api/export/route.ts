import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { SECRET_FIELDS, splitSecrets } from "@/lib/integration-secrets";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

// GET /api/export?family_id=<uuid>
//
// Full-family JSON export (Milestone C Task 1). Downloads everything a
// family has stored so a self-hoster can back up / migrate without direct
// DB access.
//
// FK-respecting import order, if this payload is ever replayed:
//   families → people → calendars → events
//   recipes → recipe_ingredients / recipe_tags → recipe_tag_assignments
//   meal_plans → meal_plan_entries
//   birthdays → birthday_gift_ideas
//   item_catalog → shopping_items
//   families → vehicles (standalone, family-scoped)
//   families → tickers (standalone, family-scoped)
//   people → pocket_money_accounts → pocket_money_goals /
//     pocket_money_transactions / pocket_money_withdrawal_requests
//
// NEVER included: families.join_code, devices, push_subscriptions,
// notification_preferences, scheduled_notifications, notification_logs,
// oauth_credentials, integration_secrets, settings_pin, or raw secret
// values inside `settings` (scrubbed via splitSecrets for SECRET_FIELDS
// keys — belt-and-suspenders even though secrets already live only in
// integration_secrets).
/**
 * The uploaded files this export references but does not contain.
 *
 * Recipe photos, vehicle photos and pocket-money goal images are uploaded to
 * Supabase Storage; the database only holds their URL. Anything pointing
 * somewhere else — a recipe imported from a website keeps the publisher's
 * CDN link — is not ours and is left out.
 */
function collectStorageObjects(
  tables: Record<string, Array<Record<string, unknown>> | null | undefined>,
): Array<{ table: string; row_id: string; bucket: string; path: string }> {
  const objects: Array<{ table: string; row_id: string; bucket: string; path: string }> = [];

  for (const [table, rows] of Object.entries(tables)) {
    for (const row of rows ?? []) {
      const url = row.image_url;
      if (typeof url !== "string") continue;

      // Both the absolute form (external base configured) and the relative
      // fallback publicStorageUrl emits when it isn't.
      const match = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
      if (!match) continue;

      objects.push({
        table,
        row_id: typeof row.id === "string" ? row.id : "",
        bucket: match[1],
        path: decodeURI(match[2]),
      });
    }
  }

  return objects;
}

export async function GET(request: NextRequest) {
  // This hands back everything a family has ever entered — people, calendars,
  // events, notes, birthdays, shopping, pocket money. The only thing standing
  // in front of it was a family id in the query string, which is not a secret
  // and never was. A wrong id used to come back as "Family not found", i.e.
  // the route looked the family up before deciding whether the caller was
  // allowed to ask, which also made it an id oracle.
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const familyId = request.nextUrl.searchParams.get("family_id");

  if (!familyId) {
    return NextResponse.json(
      { error: "family_id is required" },
      { status: 400 }
    );
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    // The generated Database type doesn't cover every table this route
    // reads (same house style as other admin routes) — cast once locally.

    const db = supabase as any;

    const { data: family, error: familyError } = await db
      .from("families")
      .select("id, name, created_at")
      .eq("id", familyId)
      .maybeSingle();

    if (familyError) {
      return NextResponse.json(
        { error: familyError.message },
        { status: 500 }
      );
    }
    if (!family) {
      return NextResponse.json({ error: "Family not found" }, { status: 404 });
    }

    const people = await fetchAll(db, (q, from, to) =>
      q.from("people").select("*").eq("family_id", familyId).order("id").range(from, to)
    );
    const calendars = await fetchAll(db, (q, from, to) =>
      q.from("calendars").select("*").eq("family_id", familyId).order("id").range(from, to)
    );
    const calendarIds = calendars.map((c: Record<string, unknown>) => c.id as string);
    const events = await fetchAllByIds(db, "events", "calendar_id", calendarIds);

    const todos = await fetchAll(db, (q, from, to) =>
      q.from("todos").select("*").eq("family_id", familyId).order("id").range(from, to)
    );
    const shopping_items = await fetchAll(db, (q, from, to) =>
      q.from("shopping_items").select("*").eq("family_id", familyId).order("id").range(from, to)
    );
    const subjects = await fetchAll(db, (q, from, to) =>
      q.from("subjects").select("*").eq("family_id", familyId).order("id").range(from, to)
    );
    const schedules = await fetchAll(db, (q, from, to) =>
      q.from("schedules").select("*").eq("family_id", familyId).order("id").range(from, to)
    );
    const birthdays = await fetchAll(db, (q, from, to) =>
      q.from("birthdays").select("*").eq("family_id", familyId).order("id").range(from, to)
    );
    const birthday_gift_ideas = await fetchAll(db, (q, from, to) =>
      q.from("birthday_gift_ideas").select("*").eq("family_id", familyId).order("id").range(from, to)
    );
    const notes = await fetchAll(db, (q, from, to) =>
      q.from("notes").select("*").eq("family_id", familyId).order("id").range(from, to)
    );

    const recipes = await fetchAll(db, (q, from, to) =>
      q.from("recipes").select("*").eq("family_id", familyId).order("id").range(from, to)
    );
    const recipeIds = recipes.map((r: Record<string, unknown>) => r.id as string);
    const recipe_ingredients = await fetchAllByIds(db, "recipe_ingredients", "recipe_id", recipeIds);
    const recipe_tags = await fetchAll(db, (q, from, to) =>
      q.from("recipe_tags").select("*").eq("family_id", familyId).order("id").range(from, to)
    );
    // recipe_tag_assignments has a composite PK (recipe_id, tag_id) — no
    // `id` column exists, so the default order-by-"id" would 500.
    const recipe_tag_assignments = await fetchAllByIds(
      db,
      "recipe_tag_assignments",
      "recipe_id",
      recipeIds,
      ["recipe_id", "tag_id"]
    );

    const meal_plans = await fetchAll(db, (q, from, to) =>
      q.from("meal_plans").select("*").eq("family_id", familyId).order("id").range(from, to)
    );
    const mealPlanIds = meal_plans.map((m: Record<string, unknown>) => m.id as string);
    const meal_plan_entries = await fetchAllByIds(db, "meal_plan_entries", "meal_plan_id", mealPlanIds);

    // family_id is nullable on item_catalog (global catalog rows have
    // family_id = NULL); .eq() never matches NULL, so this naturally
    // excludes the global rows and returns only family-owned entries.
    const item_catalog = await fetchAll(db, (q, from, to) =>
      q.from("item_catalog").select("*").eq("family_id", familyId).order("id").range(from, to)
    );

    // Vehicles plugin (migration_vehicles.sql) — standalone, family-scoped.
    const vehicles = await fetchAll(db, (q, from, to) =>
      q.from("vehicles").select("*").eq("family_id", familyId).order("id").range(from, to)
    );

    // Stonks plugin (migration_tickers.sql) — standalone, family-scoped.
    const tickers = await fetchAll(db, (q, from, to) =>
      q.from("tickers").select("*").eq("family_id", familyId).order("id").range(from, to)
    );

    // Pocket Money plugin (migration_pocket_money.sql). Accounts carry
    // family_id directly (in addition to a UNIQUE person_id), so they're
    // scoped the same way as every other family-owned table; the three
    // child tables have no family_id of their own and are scoped via the
    // collected account ids, like events/ingredients/entries above.
    const pocket_money_accounts = await fetchAll(db, (q, from, to) =>
      q.from("pocket_money_accounts").select("*").eq("family_id", familyId).order("id").range(from, to)
    );
    const pocketMoneyAccountIds = pocket_money_accounts.map((a: Record<string, unknown>) => a.id as string);
    const pocket_money_goals = await fetchAllByIds(db, "pocket_money_goals", "account_id", pocketMoneyAccountIds);
    const pocket_money_transactions = await fetchAllByIds(db, "pocket_money_transactions", "account_id", pocketMoneyAccountIds);
    const pocket_money_withdrawal_requests = await fetchAllByIds(db, "pocket_money_withdrawal_requests", "account_id", pocketMoneyAccountIds);

    const rawSettings = await fetchAll(db, (q, from, to) =>
      q.from("settings").select("*").eq("family_id", familyId).order("id").range(from, to)
    );
    const settings = rawSettings
      .filter((row: Record<string, unknown>) => row.key !== SETTINGS_KEYS.settingsPin)
      .map((row: Record<string, unknown>) => {
        const key = row.key as string;
        return SECRET_FIELDS[key]
          ? { ...row, value: splitSecrets(key, row.value).publicValue }
          : row;
      });

    // Uploaded images live in Supabase Storage, not in Postgres, so a JSON
    // export carries their URLs and not the files. Restore into a fresh
    // install and every uploaded photo is a broken image, with nothing to say
    // why. Embedding the binaries would turn a photo library into a
    // multi-hundred-megabyte JSON file, so instead the export states plainly
    // what it references and leaves out.
    const storageObjects = collectStorageObjects({
      recipes,
      vehicles,
      pocket_money_goals,
    });

    const exportedAt = new Date().toISOString();
    const payload = {
      format: "kinboard-export",
      version: 2,
      exported_at: exportedAt,
      family,
      storage: {
        /** File contents are not in this file — only the references to them. */
        included: false,
        object_count: storageObjects.length,
        objects: storageObjects,
        note:
          storageObjects.length > 0
            ? "Uploaded images are stored as files, not database rows, so they are not in this backup. Copy the storage volume alongside it, or these images will be missing after a restore."
            : "No uploaded images to carry.",
      },
      data: {
        people,
        calendars,
        events,
        todos,
        shopping_items,
        subjects,
        schedules,
        birthdays,
        birthday_gift_ideas,
        notes,
        recipes,
        recipe_ingredients,
        recipe_tags,
        recipe_tag_assignments,
        meal_plans,
        meal_plan_entries,
        item_catalog,
        vehicles,
        tickers,
        pocket_money_accounts,
        pocket_money_goals,
        pocket_money_transactions,
        pocket_money_withdrawal_requests,
        settings,
      },
    };

    const filenameDate = exportedAt.slice(0, 10);
    return NextResponse.json(payload, {
      headers: {
        "Content-Disposition": `attachment; filename="kinboard-export-${filenameDate}.json"`,
      },
    });
  } catch (err) {
    console.error("export: failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Export failed" },
      { status: 500 }
    );
  }
}

// Supabase selects cap at 1000 rows by default. Page through in fixed-size
// windows so large families export completely.
const PAGE_SIZE = 1000;


async function fetchAll(

  db: any,

  build: (db: any, from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await build(db, from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

// Child tables that have no family_id of their own — scoped via a parent
// id list (e.g. events via calendar_id IN calendarIds). Returns [] without
// querying when the parent list is empty (an empty `.in()` filter is not
// guaranteed to short-circuit the same way across supabase-js versions).

async function fetchAllByIds(

  db: any,
  table: string,
  column: string,
  ids: string[],
  orderColumns: string[] = ["id"]
): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return [];
  return fetchAll(db, (q, from, to) => {
    let query = q.from(table).select("*").in(column, ids);
    for (const orderColumn of orderColumns) {
      query = query.order(orderColumn);
    }
    return query.range(from, to);
  });
}
