import { NextRequest, NextResponse } from "next/server";
import { getMergedSetting } from "@/lib/integration-secrets";
import type { HomeAssistantSettings } from "@/types/home-assistant";
import { homeAssistantBase } from "@/lib/integration-energy";
import { fetchHaStatistics, HaStatisticsError } from "@/lib/home/ha-statistics";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

// GET: Fetch statistics for entities
// Proxies the household's own Home Assistant with the token stored for that
// family — see the note in ../route.ts.
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const searchParams = request.nextUrl.searchParams;
  const familyId = searchParams.get("family_id");
  const statisticIds = searchParams.get("statistic_ids"); // Comma-separated entity IDs
  const startTime = searchParams.get("start_time"); // ISO datetime
  const endTime = searchParams.get("end_time"); // ISO datetime
  const period = searchParams.get("period") || "hour"; // 5minute, hour, day, week, month

  if (!familyId) {
    return NextResponse.json(
      { error: "family_id is required" },
      { status: 400 }
    );
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  if (!statisticIds) {
    return NextResponse.json(
      { error: "statistic_ids is required" },
      { status: 400 }
    );
  }

  if (!startTime) {
    return NextResponse.json(
      { error: "start_time is required" },
      { status: 400 }
    );
  }

  // Get Home Assistant settings (with secrets merged in) from Supabase
  const haSettings = await getMergedSetting<HomeAssistantSettings>(familyId, "home_assistant");

  if (!haSettings) {
    return NextResponse.json(
      { error: "Home Assistant not configured" },
      { status: 401 }
    );
  }

  if (!haSettings.url || !haSettings.access_token) {
    return NextResponse.json(
      { error: "Home Assistant URL or access token not configured" },
      { status: 401 }
    );
  }

  const base = homeAssistantBase(haSettings.url);
  if (!base) {
    return NextResponse.json({ error: "Failed to connect to Home Assistant" }, { status: 500 });
  }

  // One code path with the Integration API's /energy/current — see
  // lib/home/ha-statistics.ts for the statistics endpoint, the history it
  // falls back to on a stock Home Assistant, and how `change` is counted.
  // The screens keep what they always had here: redirects followed, 20 s,
  // and no size cap (a month of history for chatty sensors is large).
  try {
    const statistics = await fetchHaStatistics({
      base,
      token: haSettings.access_token,
      ids: statisticIds.split(",").map((id) => id.trim()),
      startTime,
      endTime: endTime || undefined,
      period,
      timeoutMs: 20_000,
      maxBytes: Number.POSITIVE_INFINITY,
      redirect: "follow",
    });
    return NextResponse.json({ statistics });
  } catch (err) {
    if (err instanceof HaStatisticsError && err.stage !== "connection") {
      console.error("Home Assistant statistics error:", err.stage, err.status);
      return NextResponse.json(
        { error: err.stage === "history" ? "Failed to fetch history for statistics" : "Failed to fetch statistics from Home Assistant" },
        { status: err.status }
      );
    }
    console.error("Error fetching Home Assistant statistics:", err);
    return NextResponse.json(
      { error: "Failed to connect to Home Assistant" },
      { status: 500 }
    );
  }
}
