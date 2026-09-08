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
 * Fill in `room` for catalogue rows that don't have one yet, from Home
 * Assistant's areas.
 *
 * This is an import convenience offered once by a button — RFC-006 §3.3 —
 * never a sync: a room a household already set (by this route or by hand)
 * is never touched, and nothing here runs on a schedule or a page load.
 * Every failure path (HA unreachable, a non-200, a token missing the
 * template scope) is swallowed into `{ updated: 0, rooms: [] }` rather than
 * surfaced as an error: rooms stay exactly as typed, same as before Home
 * Assistant was connected.
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

  // Only rows with no room yet are candidates at all — the household's own
  // word for a place is never a target for this import.
  const { data: items, error } = await supabase
    .from("catalogue_items")
    .select("id, entity_id")
    .eq("family_id", familyId)
    .eq("kind", "ha_entity")
    .is("room", null);

  if (error) {
    console.error("[catalogue] import-rooms: list error:", error);
    return NextResponse.json(EMPTY_RESULT);
  }

  const rooms = new Set<string>();
  let updated = 0;

  for (const item of items ?? []) {
    if (!item.entity_id) continue;
    const room = areasByEntity.get(item.entity_id);
    if (!room) continue;

    // `.is("room", null)` again here, not just in the select above: belt and
    // braces against a room being set by someone else between the read and
    // this write.
    const { data: updatedRow, error: updateError } = await supabase
      .from("catalogue_items")
      .update({ room })
      .eq("id", item.id)
      .is("room", null)
      .select("id")
      .maybeSingle();

    if (updateError) {
      console.error("[catalogue] import-rooms: update error:", updateError);
      continue;
    }
    if (!updatedRow) continue;

    updated += 1;
    rooms.add(room);
  }

  return NextResponse.json({ updated, rooms: Array.from(rooms).sort() });
}
