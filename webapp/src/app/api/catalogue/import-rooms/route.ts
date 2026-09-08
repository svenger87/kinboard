import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getMergedSetting } from "@/lib/integration-secrets";
import { familyIdFrom } from "@/lib/family-scope";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import type { HomeAssistantSettings } from "@/types/home-assistant";

export const dynamic = "force-dynamic";

type ImportRoomsBody = { family_id?: string };

/**
 * `areas()` / `area_name()` / `area_entities()` are Home Assistant's own
 * Jinja globals for its area registry — RFC-006 §3.3. One request returns
 * every area and the entities in it; no WebSocket client, no new
 * credential.
 */
const AREAS_TEMPLATE =
  "{% for a in areas() %}{{ area_name(a) }}|{{ area_entities(a) | join(',') }}\n{% endfor %}";

const EMPTY_RESULT = { updated: 0, rooms: [] as string[] };

/** rooms.name's CHECK is 1-80 characters; an area name longer than that is skipped. */
const NAME_MAX = 80;

/**
 * The key the rooms table is unique on — `lower(trim(name))`, the same match
 * `migration_rooms.sql` resolves a device's room text with. Anything else
 * here would create a second "flur" next to the household's "Flur".
 */
function roomKey(name: string): string {
  return name.trim().toLowerCase();
}

/** entity_id -> area name, parsed from the template call's plain-text body. */
function parseAreas(text: string): Map<string, string> {
  const byEntity = new Map<string, string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf("|");
    if (sep === -1) continue;
    const areaName = trimmed.slice(0, sep).trim();
    const entityList = trimmed.slice(sep + 1).trim();
    if (!areaName || !entityList) continue;
    for (const entityId of entityList.split(",")) {
      const id = entityId.trim();
      // If an entity is (mis)assigned to two Home Assistant areas, whichever
      // area's line appears later in the template output silently wins here
      // — harmless, since a room already set is never overwritten below, and
      // there is no ordering from HA worth preferring over another.
      if (id) byEntity.set(id, areaName);
    }
  }
  return byEntity;
}

/**
 * Fill in `room_id` for catalogue rows that don't have a room yet, from Home
 * Assistant's areas, creating the family's `rooms` rows as needed.
 *
 * This is an import convenience offered once by a button — RFC-006 §3.3 —
 * never a sync: a room a household already set (by this route or by hand)
 * is never touched, and nothing here runs on a schedule or a page load.
 * Every failure path (HA unreachable, a non-200, a token missing the
 * template scope) is swallowed into `{ updated: 0, rooms: [] }` rather than
 * surfaced as an error: rooms stay exactly as typed, same as before Home
 * Assistant was connected.
 *
 * Writes `room_id`, never the legacy free-text `room` — RFC-007 §3 leaves
 * that column exactly as the migration left it, unread, as what a household
 * recovers from if the migration guessed wrong. `saveEdit` on the catalogue
 * screen does the same. Writing the text instead is what made this button
 * inert: every screen groups strictly by `room_id`, so an import that only
 * set the text placed twenty devices and moved none of them.
 *
 * "Never overwrite a room you named yourself" now means what it says against
 * the rooms table: the candidate rows are the ones with no `room_id`. A row
 * that still carries legacy text but has had its room deliberately cleared
 * is a row with no room, and this button — which a person has to press — may
 * give it one.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const payload = (await request.json().catch(() => ({}))) as ImportRoomsBody;

  const familyId = familyIdFrom(request, payload);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const haSettings = await getMergedSetting<HomeAssistantSettings>(familyId, "home_assistant");
  if (!haSettings?.url || !haSettings.access_token) {
    return NextResponse.json(EMPTY_RESULT);
  }

  let areasByEntity: Map<string, string>;
  try {
    const response = await fetch(`${haSettings.url}/api/template`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${haSettings.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ template: AREAS_TEMPLATE }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[catalogue] import-rooms: Home Assistant template call failed:", response.status, errorText);
      return NextResponse.json(EMPTY_RESULT);
    }

    areasByEntity = parseAreas(await response.text());
  } catch (err) {
    console.error("[catalogue] import-rooms: could not reach Home Assistant:", err);
    return NextResponse.json(EMPTY_RESULT);
  }

  if (areasByEntity.size === 0) {
    return NextResponse.json(EMPTY_RESULT);
  }

  const supabase = createAdminClient();
  // The `if (!familyId)` guard above narrows it here but not inside the
  // hoisted helper below, which is why this exists at all.
  const scopedFamilyId: string = familyId;

  // Only rows with no room yet are candidates at all — the household's own
  // word for a place is never a target for this import.
  const { data: items, error } = await supabase
    .from("catalogue_items")
    .select("id, entity_id")
    .eq("family_id", familyId)
    .eq("kind", "ha_entity")
    .is("room_id", null);

  if (error) {
    console.error("[catalogue] import-rooms: list error:", error);
    return NextResponse.json(EMPTY_RESULT);
  }

  const candidates = (items ?? []).flatMap((item) => {
    if (!item.entity_id) return [];
    const areaName = areasByEntity.get(item.entity_id)?.trim();
    // The database's own CHECK is 1-80 characters. An area named longer than
    // that is skipped rather than sent, because the insert it would fail is
    // the whole import's insert.
    if (!areaName || areaName.length > NAME_MAX) return [];
    return [{ id: item.id, areaName }];
  });

  if (candidates.length === 0) {
    return NextResponse.json(EMPTY_RESULT);
  }

  // The family's rooms, keyed the way the migration matches them: trimmed and
  // case-insensitive, so an HA area called "flur" lands in the household's
  // existing "Flur" rather than beside it. `position` is read here too so a
  // room this import creates goes to the end of the list, same as /api/rooms.
  const { data: existingRooms, error: roomsError } = await supabase
    .from("rooms")
    .select("id, name, position")
    .eq("family_id", familyId);

  if (roomsError) {
    console.error("[catalogue] import-rooms: rooms list error:", roomsError);
    return NextResponse.json(EMPTY_RESULT);
  }

  const roomByKey = new Map<string, { id: string; name: string }>();
  let nextPosition = 0;
  for (const room of existingRooms ?? []) {
    roomByKey.set(roomKey(room.name), { id: room.id, name: room.name });
    nextPosition = Math.max(nextPosition, room.position + 1);
  }

  /**
   * The family's room for `areaName`, created if it isn't there yet.
   *
   * The duplicate is left to the unique index on (family_id,
   * lower(trim(name))) rather than pre-checked, for the same reason
   * /api/rooms does: a pre-check has a race that two writers can both pass.
   * A 23505 here means somebody else created the same room a moment ago, so
   * read theirs and use it.
   */
  async function findOrCreateRoom(areaName: string): Promise<{ id: string; name: string } | null> {
    const key = roomKey(areaName);
    const known = roomByKey.get(key);
    if (known) return known;

    const name = areaName.trim();
    const { data: created, error: insertError } = await supabase
      .from("rooms")
      .insert({ family_id: scopedFamilyId, name, position: nextPosition })
      .select("id, name")
      .single();

    if (!insertError && created) {
      nextPosition += 1;
      const room = { id: created.id, name: created.name };
      roomByKey.set(key, room);
      return room;
    }

    if ((insertError as { code?: string } | null)?.code !== "23505") {
      console.error("[catalogue] import-rooms: room insert error:", insertError);
      return null;
    }

    const { data: raced } = await supabase
      .from("rooms")
      .select("id, name")
      .eq("family_id", scopedFamilyId);
    const match = (raced ?? []).find((room) => roomKey(room.name) === key);
    if (!match) return null;
    const room = { id: match.id, name: match.name };
    roomByKey.set(key, room);
    return room;
  }

  const rooms = new Set<string>();
  let updated = 0;

  for (const candidate of candidates) {
    const room = await findOrCreateRoom(candidate.areaName);
    if (!room) continue;

    // `.is("room_id", null)` again here, not just in the select above: belt
    // and braces against a room being set by someone else between the read
    // and this write.
    const { data: updatedRow, error: updateError } = await supabase
      .from("catalogue_items")
      .update({ room_id: room.id })
      .eq("id", candidate.id)
      .is("room_id", null)
      .select("id")
      .maybeSingle();

    if (updateError) {
      console.error("[catalogue] import-rooms: update error:", updateError);
      continue;
    }
    if (!updatedRow) continue;

    updated += 1;
    // The household's own spelling of the room, not Home Assistant's, when
    // the two differ only in case or padding.
    rooms.add(room.name);
  }

  return NextResponse.json({ updated, rooms: Array.from(rooms).sort() });
}
