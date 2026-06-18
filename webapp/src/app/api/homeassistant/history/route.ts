import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { HomeAssistantSettings, HistoryPoint, EntityHistory } from "@/types/home-assistant";

// Time-bucket a numeric series down to at most `maxPoints` points, averaging the
// values in each bucket. Keeps the visual shape of instantaneous sensors (power,
// battery %) while bounding payload + client render cost. Series are already in
// chronological order from HA, so bucket keys are emitted chronologically.
function downsample(history: HistoryPoint[], maxPoints: number): HistoryPoint[] {
  if (history.length <= maxPoints) return history;
  const first = new Date(history[0].timestamp).getTime();
  const last = new Date(history[history.length - 1].timestamp).getTime();
  const bucketMs = Math.max(1, (last - first) / maxPoints);
  const buckets = new Map<number, { sum: number; count: number; t: number }>();
  for (const p of history) {
    const ts = new Date(p.timestamp).getTime();
    const key = Math.floor((ts - first) / bucketMs);
    const cur = buckets.get(key);
    if (cur) {
      cur.sum += p.state;
      cur.count += 1;
    } else {
      buckets.set(key, { sum: p.state, count: 1, t: ts });
    }
  }
  return Array.from(buckets.values()).map((b) => ({
    timestamp: new Date(b.t).toISOString(),
    state: b.sum / b.count,
  }));
}

// GET: Fetch historical state data for entities
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const familyId = searchParams.get("family_id");
  const entityIds = searchParams.get("entity_ids"); // Comma-separated entity IDs
  const startTime = searchParams.get("start_time"); // ISO datetime
  const endTime = searchParams.get("end_time"); // ISO datetime (default: now)

  // Cap on points returned per entity after server-side downsampling. Raw HA
  // history over a week/month can be hundreds of thousands of points per
  // sensor, which freezes the client while recharts re-buckets it. We reduce it
  // here so the payload and client work stay bounded regardless of range.
  const MAX_POINTS_PER_ENTITY = 800;

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

  // Get Home Assistant settings from Supabase
  const supabase = createAdminClient();
   
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
    // Build the Home Assistant history API URL
    // Format: /api/history/period/{start_time}?filter_entity_id={entity_id}&end_time={end_time}
    const ids = entityIds.split(",").map((id) => id.trim());
    const filterEntityIds = ids.join(",");

    let historyUrl = `${haSettings.url}/api/history/period/${encodeURIComponent(startTime)}`;
    historyUrl += `?filter_entity_id=${encodeURIComponent(filterEntityIds)}`;

    if (endTime) {
      historyUrl += `&end_time=${encodeURIComponent(endTime)}`;
    }

    // Always minimize the payload: minimal_response drops repeated full state
    // objects, no_attributes drops attribute blobs. Both are parser-compatible
    // (we only read state + last_changed below).
    historyUrl += "&minimal_response&no_attributes";

    // For ranges longer than ~a day, also let HA collapse insignificant
    // fluctuations server-side before it even sends them — this is the single
    // biggest reduction for noisy sensors (power updating every few seconds).
    const rangeMs =
      new Date(endTime || Date.now()).getTime() - new Date(startTime).getTime();
    const isLongRange = rangeMs > 26 * 60 * 60 * 1000;
    if (isLongRange || searchParams.get("significant_changes_only") === "true") {
      historyUrl += "&significant_changes_only";
    }

    // Fetch history from Home Assistant API
    const response = await fetch(historyUrl, {
      headers: {
        Authorization: `Bearer ${haSettings.access_token}`,
        "Content-Type": "application/json",
      },
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
        history: downsample(history, MAX_POINTS_PER_ENTITY),
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
