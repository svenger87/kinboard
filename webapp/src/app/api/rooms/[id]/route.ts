import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyIdFrom, rowInFamily } from "@/lib/family-scope";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { ROOM_ICONS } from "@/types/home-assistant";
import type { Room } from "@/types/database";

export const dynamic = "force-dynamic";

const NAME_MAX = 80;
const ROOM_ICON_VALUES = new Set<string>(ROOM_ICONS.map((entry) => entry.value));
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

type RoomPatchBody = {
  family_id?: string;
  name?: string;
  icon?: string | null;
  color?: string | null;
  position?: number;
};

/** Normalise a room name: trim the ends, collapse internal whitespace. */
function normaliseName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Rename, re-icon, re-colour or reorder a room.
 *
 * `family_id` and `id` are deliberately not accepted as fields to update —
 * what family a room belongs to is fixed at creation.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const payload = (await request.json()) as RoomPatchBody;

  const familyId = familyIdFrom(request, payload);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const update: Partial<Pick<Room, "name" | "icon" | "color" | "position">> = {};

  if (payload.name !== undefined) {
    const name = typeof payload.name === "string" ? normaliseName(payload.name) : "";
    if (name.length === 0 || name.length > NAME_MAX) {
      return NextResponse.json(
        { error: `name must be 1-${NAME_MAX} characters` },
        { status: 400 },
      );
    }
    update.name = name;
  }

  if (payload.icon !== undefined) {
    if (payload.icon === null) {
      update.icon = null;
    } else if (typeof payload.icon !== "string" || !ROOM_ICON_VALUES.has(payload.icon)) {
      return NextResponse.json({ error: "invalid icon" }, { status: 400 });
    } else {
      update.icon = payload.icon;
    }
  }

  if (payload.color !== undefined) {
    if (payload.color === null) {
      update.color = null;
    } else if (typeof payload.color !== "string" || !COLOR_PATTERN.test(payload.color)) {
      return NextResponse.json({ error: "invalid color" }, { status: 400 });
    } else {
      update.color = payload.color;
    }
  }

  if (payload.position !== undefined) {
    if (typeof payload.position !== "number" || !Number.isFinite(payload.position)) {
      return NextResponse.json({ error: "position must be a number" }, { status: 400 });
    }
    update.position = payload.position;
  }

  // Nothing recognized in the body — including a body that named only
  // fields this route ignores (family_id, id, …). An empty `.update({})`
  // is not a no-op to PostgREST; reject it before it reaches the database
  // rather than let it surface as a 500.
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no updatable fields provided" }, { status: 400 });
  }

  const supabase = createAdminClient();
  if (!(await rowInFamily(supabase, "rooms", id, familyId))) {
    // Same 404 for "not yours" as for "doesn't exist", so ids can't be
    // enumerated by watching the status code.
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data: room, error } = await supabase
    .from("rooms")
    .update(update)
    .eq("id", id)
    .eq("family_id", familyId)
    .select()
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "already_exists" }, { status: 409 });
    }
    console.error("[rooms] update error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ room });
}

/**
 * Remove a room.
 *
 * Nothing cascades from it: the FK on `catalogue_items.room_id` is
 * `ON DELETE SET NULL`, so devices in this room stay in the catalogue and
 * simply lose their room.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const familyId = familyIdFrom(request);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();
  if (!(await rowInFamily(supabase, "rooms", id, familyId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("rooms")
    .delete()
    .eq("id", id)
    .eq("family_id", familyId);

  if (error) {
    console.error("[rooms] delete error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
