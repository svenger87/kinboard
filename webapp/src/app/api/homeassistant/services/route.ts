import { NextRequest, NextResponse } from "next/server";
import { getMergedSetting } from "@/lib/integration-secrets";
import type { HomeAssistantSettings, HAServiceCall } from "@/types/home-assistant";

// POST: Call a Home Assistant service
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { family_id, domain, service, entity_id, service_data } = body as HAServiceCall & { family_id: string };

    if (!family_id) {
      return NextResponse.json(
        { error: "family_id is required" },
        { status: 400 }
      );
    }

    if (!domain || !service) {
      return NextResponse.json(
        { error: "domain and service are required" },
        { status: 400 }
      );
    }

    // Get Home Assistant settings (with secrets merged in) from Supabase
    const haSettings = await getMergedSetting<HomeAssistantSettings>(family_id, "home_assistant");

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

    // Build service call payload
    const payload: Record<string, unknown> = { ...service_data };
    if (entity_id) {
      payload.entity_id = entity_id;
    }

    // Call Home Assistant service
    const response = await fetch(
      `${haSettings.url}/api/services/${domain}/${service}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${haSettings.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Home Assistant service call error:", response.status, errorText);
      return NextResponse.json(
        { error: `Service call failed: ${response.status}` },
        { status: response.status }
      );
    }

    // Service calls return the new states of affected entities
    const result = await response.json();

    return NextResponse.json({
      success: true,
      affected_entities: result.length || 0,
    });
  } catch (err) {
    console.error("Error calling Home Assistant service:", err);
    return NextResponse.json(
      { error: "Failed to call Home Assistant service" },
      { status: 500 }
    );
  }
}
