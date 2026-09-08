import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyIdFrom } from "@/lib/family-scope";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { ROOM_ICONS } from "@/types/home-assistant";
import type { RoomInsert } from "@/types/database";

export const dynamic = "force-dynamic";

const NAME_MAX = 80;
const ROOM_ICON_VALUES = new Set<string>(ROOM_ICONS.map((entry) => entry.value));
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

type RoomPostBody = {
  family_id?: string;
  name?: string;
  icon?: string | null;
  color?: string | null;
};

/** Normalise a room name: trim the ends, collapse internal whitespace. */
function normaliseName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** The family's rooms, in display order. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const familyId = familyIdFrom(request);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("family_id", familyId)
    .order("position", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    console.error("[rooms] list error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ rooms: data ?? [] });
}

/**
 * Add a room.
 *
 * Validated before it ever reaches Postgres, same reasoning as
 * `/api/catalogue`: the CHECK on `name` exists to protect the schema, not to
 * explain itself to a household. The one thing deliberately left to the
 * database is the unique violation on (family_id, lower(trim(name))) — a
 * pre-check has a race two people adding "Flur" at once can both pass, so
 * the duplicate is caught from the insert's error code instead.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const payload = (await request.json()) as RoomPostBody;

  const familyId = familyIdFrom(request, payload);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const rawName = typeof payload.name === "string" ? payload.name : "";
  const name = normaliseName(rawName);
  if (name.length === 0 || name.length > NAME_MAX) {
    return NextResponse.json(
      { error: `name must be 1-${NAME_MAX} characters` },
      { status: 400 },
    );
  }

  let icon: string | null = null;
  if (payload.icon !== undefined && payload.icon !== null) {
    if (typeof payload.icon !== "string" || !ROOM_ICON_VALUES.has(payload.icon)) {
      return NextResponse.json({ error: "invalid icon" }, { status: 400 });
    }
    icon = payload.icon;
  }

  let color: string | null = null;
  if (payload.color !== undefined && payload.color !== null) {
    if (typeof payload.color !== "string" || !COLOR_PATTERN.test(payload.color)) {
      return NextResponse.json({ error: "invalid color" }, { status: 400 });
    }
    color = payload.color;
  }

  const supabase = createAdminClient();

  // New rooms go to the end of the position list. Read max(position) for
  // the family; default to -1 so the first insert lands at 0.
  const { data: maxRow } = await supabase
    .from("rooms")
    .select("position")
    .eq("family_id", familyId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextPosition = (maxRow?.position ?? -1) + 1;

  const insert: RoomInsert = {
    family_id: familyId,
    name,
    icon,
    color,
    position: nextPosition,
  };

  const { data: room, error } = await supabase
    .from("rooms")
    .insert(insert)
    .select()
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "already_exists" }, { status: 409 });
    }
    console.error("[rooms] insert error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ room }, { status: 201 });
}
