import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getMergedSetting } from "@/lib/integration-secrets";

export async function GET(request: NextRequest) {
  const familyId = request.nextUrl.searchParams.get("family_id");
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }

  const supabase = createAdminClient();

   
  const sb = supabase as any;

  const [familyR, peopleR, calendarsR, settingsR] = await Promise.all([
    sb.from("families").select("setup_completed").eq("id", familyId).maybeSingle(),
    sb.from("people").select("id", { count: "exact", head: true }).eq("family_id", familyId),
    sb.from("calendars").select("id", { count: "exact", head: true }).eq("family_id", familyId),
    sb.from("settings").select("key, value").eq("family_id", familyId).in("key", ["weather_location"]),
  ]);

  if (familyR.error) {
    return NextResponse.json({ error: familyR.error.message }, { status: 500 });
  }
  if (peopleR.error) {
    console.error("setup/state: people query failed:", peopleR.error);
    return NextResponse.json({ error: peopleR.error.message }, { status: 500 });
  }
  if (calendarsR.error) {
    // Calendar is a skippable step — treat a failed read as "no calendar"
    // rather than 500ing the whole state read.
    console.error("setup/state: calendars query failed:", calendarsR.error);
  }
  if (settingsR.error) {
    // Settings reads are optional — HA and weather are skippable wizard
    // steps. Log the failure and treat both integrations as unconfigured
    // rather than 500ing the whole state read; the wizard will surface
    // the steps as incomplete and the user can retry by navigating in.
    console.error("setup/state: settings query failed:", settingsR.error);
  }

  const settingsRows = (settingsR.data ?? []) as Array<{ key: string; value: unknown }>;
  const wx = settingsRows.find((s) => s.key === "weather_location")?.value as { city?: string; lat?: number; lon?: number } | undefined;
  const ha = await getMergedSetting<{ url?: string; access_token?: string }>(familyId, "home_assistant");

  return NextResponse.json({
    setup_completed: !!familyR.data?.setup_completed,
    has_family: !!familyR.data,
    has_people: (peopleR.count ?? 0) > 0,
    has_calendar: (calendarsR.count ?? 0) > 0,
    has_home_assistant: !!(ha?.url && ha?.access_token),
    has_weather_location: !!(wx?.city || (wx?.lat && wx?.lon)),
  });
}
