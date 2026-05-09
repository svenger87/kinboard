import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { VehicleInsert } from "@/types/database";

export const dynamic = "force-dynamic";

// GET /api/vehicles/[id]
export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data, error } = await (supabase as any)
    .from("vehicles")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ vehicle: data });
}

// PATCH /api/vehicles/[id]  body: Partial<VehicleInsert>
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as Partial<VehicleInsert>;

  // Strip fields the caller can't change (id, family_id, created_at).
  const update: Partial<VehicleInsert> = {};
  if (body.vendor !== undefined) update.vendor = body.vendor;
  if (body.nickname !== undefined) update.nickname = body.nickname;
  if (body.color !== undefined) update.color = body.color;
  if (body.config !== undefined) update.config = body.config;
  if (body.position !== undefined) update.position = body.position;

  const supabase = createAdminClient();

  const { data, error } = await (supabase as any)
    .from("vehicles")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ vehicle: data });
}

// DELETE /api/vehicles/[id]
export async function DELETE(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { error } = await (supabase as any)
    .from("vehicles")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
