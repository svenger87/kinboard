import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import { UUID } from "@/lib/home/action-requests";
import { validateItems } from "@/lib/layouts/validate";
import { LAYOUT_GRID } from "@/lib/layouts/grid";
import { homeArea } from "@/lib/layouts/home-area";
import { DEFAULTS_KEY, checkHomePeople, fail, gridChanged, gridOk, notFound, parseName, readDefaults, readJson } from "@/lib/layouts/server";

export const dynamic = "force-dynamic";

const PATCHABLE = new Set(["grid", "name", "home", "screensaver", "updated_at"]);

/**
 * PATCH /api/layouts/[id]  body: { grid: 48, name?, home?, screensaver?, updated_at }
 *
 * Saves a change to a layout of the family. `updated_at` is the stamp the
 * editor loaded: if the row has moved on, 409 stale and nothing is written,
 * so two editors cannot overwrite each other unseen. The screensaver is
 * checked against the layout's own size; Home against the area its grid gets
 * there (the screen less the navigation bar, homeArea), with Home's widgets
 * and minimums, and each `options.personId` must be a person of this family
 * (checkHomePeople). A refused arrangement of either is 400
 * { error, itemId }, the codes of validateItems; nothing is written. An
 * empty `home` puts the screen back on the built-in Home.
 *
 * Without `grid: 48` (a page on a bundle from before the steps), or on a row
 * not yet on the grid, 409 grid_changed and nothing is written.
 *
 * Clients must echo `updated_at` exactly as the server returned it; an
 * unparseable one is 400 bad_body.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;
  if (!UUID.test(id)) return notFound();

  const body = await readJson(request);
  if (!body) return fail("bad_body");
  if (!gridOk(body)) return gridChanged();
  if (Object.keys(body).some((k) => !PATCHABLE.has(k))) return fail("bad_body");
  if (typeof body.updated_at !== "string" || Number.isNaN(Date.parse(body.updated_at))) return fail("bad_body");

  const familyId = auth.session.familyId;
  const db = createAdminClient() as any;
  const { data: row, error: rowErr } = await db
    .from("layouts")
    .select("id, width, height, grid")
    .eq("id", id)
    .eq("family_id", familyId)
    .maybeSingle();
  if (rowErr) return NextResponse.json({ error: rowErr.message }, { status: 500 });
  if (!row) return notFound();
  if (row.grid !== LAYOUT_GRID) return gridChanged();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) {
    const name = parseName(body.name);
    if (!name) return fail("bad_name");
    patch.name = name;
  }
  if (body.screensaver !== undefined) {
    const checked = validateItems(body.screensaver, row.width, row.height);
    if (!checked.ok) return NextResponse.json({ error: checked.error, itemId: checked.itemId }, { status: 400 });
    patch.screensaver = checked.items;
  }
  if (body.home !== undefined) {
    const area = homeArea(row.width, row.height);
    const checked = validateItems(body.home, area.width, area.height, "home");
    if (!checked.ok) return NextResponse.json({ error: checked.error, itemId: checked.itemId }, { status: 400 });
    const people = await checkHomePeople(db, familyId, checked.items);
    if (!people.ok) {
      if (people.error === "db") return NextResponse.json({ error: people.message }, { status: 500 });
      return NextResponse.json({ error: people.error, itemId: people.itemId }, { status: 400 });
    }
    patch.home = checked.items;
  }

  // One statement: the stamp must still be the one the editor loaded.
  const { data, error } = await db
    .from("layouts")
    .update(patch)
    .eq("id", id)
    .eq("family_id", familyId)
    .eq("updated_at", body.updated_at)
    .eq("grid", LAYOUT_GRID)
    .select("*")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    const { data: again, error: againErr } = await db
      .from("layouts")
      .select("id")
      .eq("id", id)
      .eq("family_id", familyId)
      .maybeSingle();
    if (againErr) return NextResponse.json({ error: againErr.message }, { status: 500 });
    return again ? fail("stale", 409) : notFound();
  }
  return NextResponse.json({ layout: data });
}

/**
 * DELETE /api/layouts/[id]
 *
 * Removes a layout of the family. Its screens fall back to the built-in one
 * (ON DELETE SET NULL), and the id is cleared from the family's defaults in
 * the same request.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;
  if (!UUID.test(id)) return notFound();

  const familyId = auth.session.familyId;
  const db = createAdminClient() as any;
  const { data: gone, error } = await db
    .from("layouts")
    .delete()
    .eq("id", id)
    .eq("family_id", familyId)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!gone) return notFound();

  // A failure from here on leaves the layout deleted but the default still
  // naming it: resolution then falls through to the built-in layout.
  const { data: setting, error: settingErr } = await db
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", DEFAULTS_KEY)
    .maybeSingle();
  if (settingErr) return NextResponse.json({ error: settingErr.message }, { status: 500 });
  if (setting) {
    const d = readDefaults(setting.value);
    if (d.portrait === id || d.landscape === id) {
      const next = {
        portrait: d.portrait === id ? null : d.portrait,
        landscape: d.landscape === id ? null : d.landscape,
      };
      const { error: setErr } = await db
        .from("settings")
        .update({ value: next, updated_at: new Date().toISOString() })
        .eq("family_id", familyId)
        .eq("key", DEFAULTS_KEY);
      if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 });
    }
  }
  return new NextResponse(null, { status: 204 });
}
