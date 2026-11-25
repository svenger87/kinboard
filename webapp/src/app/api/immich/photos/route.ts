import { NextRequest, NextResponse } from "next/server";
import { getMergedSetting } from "@/lib/integration-secrets";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { readImmichAlbumAssets, type ImmichAsset } from "@/lib/immich/album-assets";

interface ImmichSettings {
  url: string;
  api_key: string;
  selected_album?: string;
}

// GET: Fetch photos from Immich
// Proxies the family's own Immich server using the API key stored for them,
// so the family id in the query decided whose photo library got read.
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const searchParams = request.nextUrl.searchParams;
  const familyId = searchParams.get("family_id");
  const albumId = searchParams.get("album_id");
  const albumIds = searchParams.get("album_ids"); // Comma-separated list of album IDs
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam) : 0; // 0 = no limit
  const random = searchParams.get("random") === "true";

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

  const targetAlbumId = albumId || immichSettings.selected_album;
  const targetAlbumIds = albumIds ? albumIds.split(",") : (targetAlbumId ? [targetAlbumId] : []);

  try {
    let assets: ImmichAsset[] = [];

    if (targetAlbumIds.length > 0) {
      // Only ever the albums asked for: see lib/immich/album-assets.ts for
      // how each Immich version is read, and why an unreadable album gives
      // no photos rather than the whole library (#536).
      const albumPromises = targetAlbumIds.map((id) =>
        readImmichAlbumAssets(immichSettings.url, immichSettings.api_key, id),
      );

      const albumResults = await Promise.all(albumPromises);
      assets = albumResults.flat();
      console.log(`Total assets from all albums: ${assets.length}`);
    } else {
      // Fetch random photos using search
      const response = await fetch(
        `${immichSettings.url}/api/search/random?count=${limit}`,
        {
          headers: {
            "x-api-key": immichSettings.api_key,
            "Accept": "application/json",
          },
          signal: AbortSignal.timeout(20_000),
        }
      );

      if (!response.ok) {
        console.error("Immich random search error:", response.status);
        return NextResponse.json(
          { error: "Failed to fetch random photos from Immich" },
          { status: response.status }
        );
      }

      assets = await response.json();
    }

    // Filter to only images
    const beforeFilter = assets.length;
    assets = assets.filter((asset) => asset.type === "IMAGE");
    console.log(`Filtered ${beforeFilter} -> ${assets.length} (removed ${beforeFilter - assets.length} non-images)`);

    // Shuffle if random requested
    if (random) {
      assets = assets.sort(() => Math.random() - 0.5);
    }

    // Limit results only if limit is specified
    if (limit > 0) {
      assets = assets.slice(0, limit);
    }

    // Build photo URLs (using proxy to handle authentication)
    const photos = assets.map((asset) => ({
      id: asset.id,
      url: `/api/immich/image?family_id=${familyId}&asset_id=${asset.id}&size=preview`,
      originalUrl: `/api/immich/image?family_id=${familyId}&asset_id=${asset.id}&size=original`,
      fileName: asset.originalFileName,
      date: asset.localDateTime,
      isFavorite: asset.isFavorite,
    }));

    return NextResponse.json({ photos });
  } catch (err) {
    console.error("Error fetching Immich photos:", err);
    return NextResponse.json(
      { error: "Failed to connect to Immich" },
      { status: 500 }
    );
  }
}
