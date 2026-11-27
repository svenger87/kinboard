import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import { UUID } from "@/lib/home/action-requests";
import { LAYOUT_GRID } from "@/lib/layouts/grid";
import { fail, gridChanged, notFound, readJson } from "@/lib/layouts/server";

export const dynamic = "force-dynamic";

/**
 * PUT /api/devices/[id]/layout  body: { layout_id: <uuid> | null }
 *
 * Which layout a screen shows (null: the built-in one). The device and the
 * layout must both be the session's family's -- the foreign key checks
 * neither. Rewrites the layout it leaves and the one it takes with their own
 * family_id (a no-op that still fires the change feed trigger), so the
 * screens learn of it. updated_at is left alone: bumping it would make an
 * open editor's next save fail as stale. Behind the settings PIN; the
 * browser roles cannot write devices.layout_id (migrations/086_layouts.sql).
 * Answers with the whole device row. A layout not on the grid (still in
 * cells) is 409 grid_changed: the screen would not use it.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;
  if (!UUID.test(id)) return notFound();

  const body = await readJson(request);
  if (!body || !("layout_id" in body)) return fail("bad_body");
  const layoutId = body.layout_id;
  if (layoutId !== null && typeof layoutId !== "string") return fail("bad_body");
  if (typeof layoutId === "string" && !UUID.test(layoutId)) return notFound();

  const familyId = auth.session.familyId;
  const db = createAdminClient() as any;

  const { data: device, error: devErr } = await db
    .from("devices")
    .select("id, layout_id")
    .eq("id", id)
    .eq("family_id", familyId)
    .maybeSingle();
  if (devErr) return NextResponse.json({ error: devErr.message }, { status: 500 });
  if (!device) return notFound();

  if (layoutId !== null) {
    const { data: layout, error: layoutErr } = await db
      .from("layouts")
      .select("id, grid")
      .eq("id", layoutId)
      .eq("family_id", familyId)
      .maybeSingle();
    if (layoutErr) return NextResponse.json({ error: layoutErr.message }, { status: 500 });
    if (!layout) return notFound();
    if (layout.grid !== LAYOUT_GRID) return gridChanged();
  }

  const { data, error } = await db
    .from("devices")
    .update({ layout_id: layoutId })
    .eq("id", id)
    .eq("family_id", familyId)
    .select("*")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return notFound();

  // A failure from here on leaves the device changed but the layouts not
  // touched: the screens learn on their next refetch instead of at once.
  const touched = [device.layout_id, layoutId].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
  if (touched.length > 0) {
    const { error: touchErr } = await db
      .from("layouts")
      .update({ family_id: familyId })
      .in("id", touched)
      .eq("family_id", familyId);
    if (touchErr) return NextResponse.json({ error: touchErr.message }, { status: 500 });
  }
  return NextResponse.json({ device: data });
}
