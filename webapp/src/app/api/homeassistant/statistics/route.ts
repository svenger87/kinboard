import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { HomeAssistantSettings, StatisticsPeriod } from "@/types/home-assistant";

// Statistics response from Home Assistant
interface HAStatisticsResponse {
  [entity_id: string]: Array<{
    start: string;
    end: string;
    mean?: number;
    min?: number;
    max?: number;
    sum?: number;
    change?: number;
    state?: number;
  }>;
}

// GET: Fetch statistics for entities
export async function GET(request: NextRequest) {
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

  // Get Home Assistant settings from Supabase
  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: settings } = await (supabase as any)
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", "home_assistant")
    .single();

  if (!settings?.value) {
    return NextResponse.json(
      { error: "Home Assistant not configured" },
      { status: 401 }
    );
  }

  const haSettings = settings.value as HomeAssistantSettings;
  if (!haSettings.url || !haSettings.access_token) {
    return NextResponse.json(
      { error: "Home Assistant URL or access token not configured" },
      { status: 401 }
    );
  }

  try {
    // Home Assistant statistics API (available since 2021.8)
    // Uses WebSocket API: recorder/statistics_during_period
    // But we can also use the REST API: /api/history/statistics

    const ids = statisticIds.split(",").map((id) => id.trim());

    // Build URL params
    const params = new URLSearchParams({
      statistic_ids: ids.join(","),
      period,
      start_time: startTime,
    });

    if (endTime) {
      params.append("end_time", endTime);
    }

    const statisticsUrl = `${haSettings.url}/api/history/statistics?${params.toString()}`;

    const response = await fetch(statisticsUrl, {
      headers: {
        Authorization: `Bearer ${haSettings.access_token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      // If statistics API is not available (older HA versions), fall back to computing from history
      if (response.status === 404) {
        return await getStatisticsFromHistory(
          haSettings,
          ids,
          startTime,
          endTime || new Date().toISOString(),
          period
        );
      }

      const errorText = await response.text();
      console.error("Home Assistant Statistics API error:", response.status, errorText);
      return NextResponse.json(
        { error: "Failed to fetch statistics from Home Assistant" },
        { status: response.status }
      );
    }

    const rawStats: HAStatisticsResponse = await response.json();

    // Transform to our format
    const statistics: Record<string, StatisticsPeriod[]> = {};

    for (const [entityId, periods] of Object.entries(rawStats)) {
      statistics[entityId] = periods.map((p) => ({
        start: p.start,
        end: p.end,
        mean: p.mean,
        min: p.min,
        max: p.max,
        sum: p.sum,
        change: p.change,
      }));
    }

    return NextResponse.json({ statistics });
  } catch (err) {
    console.error("Error fetching Home Assistant statistics:", err);
    return NextResponse.json(
      { error: "Failed to connect to Home Assistant" },
      { status: 500 }
    );
  }
}

// Fallback: compute statistics from history data
async function getStatisticsFromHistory(
  haSettings: HomeAssistantSettings,
  entityIds: string[],
  startTime: string,
  endTime: string,
  period: string
): Promise<NextResponse> {
  try {
    const filterEntityIds = entityIds.join(",");
    const historyUrl = `${haSettings.url}/api/history/period/${encodeURIComponent(startTime)}?filter_entity_id=${encodeURIComponent(filterEntityIds)}&end_time=${encodeURIComponent(endTime)}&minimal_response`;

    const response = await fetch(historyUrl, {
      headers: {
        Authorization: `Bearer ${haSettings.access_token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch history for statistics" },
        { status: response.status }
      );
    }

    const rawHistory: Array<Array<{
      entity_id: string;
      state: string;
      last_changed: string;
    }>> = await response.json();

    // Compute statistics from history
    const statistics: Record<string, StatisticsPeriod[]> = {};

    for (const entityStates of rawHistory) {
      if (entityStates.length === 0) continue;

      const entityId = entityStates[0].entity_id;

      // Parse numeric values
      const values = entityStates
        .filter((s) => s.state !== "unavailable" && s.state !== "unknown")
        .map((s) => parseFloat(s.state))
        .filter((v) => !isNaN(v));

      if (values.length === 0) {
        statistics[entityId] = [];
        continue;
      }

      // Compute basic statistics for the entire period
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);
      const sum = values.reduce((a, b) => a + b, 0);
      const change = values.length > 1 ? values[values.length - 1] - values[0] : 0;

      statistics[entityId] = [{
        start: startTime,
        end: endTime,
        mean,
        min,
        max,
        sum,
        change,
      }];
    }

    return NextResponse.json({ statistics });
  } catch (err) {
    console.error("Error computing statistics from history:", err);
    return NextResponse.json(
      { error: "Failed to compute statistics" },
      { status: 500 }
    );
  }
}
