import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyIdFrom, rowInFamily } from "@/lib/family-scope";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import type { CatalogueItem } from "@/types/database";

export const dynamic = "force-dynamic";

const NAME_MAX = 120;

type CataloguePatchBody = {
  family_id?: string;
  name?: string;
  room?: string | null;
  room_id?: string | null;
  image_url?: string | null;
  position?: number;
};

/**
 * Rename, re-room, re-image or reorder a catalogue item.
 *
 * `kind`, `entity_id`, `builtin_key` and `family_id` are deliberately not
 * accepted here. What a row points at is fixed at creation — a PATCH that
 * could repoint it is how a row ends up in one family pointing at another
 * family's entity.
 *
 * `room_id` is the exception: it names another table's row, so it gets its
 * own membership check below rather than being trusted like a plain column.
 * The legacy free-text `room` is untouched by this — nothing here rewrites
 * or clears it; see RFC-007 §3.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const payload = (await request.json()) as CataloguePatchBody;

  const familyId = familyIdFrom(request, payload);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const update: Partial<
    Pick<CatalogueItem, "name" | "room" | "room_id" | "image_url" | "position">
  > = {};

  if (payload.name !== undefined) {
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    if (name.length === 0 || name.length > NAME_MAX) {
      return NextResponse.json(
        { error: `name must be 1-${NAME_MAX} characters` },
        { status: 400 },
      );
    }
    update.name = name;
  }
  if (payload.room !== undefined) {
    update.room = typeof payload.room === "string" && payload.room.trim() ? payload.room.trim() : null;
  }
  if (payload.image_url !== undefined) {
    update.image_url =
      typeof payload.image_url === "string" && payload.image_url.trim()
        ? payload.image_url.trim()
        : null;
  }
  if (payload.position !== undefined) {
    if (typeof payload.position !== "number" || !Number.isFinite(payload.position)) {
      return NextResponse.json({ error: "position must be a number" }, { status: 400 });
    }
    update.position = payload.position;
  }
  if (payload.room_id !== undefined && payload.room_id !== null && typeof payload.room_id !== "string") {
    return NextResponse.json({ error: "room_id must be a string or null" }, { status: 400 });
  }

  // Nothing recognized in the body — including a body that named only
  // fields this route ignores (kind, entity_id, family_id, …). An empty
  // `.update({})` is not a no-op to PostgREST; reject it before it reaches
  // the database rather than let it surface as a 500.
  if (Object.keys(update).length === 0 && payload.room_id === undefined) {
    return NextResponse.json({ error: "no updatable fields provided" }, { status: 400 });
  }

  const supabase = createAdminClient();
  if (!(await rowInFamily(supabase, "catalogue_items", id, familyId))) {
    // Same 404 for "not yours" as for "doesn't exist", so ids can't be
    // enumerated by watching the status code.
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (payload.room_id !== undefined) {
    if (payload.room_id === null) {
      update.room_id = null;
    } else if (!(await rowInFamily(supabase, "rooms", payload.room_id, familyId))) {
      // A room id from another family (or one that doesn't exist, or isn't
      // even a UUID) gets the same 404 as an unowned catalogue item —
      // confirming it's real by answering differently is the mistake.
      return NextResponse.json({ error: "not found" }, { status: 404 });
    } else {
      update.room_id = payload.room_id;
    }
  }

  const { data: item, error } = await supabase
    .from("catalogue_items")
    .update(update)
    .eq("id", id)
    .eq("family_id", familyId)
    .select()
    .single();

  if (error) {
    console.error("[catalogue] update error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ item });
}

/** Remove a catalogue item. Nothing cascades from it. */
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
  if (!(await rowInFamily(supabase, "catalogue_items", id, familyId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("catalogue_items")
    .delete()
    .eq("id", id)
    .eq("family_id", familyId);

  if (error) {
    console.error("[catalogue] delete error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
