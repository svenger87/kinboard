import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { HomeAssistantSettings, HAEntityState, HAEntity } from "@/types/home-assistant";

// GET: Fetch all entities or filter by domain
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const familyId = searchParams.get("family_id");
  const domain = searchParams.get("domain"); // Optional: filter by domain (e.g., "sensor", "light")
  const entityIds = searchParams.get("entity_ids"); // Optional: comma-separated entity IDs

  if (!familyId) {
    return NextResponse.json(
      { error: "family_id is required" },
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
    // Fetch states from Home Assistant API
    const response = await fetch(`${haSettings.url}/api/states`, {
      headers: {
        Authorization: `Bearer ${haSettings.access_token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Home Assistant API error:", response.status, errorText);
      return NextResponse.json(
        { error: "Failed to fetch entities from Home Assistant" },
        { status: response.status }
      );
    }

    let states: HAEntityState[] = await response.json();

    // Filter by domain if specified
    if (domain) {
      states = states.filter((state) => state.entity_id.startsWith(`${domain}.`));
    }

    // Filter by specific entity IDs if specified
    if (entityIds) {
      const ids = entityIds.split(",").map((id) => id.trim());
      states = states.filter((state) => ids.includes(state.entity_id));
    }

    // Transform to simplified entity format
    const entities: HAEntity[] = states.map((state) => ({
      entity_id: state.entity_id,
      domain: state.entity_id.split(".")[0],
      name: state.attributes.friendly_name || state.entity_id.split(".")[1].replace(/_/g, " "),
      state: state.state,
      attributes: state.attributes,
      last_changed: state.last_changed,
    }));

    // Sort by domain and then by name
    entities.sort((a, b) => {
      if (a.domain !== b.domain) {
        return a.domain.localeCompare(b.domain);
      }
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({ entities });
  } catch (err) {
    console.error("Error fetching Home Assistant entities:", err);
    return NextResponse.json(
      { error: "Failed to connect to Home Assistant" },
      { status: 500 }
    );
  }
}
