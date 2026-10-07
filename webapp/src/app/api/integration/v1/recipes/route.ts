import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import { publicOrigin } from "@/lib/oauth/origin";
import { absoluteStorageUrl } from "@/lib/supabase/public-url";
import { createRecipe, parseRecipeCreate, parseRecipeSearch, searchRecipes } from "@/lib/integration-recipes";
import { familyContentLanguage } from "@/lib/family-language";
import {
  findStoredResult, fingerprintRequest, storeResult, validateIdempotencyKey,
} from "@/lib/integration-idempotency";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/recipes?query=&tag=&limit=
 *
 * The family's own recipes, never binned ones (RFC-012). `query` matches the
 * title or a tag name, `tag` a whole tag name; at most 50 results. External
 * recipe search is deliberately not offered to assistants.
 *
 * `language` is the family's language (lib/family-language.ts): the saved
 * one, else the holiday region's. An assistant searching before it saves a
 * new recipe learns from it which language to write that recipe in.
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    const search = parseRecipeSearch(new URL(request.url).searchParams);
    if (!search.ok) {
      return NextResponse.json({ error: search.error, code: "invalid_request" }, { status: 400 });
    }
    try {
      const [recipes, language] = await Promise.all([
        searchRecipes(context.familyId, search.value),
        // A hint, not the answer: a search never fails for want of it.
        familyContentLanguage(context.familyId).catch(() => null),
      ]);
      // Stored image paths are relative (RFC-018 §4); a caller with no page to
      // resolve them against gets the address it reached us on.
      const origin = publicOrigin(request.headers, request.nextUrl.origin);
      return NextResponse.json({
        language,
        recipes: recipes.map((r) => ({ ...r, image_url: absoluteStorageUrl(r.image_url, origin) })),
      });
    } catch (err) {
      await logApiError("integration/recipes/search", err);
      return NextResponse.json({ error: "Could not read the recipes", code: "internal_error" }, { status: 500 });
    }
  });
}

/**
 * POST /api/integration/v1/recipes
 *
 * Save a recipe to the family's collection, as the recipe page's "new
 * recipe" does (lib/integration-recipes.ts): `title`, optional `description`,
 * `servings` (default 4), `prep_time_minutes`, `cook_time_minutes`, `tags`,
 * `ingredients` (each `name`, optional `quantity`, `unit`, `group`, `notes`)
 * and `instructions` as ordered steps. No picture. `meals:write`: saving a
 * recipe is planning food, the same risk as adding a meal, and a new scope
 * would make every assistant connect again. A create, so an Idempotency-Key
 * is required: a retried "save that recipe" must not save it twice.
 */
export async function POST(request: NextRequest) {
  return withIntegrationAuth(request, "meals:write", async (context) => {
    const key = validateIdempotencyKey(request.headers.get("idempotency-key"));
    if (!key.ok) {
      return NextResponse.json({ error: "An Idempotency-Key is required", code: "invalid_request" }, { status: 400 });
    }

    let body: Record<string, unknown>;
    try {
      const raw: unknown = await request.json();
      body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    } catch {
      body = {};
    }

    // Refused before anything is looked up or written; a 400 is not
    // remembered against the key.
    const parsed = parseRecipeCreate(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error, code: "invalid_request" }, { status: 400 });
    }

    const hash = fingerprintRequest("recipes.create", body);
    const previous = await findStoredResult(context.familyId, key.key);
    if (previous) {
      if (previous.request_hash !== hash) {
        return NextResponse.json({ error: "Idempotency-Key reused with different arguments", code: "conflict" }, { status: 409 });
      }
      return NextResponse.json(previous.response, { status: previous.status, headers: { "idempotent-replay": "true" } });
    }

    try {
      const recipe = await createRecipe(context.familyId, parsed.value);
      const response = { recipe };
      await storeResult({
        familyId: context.familyId, key: key.key, service: "recipes.create",
        requestHash: hash, status: 201, response,
      });
      return NextResponse.json(response, { status: 201 });
    } catch (err) {
      await logApiError("integration/recipes/create", err);
      return NextResponse.json({ error: "Could not save the recipe", code: "internal_error" }, { status: 500 });
    }
  });
}
