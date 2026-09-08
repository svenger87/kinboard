import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyIdFrom } from "@/lib/family-scope";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import type { CatalogueItemInsert } from "@/types/database";

export const dynamic = "force-dynamic";

const NAME_MAX = 120;

type CataloguePostBody = {
  family_id?: string;
  kind?: string;
  entity_id?: string | null;
  builtin_key?: string | null;
  name?: string;
  room?: string | null;
  image_url?: string | null;
};

/** The family's catalogue, in display order. */
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
    .from("catalogue_items")
    .select("*")
    .eq("family_id", familyId)
    .order("position", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    console.error("[catalogue] list error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] });
}

/**
 * Add a thing the household cares about.
 *
 * Validated before it ever reaches Postgres: the CHECK constraints in
 * RFC-006 §2 exist to protect the schema, not to explain themselves to a
 * household. The one thing deliberately left to the database is the unique
 * violation on (family_id, entity_id) / (family_id, builtin_key) — a
 * pre-check has a race two people adding the same device at once can both
 * pass, so the duplicate is caught from the insert's error code instead.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const payload = (await request.json()) as CataloguePostBody;

  const familyId = familyIdFrom(request, payload);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  if (payload.kind !== "ha_entity" && payload.kind !== "builtin") {
    return NextResponse.json({ error: "kind must be ha_entity or builtin" }, { status: 400 });
  }
  const kind = payload.kind;

  const entityId = typeof payload.entity_id === "string" ? payload.entity_id.trim() : "";
  const builtinKey = typeof payload.builtin_key === "string" ? payload.builtin_key.trim() : "";

  if (kind === "ha_entity") {
    if (!entityId) {
      return NextResponse.json({ error: "entity_id required for kind ha_entity" }, { status: 400 });
    }
    if (payload.builtin_key) {
      return NextResponse.json(
        { error: "builtin_key must not be set for kind ha_entity" },
        { status: 400 },
      );
    }
  } else {
    if (!builtinKey) {
      return NextResponse.json({ error: "builtin_key required for kind builtin" }, { status: 400 });
    }
    if (payload.entity_id) {
      return NextResponse.json(
        { error: "entity_id must not be set for kind builtin" },
        { status: 400 },
      );
    }
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (name.length === 0 || name.length > NAME_MAX) {
    return NextResponse.json(
      { error: `name must be 1-${NAME_MAX} characters` },
      { status: 400 },
    );
  }

  const room = typeof payload.room === "string" && payload.room.trim() ? payload.room.trim() : null;
  const imageUrl =
    typeof payload.image_url === "string" && payload.image_url.trim() ? payload.image_url.trim() : null;

  const supabase = createAdminClient();

  // New rows go to the end of the position list. Read max(position) for the
  // family; default to -1 so the first insert lands at 0.
  const { data: maxRow } = await supabase
    .from("catalogue_items")
    .select("position")
    .eq("family_id", familyId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextPosition = (maxRow?.position ?? -1) + 1;

  const insert: CatalogueItemInsert = {
    family_id: familyId,
    kind,
    entity_id: kind === "ha_entity" ? entityId : null,
    builtin_key: kind === "builtin" ? builtinKey : null,
    name,
    room,
    image_url: imageUrl,
    position: nextPosition,
  };

  const { data: item, error } = await supabase
    .from("catalogue_items")
    .insert(insert)
    .select()
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "already_exists" }, { status: 409 });
    }
    console.error("[catalogue] insert error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ item }, { status: 201 });
}
