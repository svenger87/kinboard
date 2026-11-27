import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import { UUID } from "@/lib/home/action-requests";
import { LAYOUT_GRID } from "@/lib/layouts/grid";
import { fail, gridChanged, gridOk, notFound, parseName, readJson } from "@/lib/layouts/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/layouts/[id]/duplicate  body: { grid: 48, name } -> 201 { layout }:
 * a copy under a new name. Without `grid: 48`, or from a row not on the grid,
 * 409 grid_changed.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;
  if (!UUID.test(id)) return notFound();

  const body = await readJson(request);
  if (!body) return fail("bad_body");
  if (!gridOk(body)) return gridChanged();
  const name = parseName(body.name);
  if (!name) return fail("bad_name");

  const familyId = auth.session.familyId;
  const db = createAdminClient() as any;
  const { data: src, error: srcErr } = await db
    .from("layouts")
    .select("width, height, grid, home, screensaver")
    .eq("id", id)
    .eq("family_id", familyId)
    .maybeSingle();
  if (srcErr) return NextResponse.json({ error: srcErr.message }, { status: 500 });
  if (!src) return notFound();
  if (src.grid !== LAYOUT_GRID) return gridChanged();

  const { data, error } = await db
    .from("layouts")
    .insert({ family_id: familyId, name, width: src.width, height: src.height, grid: LAYOUT_GRID, home: src.home, screensaver: src.screensaver })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ layout: data }, { status: 201 });
}
