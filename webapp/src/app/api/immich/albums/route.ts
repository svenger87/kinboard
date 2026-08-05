import { NextRequest, NextResponse } from "next/server";
import { getMergedSetting } from "@/lib/integration-secrets";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

interface ImmichSettings {
  url: string;
  api_key: string;
  selected_album?: string;
}

interface ImmichAlbum {
  id: string;
  albumName: string;
  albumThumbnailAssetId: string | null;
  assetCount: number;
  createdAt: string;
  updatedAt: string;
  shared: boolean;
}

// GET: Fetch albums from Immich
// Proxies the family's own Immich server using the API key stored for them,
// so the family id in the query decided whose photo library got read.
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const searchParams = request.nextUrl.searchParams;
  const familyId = searchParams.get("family_id");

  if (!familyId) {
    return NextResponse.json(
      { error: "family_id is required" },
      { status: 400 }
    );
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
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
    // Fetch albums from Immich API
    const response = await fetch(`${immichSettings.url}/api/albums`, {
      headers: {
        "x-api-key": immichSettings.api_key,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Immich API error:", response.status, errorText);
      return NextResponse.json(
        { error: "Failed to fetch albums from Immich" },
        { status: response.status }
      );
    }

    const albums: ImmichAlbum[] = await response.json();

    // Return simplified album list
    return NextResponse.json({
      albums: albums.map((album) => ({
        id: album.id,
        name: album.albumName,
        assetCount: album.assetCount,
        thumbnailId: album.albumThumbnailAssetId,
        shared: album.shared,
      })),
    });
  } catch (err) {
    console.error("Error fetching Immich albums:", err);
    return NextResponse.json(
      { error: "Failed to connect to Immich" },
      { status: 500 }
    );
  }
}
