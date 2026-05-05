import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

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
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const familyId = searchParams.get("family_id");

  if (!familyId) {
    return NextResponse.json(
      { error: "family_id is required" },
      { status: 400 }
    );
  }

  // Get Immich settings from Supabase
  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // Fetch albums from Immich API
    const response = await fetch(`${immichSettings.url}/api/albums`, {
      headers: {
        "x-api-key": immichSettings.api_key,
        "Accept": "application/json",
      },
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
