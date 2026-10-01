import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import { getRecipe, isUuid } from "@/lib/integration-recipes";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/recipes/{id}
 *
 * One recipe with its ingredients (with the ids `POST .../shopping` takes)
 * and its instructions as plain steps. Another family's recipe and a binned
 * one are both simply not found.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withIntegrationAuth(request, "family:read", async (context) => {
    if (!isUuid(id)) {
      return NextResponse.json({ error: "no such recipe", code: "not_found" }, { status: 404 });
    }
    try {
      const recipe = await getRecipe(context.familyId, id);
      if (!recipe) {
        return NextResponse.json({ error: "no such recipe", code: "not_found" }, { status: 404 });
      }
      return NextResponse.json({ recipe });
    } catch (err) {
      await logApiError("integration/recipes/read", err);
      return NextResponse.json({ error: "Could not read the recipe", code: "internal_error" }, { status: 500 });
    }
  });
}
