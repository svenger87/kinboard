import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// GET: Fetch a setting by family_id and key
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const familyId = searchParams.get("family_id");
  const key = searchParams.get("key");

  if (!familyId || !key) {
    return NextResponse.json(
      { error: "family_id and key are required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("settings")
    .select("*")
    .eq("family_id", familyId)
    .eq("key", key)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json(
        { error: "Setting not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}

// PUT: Update or create a setting
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { family_id, key, value } = body;

  if (!family_id || !key || value === undefined) {
    return NextResponse.json(
      { error: "family_id, key, and value are required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("settings")
    .upsert(
      {
        family_id,
        key,
        value,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "family_id,key",
      }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}

// DELETE: Delete a setting
export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { family_id, key } = body;

  if (!family_id || !key) {
    return NextResponse.json(
      { error: "family_id and key are required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("settings")
    .delete()
    .eq("family_id", family_id)
    .eq("key", key);

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
