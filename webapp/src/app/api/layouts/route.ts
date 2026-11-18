import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import { UUID } from "@/lib/home/action-requests";
import { builtInScreensaver } from "@/lib/layouts/built-in";
import { gridFor } from "@/lib/layouts/grid";
import { rescaleItems } from "@/lib/layouts/rescale";
import { validateItems } from "@/lib/layouts/validate";
import { fail, notFound, parseName, readJson, sizeOk } from "@/lib/layouts/server";

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
 * POST /api/layouts  body: { name, width, height, from?: "builtin" | <layoutId> }
 *
 * A new layout of the family: empty, with the built-in screensaver, or a copy
 * of another of the family's layouts redrawn for the new size. A parent's
 * setting, behind the settings PIN.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;

  const body = await readJson(request);
  if (!body) return fail("bad_body");
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
  if (from === "builtin") {
    screensaver = builtInScreensaver(w, h);
  } else if (typeof from === "string") {
    if (!UUID.test(from)) return notFound();
    const { data: src, error: srcErr } = await db
      .from("layouts")
      .select("width, height, screensaver")
      .eq("id", from)
      .eq("family_id", familyId)
      .maybeSingle();
    if (srcErr) return NextResponse.json({ error: srcErr.message }, { status: 500 });
    if (!src) return notFound();
    const a = gridFor(src.width, src.height);
    const b = gridFor(w, h);
    if (a && b) {
      const items = rescaleItems(src.screensaver, a, b).items;
      const checked = validateItems(items, w, h);
      if (checked.ok) screensaver = checked.items;
    }
  }

  const { data, error } = await db
    .from("layouts")
    .insert({ family_id: familyId, name, width: w, height: h, screensaver })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ layout: data }, { status: 201 });
}
