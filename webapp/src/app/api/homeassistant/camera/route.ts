import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { HomeAssistantSettings } from "@/types/home-assistant";

// GET: Proxy camera image/stream from Home Assistant
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const familyId = searchParams.get("family_id");
  const entityId = searchParams.get("entity_id");
  const type = searchParams.get("type") || "snapshot"; // "snapshot" or "stream"

  if (!familyId || !entityId) {
    return NextResponse.json(
      { error: "family_id and entity_id are required" },
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
    // Use camera_proxy for snapshots, camera_proxy_stream for MJPEG
    const endpoint = type === "stream"
      ? `${haSettings.url}/api/camera_proxy_stream/${entityId}`
      : `${haSettings.url}/api/camera_proxy/${entityId}`;

    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${haSettings.access_token}`,
      },
    });

    if (!response.ok) {
      console.error("Camera proxy error:", response.status);
      return NextResponse.json(
        { error: "Failed to fetch camera image" },
        { status: response.status }
      );
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const imageBuffer = await response.arrayBuffer();

    return new NextResponse(imageBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    console.error("Error fetching camera image:", err);
    return NextResponse.json(
      { error: "Failed to fetch camera image" },
      { status: 500 }
    );
  }
}
