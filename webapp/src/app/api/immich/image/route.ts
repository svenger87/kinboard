import { NextRequest, NextResponse } from "next/server";
import { getMergedSetting } from "@/lib/integration-secrets";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

interface ImmichSettings {
  url: string;
  api_key: string;
}

// GET: Proxy image from Immich (handles authentication)
// Proxies the family's own Immich server using the API key stored for them,
// so the family id in the query decided whose photo library got read.
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const searchParams = request.nextUrl.searchParams;
  const familyId = searchParams.get("family_id");
  const assetId = searchParams.get("asset_id");
  // Also user-controlled, and it lands in the query string. Immich only
  // understands these three, so anything else is either a typo or an attempt
  // to append parameters of the caller's choosing.
  const sizeParam = searchParams.get("size") || "preview";
  const size = ["thumbnail", "preview", "original"].includes(sizeParam) ? sizeParam : "preview";

  if (!familyId || !assetId) {
    return NextResponse.json(
      { error: "family_id and asset_id are required" },
      { status: 400 }
    );
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // Same reasoning as the Home Assistant camera proxy: this id lands in the
  // path of a request carrying the family's Immich API key, so it has to be
  // an asset id and nothing else. Immich asset ids are UUIDs.
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(assetId)) {
    return NextResponse.json({ error: "invalid asset_id" }, { status: 400 });
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
