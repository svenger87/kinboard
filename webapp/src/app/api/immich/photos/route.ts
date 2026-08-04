import { NextRequest, NextResponse } from "next/server";
import { getMergedSetting } from "@/lib/integration-secrets";

interface ImmichSettings {
  url: string;
  api_key: string;
  selected_album?: string;
}

interface ImmichAsset {
  id: string;
  type: string;
  originalFileName: string;
  localDateTime: string;
  isFavorite: boolean;
}

// GET: Fetch photos from Immich
export async function GET(request: NextRequest) {
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
      // Fetch photos from albums using search/metadata for better pagination
      const albumPromises = targetAlbumIds.map(async (id) => {
        // First get album info to know total count
        const albumResponse = await fetch(
          `${immichSettings.url}/api/albums/${id}`,
          {
            headers: {
              "x-api-key": immichSettings.api_key,
              "Accept": "application/json",
            },
            signal: AbortSignal.timeout(20_000),
          }
        );

        if (!albumResponse.ok) {
          // Template literal — `${id}` is interpolated as a string value,
          // not used as a printf-style format specifier. No format-string
          // injection attack surface. (CodeQL #8 dismissed: false positive.)
          console.error(`Immich album fetch error for ${id}:`, albumResponse.status);
          return [];
        }

        const albumData = await albumResponse.json();
        console.log(`Album ${albumData.albumName}: assetCount=${albumData.assetCount}, assets returned=${albumData.assets?.length}`);

        // If album returns all assets, use them
        if (albumData.assets && albumData.assets.length >= (albumData.assetCount || 0)) {
          return albumData.assets;
        }

        // Otherwise try search/metadata endpoint with pagination
        console.log(`Trying search/metadata for album ${id}...`);
        const allAssets: ImmichAsset[] = [];
        let page = 1;
        const pageSize = 1000;

        while (true) {
          const searchResponse = await fetch(
            `${immichSettings.url}/api/search/metadata`,
            {
              method: "POST",
              headers: {
                "x-api-key": immichSettings.api_key,
                "Accept": "application/json",
                "Content-Type": "application/json",
              },
              signal: AbortSignal.timeout(20_000),
              body: JSON.stringify({
                albumId: id,
                page: page,
                size: pageSize,
              }),
            }
          );

          if (!searchResponse.ok) {
            console.error(`Search metadata error:`, searchResponse.status);
            // Fall back to album assets
            return albumData.assets || [];
          }

          const searchData = await searchResponse.json();
          const items = searchData.assets?.items || [];
          console.log(`Page ${page}: got ${items.length} assets`);

          if (items.length === 0) break;
          allAssets.push(...items);

          if (items.length < pageSize) break;
          page++;
        }

        console.log(`Total from search: ${allAssets.length} assets`);
        return allAssets.length > 0 ? allAssets : (albumData.assets || []);
      });

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
