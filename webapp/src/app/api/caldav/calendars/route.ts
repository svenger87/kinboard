import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { assertCaldavUrl } from "@/lib/caldav-client";
import {
  deleteCaldavCredentials,
  getCaldavCredentials,
  saveCaldavCredentials,
} from "@/lib/caldav-credentials";
import { syncCaldavCalendar, getMappingRules } from "@/lib/caldav-sync";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CRUD for CalDAV-backed calendar rows.
 *
 * ICS feeds are created straight from the browser (useCreateIcsCalendar
 * inserts through PostgREST) because a public feed URL is not a secret.
 * CalDAV can't work that way: the password has to land in
 * integration_secrets, which is service_role-only. So the whole lifecycle
 * goes through this route, and the client hooks call it instead of
 * touching the table.
 */

interface CalendarPayload {
  family_id: string;
  name: string;
  color: string;
  server_url: string;
  calendar_url: string;
  username: string;
  password: string;
  person_id: string | null;
  is_holidays: boolean;
  is_waste_collection: boolean;
  read_only: boolean;
}

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

// A CalDAV calendar carries a stored username and password, so these verbs
// both read and write another household's server credentials if the family is
// theirs to name. It isn't any more.
// POST: add a discovered calendar to the family.
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const payload: CalendarPayload = {
    family_id: readString(body, "family_id"),
    name: readString(body, "name"),
    color: readString(body, "color") || "#3b82f6",
    server_url: readString(body, "server_url"),
    calendar_url: readString(body, "calendar_url"),
    username: readString(body, "username"),
    password: typeof body.password === "string" ? body.password : "",
    person_id: typeof body.person_id === "string" ? body.person_id : null,
    is_holidays: body.is_holidays === true,
    is_waste_collection: body.is_waste_collection === true,
    read_only: body.read_only === true,
  };

  const missing = (
    ["family_id", "name", "server_url", "calendar_url", "username"] as const
  ).filter((key) => !payload[key]);
  if (missing.length > 0 || !payload.password) {
    return NextResponse.json(
      { error: `Missing required field(s): ${[...missing, ...(payload.password ? [] : ["password"])].join(", ")}` },
      { status: 400 },
    );
  }

  if (!familyMatchesSession(auth.session, payload.family_id)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  try {
    assertCaldavUrl(payload.server_url);
    assertCaldavUrl(payload.calendar_url);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid URL" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  // One calendar collection should map to one row. Re-adding the same URL
  // would otherwise duplicate every event in the month view.
  const { data: duplicate } = await (supabase as any)
    .from("calendars")
    .select("id")
    .eq("family_id", payload.family_id)
    .eq("caldav_url", payload.calendar_url)
    .maybeSingle();

  if (duplicate) {
    return NextResponse.json(
      { error: "This calendar has already been added" },
      { status: 409 },
    );
  }

  const { data: calendar, error } = await (supabase as any)
    .from("calendars")
    .insert({
      family_id: payload.family_id,
      name: payload.name,
      color: payload.color,
      person_id: payload.person_id,
      is_holidays: payload.is_holidays,
      is_waste_collection: payload.is_waste_collection,
      caldav_url: payload.calendar_url,
      caldav_server_url: payload.server_url,
      caldav_read_only: payload.read_only,
    })
    .select()
    .single();

  if (error || !calendar) {
    console.error("[caldav-calendars] Insert failed:", error?.message);
    return NextResponse.json({ error: "Failed to create calendar" }, { status: 500 });
  }

  try {
    await saveCaldavCredentials(payload.family_id, calendar.id, {
      username: payload.username,
      password: payload.password,
    });
  } catch (err) {
    // A calendar row without credentials can never sync, so don't leave
    // one behind — roll back rather than strand a broken entry in the UI.
    await (supabase as any).from("calendars").delete().eq("id", calendar.id);
    console.error("[caldav-calendars] Credential store failed:", err);
    return NextResponse.json({ error: "Failed to store credentials" }, { status: 500 });
  }

  // Populate immediately — waiting up to 30 minutes for the cron to prove
  // the calendar works is a bad first impression.
  const sync = await syncCaldavCalendar(
    {
      id: calendar.id,
      family_id: payload.family_id,
      caldav_url: payload.calendar_url,
      caldav_server_url: payload.server_url,
      caldav_ctag: null,
      person_id: payload.person_id,
    },
    await getMappingRules(payload.family_id),
  );

  return NextResponse.json({ ok: true, calendar, sync });
}

// PATCH: edit presentation fields, and optionally rotate credentials.
export async function PATCH(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const familyId = readString(body, "family_id");
  const calendarId = readString(body, "calendar_id");
  if (!familyId || !calendarId) {
    return NextResponse.json(
      { error: "family_id and calendar_id are required" },
      { status: 400 },
    );
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
  if (typeof body.color === "string" && body.color.trim()) updates.color = body.color.trim();
  if (body.person_id === null || typeof body.person_id === "string") {
    updates.person_id = body.person_id;
  }
  if (typeof body.is_holidays === "boolean") updates.is_holidays = body.is_holidays;
  if (typeof body.is_waste_collection === "boolean") {
    updates.is_waste_collection = body.is_waste_collection;
  }

  const supabase = createAdminClient();

  if (Object.keys(updates).length > 0) {
    // Family-scoped so a calendar id belonging to another household
    // can't be edited by guessing it.
    const { error } = await (supabase as any)
      .from("calendars")
      .update(updates)
      .eq("id", calendarId)
      .eq("family_id", familyId);

    if (error) {
      console.error("[caldav-calendars] Update failed:", error.message);
      return NextResponse.json({ error: "Failed to update calendar" }, { status: 500 });
    }
  }

  // A blank password means "leave the stored one alone" — the settings
  // form never receives the current password, so an empty field is the
  // normal state when editing anything else.
  const password = typeof body.password === "string" ? body.password : "";
  const username = readString(body, "username");
  if (password) {
    const existing = await getCaldavCredentials(familyId, calendarId);
    try {
      await saveCaldavCredentials(familyId, calendarId, {
        username: username || existing?.username || "",
        password,
      });
      // New credentials may reach a changed calendar; drop the CTag so
      // the next sync does a full fetch rather than trusting a stale one.
      await (supabase as any)
        .from("calendars")
        .update({ caldav_ctag: null, caldav_last_error: null })
        .eq("id", calendarId);
    } catch (err) {
      console.error("[caldav-calendars] Credential update failed:", err);
      return NextResponse.json({ error: "Failed to store credentials" }, { status: 500 });
    }
  } else if (username) {
    const existing = await getCaldavCredentials(familyId, calendarId);
    if (existing && existing.username !== username) {
      return NextResponse.json(
        { error: "Changing the username requires re-entering the password" },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({ ok: true });
}

// DELETE: remove the calendar, its synced events, and its credentials.
export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const familyId = readString(body, "family_id");
  const calendarId = readString(body, "calendar_id");
  if (!familyId || !calendarId) {
    return NextResponse.json(
      { error: "family_id and calendar_id are required" },
      { status: 400 },
    );
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Scope the delete to the family so a calendar id from another
  // household can't be removed by guessing it.
  const { data: calendar } = await (supabase as any)
    .from("calendars")
    .select("id")
    .eq("id", calendarId)
    .eq("family_id", familyId)
    .maybeSingle();

  if (!calendar) {
    return NextResponse.json({ error: "Calendar not found" }, { status: 404 });
  }

  // events.calendar_id is ON DELETE CASCADE, but deleting explicitly
  // keeps the ordering obvious and matches useDeleteCalendar.
  await (supabase as any).from("events").delete().eq("calendar_id", calendarId);

  const { error } = await (supabase as any).from("calendars").delete().eq("id", calendarId);
  if (error) {
    console.error("[caldav-calendars] Delete failed:", error.message);
    return NextResponse.json({ error: "Failed to delete calendar" }, { status: 500 });
  }

  // integration_secrets has no FK to calendars, so this cascade is manual.
  await deleteCaldavCredentials(familyId, calendarId);

  return NextResponse.json({ ok: true });
}
