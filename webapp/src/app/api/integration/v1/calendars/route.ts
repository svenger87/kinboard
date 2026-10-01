import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { createAdminClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/api-error";
import { calendarWriteMode, type WritableCalendar } from "@/lib/calendar-write-mode";

export const dynamic = "force-dynamic";

/** Show writable local, Google, and CalDAV calendars; hide subscriptions. */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    try {
      const { data, error } = await (createAdminClient() as any)
        .from("calendars")
        .select("id, name, person_id, google_calendar_id, ics_url, caldav_url, caldav_server_url, caldav_read_only")
        .eq("family_id", context.familyId)
        .order("name", { ascending: true })
        .limit(500);
      if (error) throw error;
      const calendars = ((data ?? []) as (WritableCalendar & { name: string; person_id: string | null })[])
        .filter((row) => calendarWriteMode(row) !== "read_only")
        .map((row) => ({ id: row.id, name: row.name, person_id: row.person_id, provider: calendarWriteMode(row) }));
      return NextResponse.json({ calendars });
    } catch (err) {
      await logApiError("integration/calendars", err);
      return NextResponse.json({ error: "Could not read calendars", code: "internal_error" }, { status: 500 });
    }
  });
}
