import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  SECRET_FIELDS,
  applySentinels,
  getMergedSetting,
  getStoredSecrets,
  resolveSentinels,
  splitSecrets,
  upsertSecrets,
  deleteSecrets,
} from "@/lib/integration-secrets";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

// Every verb here reads or writes one family's settings row, and the family
// was picked entirely by the caller. That covered integration config — Home
// Assistant base URLs, Immich and Unsplash endpoints, camera lists, the lot —
// and on the write side let anyone repoint another household's integrations.
// The session decides which family this route may touch; family_id is now only
// allowed to agree with it.

// GET: Fetch a setting by family_id and key
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const searchParams = request.nextUrl.searchParams;
  const familyId = searchParams.get("family_id");
  const key = searchParams.get("key");

  if (!familyId || !key) {
    return NextResponse.json(
      { error: "family_id and key are required" },
      { status: 400 }
    );
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
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
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const { family_id, key, value } = body;

  if (!family_id || !key || value === undefined) {
    return NextResponse.json(
      { error: "family_id, key, and value are required" },
      { status: 400 }
    );
  }

  if (!familyMatchesSession(auth.session, family_id)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();

  let valueToStore = value;
  if (SECRET_FIELDS[key]) {
    // What the client is sending back has sentinels where its secrets are —
    // it has never been given the real ones. Put them back before splitting,
    // or the split drops the path and the sentinel isn't worth storing, and
    // the secret ceases to exist. See resolveSentinels.
    const previous = await getMergedSetting<unknown>(family_id, key);
    const { publicValue, secretValue } = splitSecrets(
      key,
      resolveSentinels(key, value, previous)
    );
    valueToStore = publicValue;
    if (secretValue) {
      try {
        await upsertSecrets(family_id, key, secretValue);
      } catch (err) {
        console.error("settings PUT: upsertSecrets failed:", err);
        return NextResponse.json(
          { error: "Failed to store credentials" },
          { status: 500 }
        );
      }
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
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const { family_id, key } = body;

  if (!family_id || !key) {
    return NextResponse.json(
      { error: "family_id and key are required" },
      { status: 400 }
    );
  }

  if (!familyMatchesSession(auth.session, family_id)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
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
    try {
      await deleteSecrets(family_id, key);
    } catch (err) {
      console.error("settings DELETE: deleteSecrets failed:", err);
      return NextResponse.json(
        { error: "Failed to delete credentials" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ success: true });
}
