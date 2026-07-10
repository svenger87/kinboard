import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  SECRET_FIELDS,
  applySentinels,
  getStoredSecrets,
  splitSecrets,
  upsertSecrets,
  deleteSecrets,
} from "@/lib/integration-secrets";

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

   
  const { data, error } = await (supabase as any)
    .from("settings")
    .select("*")
    .eq("family_id", familyId)
    .eq("key", key)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // No row exists — return 200 with null value so callers don't
      // surface browser-level "Failed to load resource: 404" console
      // errors on every dashboard load while integrations are
      // unconfigured. The hooks (use-google-calendar, use-cameras,
      // use-home-assistant, etc.) already converted 404 → null
      // internally; reading data.value === null in this branch is
      // semantically identical for them. Caught by the E2E smoke
      // suite on /calendar where google_calendar isn't seeded on
      // the demo overlay.
      return NextResponse.json({ value: null }, { status: 200 });
    }
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  if (SECRET_FIELDS[key]) {
    const secrets = await getStoredSecrets(familyId, key);
    return NextResponse.json({
      ...data,
      value: applySentinels(key, data.value, secrets),
    });
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

  let valueToStore = value;
  if (SECRET_FIELDS[key]) {
    const { publicValue, secretValue } = splitSecrets(key, value);
    valueToStore = publicValue;
    if (secretValue) {
      await upsertSecrets(family_id, key, secretValue);
    }
  }

  const { data, error } = await (supabase as any)
    .from("settings")
    .upsert(
      {
        family_id,
        key,
        value: valueToStore,
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

  if (SECRET_FIELDS[key]) {
    const secrets = await getStoredSecrets(family_id, key);
    return NextResponse.json({
      ...data,
      value: applySentinels(key, data.value, secrets),
    });
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

  if (SECRET_FIELDS[key]) {
    await deleteSecrets(family_id, key);
  }

  return NextResponse.json({ success: true });
}
