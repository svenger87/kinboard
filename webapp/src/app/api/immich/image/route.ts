import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

interface ImmichSettings {
  url: string;
  api_key: string;
}

// GET: Proxy image from Immich (handles authentication)
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const familyId = searchParams.get("family_id");
  const assetId = searchParams.get("asset_id");
  const size = searchParams.get("size") || "preview"; // thumbnail, preview, or original

  if (!familyId || !assetId) {
    return NextResponse.json(
      { error: "family_id and asset_id are required" },
      { status: 400 }
    );
  }

  // Get Immich settings from Supabase
  const supabase = createAdminClient();
   
  const { data: settings } = await (supabase as any)
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", "immich")
    .single();

  if (!settings?.value) {
    return NextResponse.json(
      { error: "Immich not configured" },
      { status: 401 }
    );
  }

  const immichSettings = settings.value as ImmichSettings;
  if (!immichSettings.url || !immichSettings.api_key) {
    return NextResponse.json(
      { error: "Immich URL or API key not configured" },
      { status: 401 }
    );
  }

  try {
    // Fetch image from Immich with authentication
    const imageUrl = size === "original"
      ? `${immichSettings.url}/api/assets/${assetId}/original`
      : `${immichSettings.url}/api/assets/${assetId}/thumbnail?size=${size}`;

    const response = await fetch(imageUrl, {
      headers: {
        "x-api-key": immichSettings.api_key,
      },
    });

    if (!response.ok) {
      console.error("Immich image fetch error:", response.status);
      return NextResponse.json(
        { error: "Failed to fetch image from Immich" },
        { status: response.status }
      );
    }

    // Get the image data
    const imageBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/jpeg";

    // Return the image with appropriate headers
    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600", // Cache for 1 hour
      },
    });
  } catch (err) {
    console.error("Error proxying Immich image:", err);
    return NextResponse.json(
      { error: "Failed to connect to Immich" },
      { status: 500 }
    );
  }
}
