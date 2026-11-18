import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import { UUID } from "@/lib/home/action-requests";
import { orientationOf } from "@/lib/layouts/grid";
import { DEFAULTS_KEY, fail, readJson } from "@/lib/layouts/server";
import type { LayoutDefaults } from "@/lib/layouts/types";

export const dynamic = "force-dynamic";

/**
 * PUT /api/layouts/defaults  body: { portrait: <id> | null, landscape: <id> | null }
 *
 * Which layout a screen without one of its own uses, per orientation. Each id
 * must be a layout of the family drawn in that orientation; otherwise 400
 * bad_default. An id with no layout behind it (deleted meanwhile, or a stale
 * value a client still holds) counts as null, so a dangling slot can always
 * be cleared by sending the other one. Stored as the family's
 * `layout_defaults` setting, and the stored value is returned.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;

  const body = await readJson(request);
  if (!body) return fail("bad_body");
  const slots = ["portrait", "landscape"] as const;
  const defaults: LayoutDefaults = { portrait: null, landscape: null };
  for (const slot of slots) {
    const v = body[slot];
    if (v !== null && typeof v !== "string") return fail("bad_body");
    defaults[slot] = v;
  }

  const familyId = auth.session.familyId;
  const db = createAdminClient() as any;
  for (const slot of slots) {
    const id = defaults[slot];
    if (id === null) continue;
    if (!UUID.test(id)) return fail("bad_default");
    const { data: row, error } = await db
      .from("layouts")
      .select("width, height")
      .eq("id", id)
      .eq("family_id", familyId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!row) {
      defaults[slot] = null;
      continue;
    }
    if (orientationOf(row.width, row.height) !== slot) return fail("bad_default");
  }

  const { error } = await db
    .from("settings")
    .upsert(
      { family_id: familyId, key: DEFAULTS_KEY, value: defaults, updated_at: new Date().toISOString() },
      { onConflict: "family_id,key" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ defaults });
}
