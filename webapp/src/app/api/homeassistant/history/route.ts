import { NextRequest, NextResponse } from "next/server";
import { getMergedSetting } from "@/lib/integration-secrets";
import type { HomeAssistantSettings, HistoryPoint, EntityHistory } from "@/types/home-assistant";

// GET: Fetch historical state data for entities
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const familyId = searchParams.get("family_id");
  const entityIds = searchParams.get("entity_ids"); // Comma-separated entity IDs
  const startTime = searchParams.get("start_time"); // ISO datetime
  const endTime = searchParams.get("end_time"); // ISO datetime (default: now)
  const minimalResponse = searchParams.get("minimal_response") === "true";

  if (!familyId) {
    return NextResponse.json(
      { error: "family_id is required" },
      { status: 400 }
    );
  }

  if (!entityIds) {
    return NextResponse.json(
      { error: "entity_ids is required" },
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

  try {
    // Build the Home Assistant history API URL
    // Format: /api/history/period/{start_time}?filter_entity_id={entity_id}&end_time={end_time}
    const ids = entityIds.split(",").map((id) => id.trim());
    const filterEntityIds = ids.join(",");

    let historyUrl = `${haSettings.url}/api/history/period/${encodeURIComponent(startTime)}`;
    historyUrl += `?filter_entity_id=${encodeURIComponent(filterEntityIds)}`;

    if (endTime) {
      historyUrl += `&end_time=${encodeURIComponent(endTime)}`;
    }

    if (minimalResponse) {
      historyUrl += "&minimal_response";
    }

    // Add significant_changes_only to reduce data for longer periods
    const significantChangesOnly = searchParams.get("significant_changes_only") === "true";
    if (significantChangesOnly) {
      historyUrl += "&significant_changes_only";
    }

    // Add no_attributes to reduce response size
    historyUrl += "&no_attributes";

    // Fetch history from Home Assistant API
    const response = await fetch(historyUrl, {
      headers: {
        Authorization: `Bearer ${haSettings.access_token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Home Assistant History API error:", response.status, errorText);
      return NextResponse.json(
        { error: "Failed to fetch history from Home Assistant" },
        { status: response.status }
      );
    }

    // HA returns array of arrays: [[entity1_states], [entity2_states], ...]
    const rawHistory: Array<Array<{
      entity_id: string;
      state: string;
      last_changed: string;
      attributes?: Record<string, unknown>;
    }>> = await response.json();

    // Transform to our format with parsed numeric values
    const entityHistories: EntityHistory[] = rawHistory.map((entityStates) => {
      if (entityStates.length === 0) {
        return { entity_id: "", history: [] };
      }

      const entityId = entityStates[0].entity_id;

      // Parse states to numeric values where possible
      const history: HistoryPoint[] = entityStates
        .filter((state) => state.state !== "unavailable" && state.state !== "unknown")
        .map((state) => {
          const numericValue = parseFloat(state.state);
          return {
            timestamp: state.last_changed,
            state: isNaN(numericValue) ? (state.state === "on" ? 1 : 0) : numericValue,
          };
        });

      return {
        entity_id: entityId,
        history,
      };
    }).filter((h) => h.entity_id !== "");

    return NextResponse.json({ histories: entityHistories });
  } catch (err) {
    console.error("Error fetching Home Assistant history:", err);
    return NextResponse.json(
      { error: "Failed to connect to Home Assistant" },
      { status: 500 }
    );
  }
}
