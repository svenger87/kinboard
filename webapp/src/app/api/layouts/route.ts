import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import { UUID } from "@/lib/home/action-requests";
import { builtInScreensaver } from "@/lib/layouts/built-in";
import { fitItems } from "@/lib/layouts/rescale";
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
 * setting, behind the settings PIN. 201 { layout, dropped }: `dropped` lists
 * the ids of the copied items that did not fit the new size (empty otherwise).
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
  let dropped: string[] = [];
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
      .select("width, height, screensaver")
      .eq("id", from)
      .eq("family_id", familyId)
      .maybeSingle();
    if (srcErr) return NextResponse.json({ error: srcErr.message }, { status: 500 });
    if (!src) return notFound();
    const fitted = fitItems(src.screensaver, { width: src.width, height: src.height }, { width: w, height: h });
    screensaver = fitted.items;
    dropped = fitted.dropped;
  }

  const { data, error } = await db
    .from("layouts")
    .insert({ family_id: familyId, name, width: w, height: h, screensaver })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ layout: data, dropped }, { status: 201 });
}
