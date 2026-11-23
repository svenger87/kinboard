import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import { UUID } from "@/lib/home/action-requests";
import { builtInScreensaver } from "@/lib/layouts/built-in";
import { fitItems } from "@/lib/layouts/rescale";
import { validateItems } from "@/lib/layouts/validate";
import { LAYOUT_GRID } from "@/lib/layouts/grid";
import { homeArea } from "@/lib/layouts/home-area";
import { checkHomePeople, fail, gridChanged, gridOk, notFound, parseName, readJson, sizeOk } from "@/lib/layouts/server";

export const dynamic = "force-dynamic";

/** GET /api/layouts -> { layouts }: the family's layouts. A session is enough. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const db = createAdminClient() as any;
  const { data, error } = await db
    .from("layouts")
    .select("*")
    .eq("family_id", auth.session.familyId)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ layouts: data ?? [] });
}

/**
 * POST /api/layouts  body: { grid: 48, name, width, height, from?: "builtin" | <layoutId> }
 *
 * A new layout of the family: empty, with the built-in screensaver, or a copy
 * of another of the family's layouts redrawn for the new size. A parent's
 * setting, behind the settings PIN. 201 { layout, dropped, droppedHome }:
 * `dropped` lists the ids of the copied screensaver items that did not fit
 * the new size, `droppedHome` those of Home (each empty otherwise). A copy
 * redraws Home too, in the area its grid gets on each size (homeArea); a
 * source whose Home is empty (the built-in) gives a copy with an empty Home.
 * The built-in start leaves Home empty: the screen uses the built-in Home.
 * Without `grid: 48`, 409 grid_changed (lib/layouts/server.ts gridOk); a
 * source layout not on the grid is 409 grid_changed too.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;

  const body = await readJson(request);
  if (!body) return fail("bad_body");
  if (!gridOk(body)) return gridChanged();
  const name = parseName(body.name);
  if (!name) return fail("bad_name");
  const { width, height, from } = body;
  if (!sizeOk(width, height)) return fail("bad_size");
  const w = width as number;
  const h = height as number;
  if (from !== undefined && typeof from !== "string") return fail("bad_body");

  const familyId = auth.session.familyId;
  const db = createAdminClient() as any;
  let screensaver: unknown[] = [];
  let home: unknown[] = [];
  let dropped: string[] = [];
  let droppedHome: string[] = [];
  if (from === "builtin") {
    // Checked like any saved layout before it is stored; the built-in
    // arrangement always passes (layouts-rules covers every preset), so a
    // failure here is a bug, answered as one rather than stored.
    const built = validateItems(builtInScreensaver(w, h), w, h);
    if (!built.ok) {
      console.error("layouts: the built-in arrangement is not valid at", w, h, built.error, built.itemId);
      return NextResponse.json({ error: "builtin_invalid" }, { status: 500 });
    }
    screensaver = built.items;
  } else if (typeof from === "string") {
    if (!UUID.test(from)) return notFound();
    const { data: src, error: srcErr } = await db
      .from("layouts")
      .select("width, height, grid, home, screensaver")
      .eq("id", from)
      .eq("family_id", familyId)
      .maybeSingle();
    if (srcErr) return NextResponse.json({ error: srcErr.message }, { status: 500 });
    if (!src) return notFound();
    if (src.grid !== LAYOUT_GRID) return gridChanged();
    const fitted = fitItems(src.screensaver, { width: src.width, height: src.height }, { width: w, height: h });
    screensaver = fitted.items;
    dropped = fitted.dropped;
    const fittedHome = fitItems(src.home, homeArea(src.width, src.height), homeArea(w, h), "home");
    let homeItems = fittedHome.items;
    droppedHome = fittedHome.dropped;
    // A child's widget whose person has gone since (the recycle bin) is left
    // out, as a save of the copy would refuse it.
    for (;;) {
      const people = await checkHomePeople(db, familyId, homeItems);
      if (people.ok) break;
      if (people.error === "db") return NextResponse.json({ error: people.message }, { status: 500 });
      homeItems = homeItems.filter((i) => i.id !== people.itemId);
      droppedHome.push(people.itemId);
    }
    home = homeItems;
  }

  const { data, error } = await db
    .from("layouts")
    .insert({ family_id: familyId, name, width: w, height: h, grid: LAYOUT_GRID, home, screensaver })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ layout: data, dropped, droppedHome }, { status: 201 });
}
