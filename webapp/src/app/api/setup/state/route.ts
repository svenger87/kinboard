import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// NOTE: `as never` casts on setup_completed are working around stale
// database.types.ts — the column was added by migration_setup_completed.sql
// but types haven't been regenerated yet. Drop the casts after the next
// `npm run db:generate` against a live stack.

export async function GET(request: NextRequest) {
  const familyId = request.nextUrl.searchParams.get("family_id");
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const [familyR, peopleR, settingsR] = await Promise.all([
    supabase.from("families").select("setup_completed" as never).eq("id", familyId).maybeSingle(),
    supabase.from("people").select("id", { count: "exact", head: true }).eq("family_id", familyId),
    supabase.from("settings").select("key, value").eq("family_id", familyId).in("key", ["home_assistant", "weather_location"]),
  ]);

  if (familyR.error) {
    return NextResponse.json({ error: familyR.error.message }, { status: 500 });
  }
  if (peopleR.error) {
    console.error("setup/state: people query failed:", peopleR.error);
    return NextResponse.json({ error: peopleR.error.message }, { status: 500 });
  }
  if (settingsR.error) {
    // Settings reads are optional — HA and weather are skippable wizard
    // steps. Log the failure and treat both integrations as unconfigured
    // rather than 500ing the whole state read; the wizard will surface
    // the steps as incomplete and the user can retry by navigating in.
    console.error("setup/state: settings query failed:", settingsR.error);
  }

  const ha = settingsR.data?.find((s) => s.key === "home_assistant")?.value as { url?: string; access_token?: string } | undefined;
  const wx = settingsR.data?.find((s) => s.key === "weather_location")?.value as { city?: string; lat?: number; lon?: number } | undefined;

  return NextResponse.json({
    setup_completed: !!(familyR.data as { setup_completed?: boolean } | null)?.setup_completed,
    has_family: !!familyR.data,
    has_people: (peopleR.count ?? 0) > 0,
    has_home_assistant: !!(ha?.url && ha?.access_token),
    has_weather_location: !!(wx?.city || (wx?.lat && wx?.lon)),
  });
}
