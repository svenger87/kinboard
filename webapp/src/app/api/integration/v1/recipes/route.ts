import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import { publicOrigin } from "@/lib/oauth/origin";
import { absoluteStorageUrl } from "@/lib/supabase/public-url";
import { parseRecipeSearch, searchRecipes } from "@/lib/integration-recipes";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/recipes?query=&tag=&limit=
 *
 * The family's own recipes, never binned ones (RFC-012). `query` matches the
 * title or a tag name, `tag` a whole tag name; at most 50 results. External
 * recipe search is deliberately not offered to assistants.
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    const search = parseRecipeSearch(new URL(request.url).searchParams);
    if (!search.ok) {
      return NextResponse.json({ error: search.error, code: "invalid_request" }, { status: 400 });
    }
    try {
      const recipes = await searchRecipes(context.familyId, search.value);
      // Stored image paths are relative (RFC-018 §4); a caller with no page to
      // resolve them against gets the address it reached us on.
      const origin = publicOrigin(request.headers, request.nextUrl.origin);
      return NextResponse.json({
        recipes: recipes.map((r) => ({ ...r, image_url: absoluteStorageUrl(r.image_url, origin) })),
      });
    } catch (err) {
      await logApiError("integration/recipes/search", err);
      return NextResponse.json({ error: "Could not read the recipes", code: "internal_error" }, { status: 500 });
    }
  });
}
