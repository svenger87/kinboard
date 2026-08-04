import { NextRequest, NextResponse } from "next/server";
import { getMergedSetting } from "@/lib/integration-secrets";
import type { HomeAssistantSettings, HAConfig } from "@/types/home-assistant";

// GET: Test connection and return HA config
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const familyId = searchParams.get("family_id");

  if (!familyId) {
    return NextResponse.json(
      { error: "family_id is required" },
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
    // Fetch config from Home Assistant API
    const response = await fetch(`${haSettings.url}/api/config`, {
      headers: {
        Authorization: `Bearer ${haSettings.access_token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Home Assistant API error:", response.status, errorText);
      return NextResponse.json(
        { error: "Failed to connect to Home Assistant" },
        { status: response.status }
      );
    }

    const config: HAConfig = await response.json();

    return NextResponse.json({
      connected: true,
      config: {
        location_name: config.location_name,
        version: config.version,
        state: config.state,
      },
      last_connected: haSettings.last_connected,
    });
  } catch (err) {
    console.error("Error connecting to Home Assistant:", err);
    return NextResponse.json(
      { error: "Failed to connect to Home Assistant" },
      { status: 500 }
    );
  }
}

// POST: Test connection with provided credentials (before saving)
export async function POST(request: NextRequest) {
  try {
    const { url, access_token } = await request.json();

    if (!url || !access_token) {
      return NextResponse.json(
        { error: "URL and access token are required" },
        { status: 400 }
      );
    }

    // Normalize URL (remove trailing slash)
    const normalizedUrl = url.replace(/\/$/, "");

    // Test connection by fetching config
    const response = await fetch(`${normalizedUrl}/api/config`, {
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      if (response.status === 401) {
        return NextResponse.json(
          { error: "Invalid access token" },
          { status: 401 }
        );
      }
      return NextResponse.json(
        { error: "Failed to connect to Home Assistant" },
        { status: response.status }
      );
    }

    const config: HAConfig = await response.json();

    return NextResponse.json({
      success: true,
      config: {
        location_name: config.location_name,
        version: config.version,
      },
    });
  } catch (err) {
    console.error("Error testing Home Assistant connection:", err);
    return NextResponse.json(
      { error: "Failed to connect to Home Assistant. Check the URL." },
      { status: 500 }
    );
  }
}
