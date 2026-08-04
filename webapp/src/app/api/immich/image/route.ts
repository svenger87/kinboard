import { NextRequest, NextResponse } from "next/server";
import { getMergedSetting } from "@/lib/integration-secrets";

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

  // Get Immich settings (with secrets merged in) from Supabase
  const immichSettings = await getMergedSetting<ImmichSettings>(familyId, "immich");

  if (!immichSettings) {
    return NextResponse.json(
      { error: "Immich not configured" },
      { status: 401 }
    );
  }

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
      signal: AbortSignal.timeout(20_000),
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
