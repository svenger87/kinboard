import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  SECRET_FIELDS,
  applySentinels,
  getMergedSetting,
  getStoredSecrets,
  resolveSentinels,
  splitSecrets,
  upsertSecrets,
  deleteSecrets,
} from "@/lib/integration-secrets";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { isFamilyTimeZone } from "@/lib/integration-event-input";
import { checkCameraDoorbells } from "@/lib/camera-takeover";
import { isCalendarSyncRangeDays, CALENDAR_SYNC_RANGE_DAYS } from "@/lib/calendar-sync-range";
import { MAX_TIMER_PRESETS, MAX_TIMER_PRESET_MINUTES, isTimerWidgetSettings } from "@/lib/timer-presets";

// Every verb here reads or writes one family's settings row, and the family
// was picked entirely by the caller. That covered integration config — Home
// Assistant base URLs, Immich and Unsplash endpoints, camera lists, the lot —
// and on the write side let anyone repoint another household's integrations.
// The session decides which family this route may touch; family_id is now only
// allowed to agree with it.

// Keys this generic route must not write, because a dedicated route guards
// them with more than a session (RFC-010 §3.5). settings_pin is in
// SECRET_FIELDS, so a PUT here would upsert the PIN and a DELETE would
// remove it — straight past the server-side settings unlock /api/pin checks.
const DEDICATED_ROUTE_KEYS: Record<string, string> = {
  [SETTINGS_KEYS.settingsPin]: "/api/pin",
  // Needs the settings unlock too, and turning it off revokes assistants.
  [SETTINGS_KEYS.assistantsEnabled]: "/api/assistants",
  // RFC-014: picking a region is also what turns the school-holiday sync on,
  // so it is written in one server-side step (plan ruling 20).
  [SETTINGS_KEYS.holidayRegion]: "/api/holidays/region",
  // RFC-014 §5: the switch and the school region empty or refill synced rows.
  [SETTINGS_KEYS.schoolHolidaySync]: "/api/school-holidays/sync",
};

function dedicatedRoute(key: unknown): NextResponse | null {
  if (typeof key !== "string" || !(key in DEDICATED_ROUTE_KEYS)) return null;
  return NextResponse.json(
    { error: `${key} is changed through ${DEDICATED_ROUTE_KEYS[key]}` },
    { status: 403 }
  );
}

// GET: Fetch a setting by family_id and key
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const searchParams = request.nextUrl.searchParams;
  const familyId = searchParams.get("family_id");
  const key = searchParams.get("key");

  if (!familyId || !key) {
    return NextResponse.json(
      { error: "family_id and key are required" },
      { status: 400 }
    );
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();

   
  const { data, error } = await (supabase as any)
    .from("settings")
    .select("*")
    .eq("family_id", familyId)
    .eq("key", key)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // No row exists — return 200 with null value so callers don't
      // surface browser-level "Failed to load resource: 404" console
      // errors on every dashboard load while integrations are
      // unconfigured. The hooks (use-google-calendar, use-cameras,
      // use-home-assistant, etc.) already converted 404 → null
      // internally; reading data.value === null in this branch is
      // semantically identical for them. Caught by the E2E smoke
      // suite on /calendar where google_calendar isn't seeded on
      // the demo overlay.
      return NextResponse.json({ value: null }, { status: 200 });
    }
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  if (SECRET_FIELDS[key]) {
    const secrets = await getStoredSecrets(familyId, key);
    return NextResponse.json({
      ...data,
      value: applySentinels(key, data.value, secrets),
    });
  }
  return NextResponse.json(data);
}

// PUT: Update or create a setting
export async function PUT(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const { family_id, key, value } = body;

  const dedicated = dedicatedRoute(key);
  if (dedicated) return dedicated;

  if (!family_id || !key || value === undefined) {
    return NextResponse.json(
      { error: "family_id, key, and value are required" },
      { status: 400 }
    );
  }

  if (!familyMatchesSession(auth.session, family_id)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // A camera's doorbell is read by the Home Assistant integration, which calls
  // show_camera when it rings: a malformed id, or one bell on two cameras,
  // would be stored here and acted on there. Refused before anything is written.
  if (key === SETTINGS_KEYS.cameras) {
    const doorbells = checkCameraDoorbells(value?.cameras);
    if (!doorbells.ok) {
      return NextResponse.json({ error: doorbells.error }, { status: 400 });
    }
  }

  // The family's time zone decides when its day starts and ends, in the
  // database as on the server. A name nothing knows would be passed over
  // there — silently, as if it were unset — so it is refused here instead,
  // and so is a bare offset such as "+05:00", which the database reads with
  // the opposite sign (isFamilyTimeZone).
  // Automatic, the server's own zone, is no value: delete the setting.
  if (key === SETTINGS_KEYS.timezone && !isFamilyTimeZone(value)) {
    return NextResponse.json(
      { error: "timezone must be an IANA zone name such as Europe/Berlin; delete the setting for the server's own" },
      { status: 400 }
    );
  }

  // Exactly three choices (see lib/calendar-sync-range.ts) — a stray value
  // here would otherwise be stored, read back by every sync path through
  // normalizeCalendarSyncRangeDays, and silently treated as 60 anyway. Refuse
  // it instead of storing a number nothing honours.
  if (key === SETTINGS_KEYS.calendarSyncRange && !isCalendarSyncRangeDays(value)) {
    return NextResponse.json(
      { error: `calendar_sync_range must be one of: ${CALENDAR_SYNC_RANGE_DAYS.join(", ")}` },
      { status: 400 }
    );
  }

  // Each preset is a button on every screen that starts a timer of that
  // length. The widget skips what it can't start, so a bad list would lose
  // the family's buttons without a word: it is refused here instead.
  if (key === SETTINGS_KEYS.timerWidget && !isTimerWidgetSettings(value)) {
    return NextResponse.json(
      { error: `timer_widget must be { presets: [...] }: 1 to ${MAX_TIMER_PRESETS} different whole minutes, each from 1 to ${MAX_TIMER_PRESET_MINUTES}` },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  let valueToStore = value;
  if (SECRET_FIELDS[key]) {
    // What the client is sending back has sentinels where its secrets are —
    // it has never been given the real ones. Put them back before splitting,
    // or the split drops the path and the sentinel isn't worth storing, and
    // the secret ceases to exist. See resolveSentinels.
    const previous = await getMergedSetting<unknown>(family_id, key);
    const { publicValue, secretValue } = splitSecrets(
      key,
      resolveSentinels(key, value, previous)
    );
    valueToStore = publicValue;
    if (secretValue) {
      try {
        await upsertSecrets(family_id, key, secretValue);
      } catch (err) {
        console.error("settings PUT: upsertSecrets failed:", err);
        return NextResponse.json(
          { error: "Failed to store credentials" },
          { status: 500 }
        );
      }
    }
  }

  const { data, error } = await (supabase as any)
    .from("settings")
    .upsert(
      {
        family_id,
        key,
        value: valueToStore,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "family_id,key",
      }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  if (SECRET_FIELDS[key]) {
    const secrets = await getStoredSecrets(family_id, key);
    return NextResponse.json({
      ...data,
      value: applySentinels(key, data.value, secrets),
    });
  }

  return NextResponse.json(data);
}

// DELETE: Delete a setting
export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const { family_id, key } = body;

  const dedicated = dedicatedRoute(key);
  if (dedicated) return dedicated;

  if (!family_id || !key) {
    return NextResponse.json(
      { error: "family_id and key are required" },
      { status: 400 }
    );
  }

  if (!familyMatchesSession(auth.session, family_id)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();

   
  const { error } = await (supabase as any)
    .from("settings")
    .delete()
    .eq("family_id", family_id)
    .eq("key", key);

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  if (SECRET_FIELDS[key]) {
    try {
      await deleteSecrets(family_id, key);
    } catch (err) {
      console.error("settings DELETE: deleteSecrets failed:", err);
      return NextResponse.json(
        { error: "Failed to delete credentials" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ success: true });
}
