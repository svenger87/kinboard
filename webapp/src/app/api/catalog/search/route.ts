import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { searchCatalog } from "@/lib/catalog-search";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

// A session is required even though family_id is optional here: the private
// half of the catalog is the family's own item list, and the public half fans
// out to Open Food Facts and Bring! on every miss. Where family_id is given it
// has to be the session's, or the "family-specific" rows in the answer would
// be someone else's shopping habits.
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");
  const familyId = searchParams.get("family_id");
  const limit = parseInt(searchParams.get("limit") || "20", 10);
  // "Adopt Bring! categories" — off means classify by our own keywords
  // instead of by the section the item sits in on Bring!.
  const useBringCategories = searchParams.get("bring_categories") !== "0";

  if (!query || query.length < 2) {
    return NextResponse.json(
      { error: "Query must be at least 2 characters" },
      { status: 400 }
    );
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { results, total } = await searchCatalog({ query, familyId, limit, useBringCategories });

  return NextResponse.json({
    results,
    total,
    query,
  });
}

// Save an item from Open Food Facts to local catalog
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const { family_id, name, barcode, image_url, thumbnail_url, category, source } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (!familyMatchesSession(auth.session, family_id)) {
      return NextResponse.json({ error: "not authenticated" }, { status: 401 });
    }

    const supabase = await createAdminClient();
     
    const supabaseAny = supabase as any;

    // Check if item already exists
    const normalizedName = name.toLowerCase().trim();
    const { data: existing } = await supabaseAny
      .from("item_catalog")
      .select("id, popularity")
      .eq("name_normalized", normalizedName)
      .or(`family_id.eq.${family_id},family_id.is.null`)
      .single();

    if (existing) {
      // Update existing item with new data (category, image, etc.) and increment popularity
      const updateData: Record<string, unknown> = {
        popularity: (existing.popularity || 0) + 1,
      };

      // Only update fields that were provided
      if (category !== undefined) updateData.category = category;
      if (image_url !== undefined) updateData.image_url = image_url;
      if (thumbnail_url !== undefined) updateData.thumbnail_url = thumbnail_url;
      if (barcode !== undefined) updateData.barcode = barcode;

      await supabaseAny
        .from("item_catalog")
        .update(updateData)
        .eq("id", existing.id);

      return NextResponse.json({ id: existing.id, created: false, updated: true });
    }

    // Create new catalog item
    const { data: newItem, error } = await supabaseAny
      .from("item_catalog")
      .insert({
        family_id: family_id || null,
        name,
        name_normalized: normalizedName,
        barcode: barcode || null,
        image_url: image_url || null,
        thumbnail_url: thumbnail_url || null,
        category: category || null,
        source: source || "custom",
        popularity: 1,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating catalog item:", error);
      return NextResponse.json(
        { error: "Failed to create catalog item" },
        { status: 500 }
      );
    }

    return NextResponse.json({ id: newItem.id, created: true });
  } catch (error) {
    console.error("Error in POST /api/catalog/search:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
