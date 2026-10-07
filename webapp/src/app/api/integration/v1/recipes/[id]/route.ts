import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import { publicOrigin } from "@/lib/oauth/origin";
import { absoluteStorageUrl } from "@/lib/supabase/public-url";
import { getRecipe, isUuid, parseRecipeUpdate, updateRecipe } from "@/lib/integration-recipes";
import { destructiveLimitResponse } from "@/lib/integration-limits";
import {
  findStoredResult, fingerprintRequest, storeResult, validateIdempotencyKey,
} from "@/lib/integration-idempotency";

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
      // Stored image paths are relative (RFC-018 §4); see recipes/route.ts.
      const origin = publicOrigin(request.headers, request.nextUrl.origin);
      return NextResponse.json({ recipe: { ...recipe, image_url: absoluteStorageUrl(recipe.image_url, origin) } });
    } catch (err) {
      await logApiError("integration/recipes/read", err);
      return NextResponse.json({ error: "Could not read the recipe", code: "internal_error" }, { status: 500 });
    }
  });
}

/**
 * PATCH /api/integration/v1/recipes/{id}
 *
 * Change a saved recipe (lib/integration-recipes.ts): `title`,
 * `description`, `servings`, `prep_time_minutes`, `cook_time_minutes`,
 * `tags`, `ingredients` and `instructions`, checked as on create. Only the
 * fields sent change; `ingredients`, `instructions` and `tags` replace the
 * whole list. All or nothing. `meals:write`, the scope that saves recipes.
 *
 * An Idempotency-Key is required, unlike the other PATCH routes: replacing
 * the ingredients gives them new ids, so a retried change is not harmless
 * -- it would hand out a second set of ids and leave the first answer's
 * ids pointing at nothing. The key replays the first answer instead. The
 * edit counts against the token's limit on edits and deletes.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withIntegrationAuth(request, "meals:write", async (context) => {
    const limited = destructiveLimitResponse(context);
    if (limited) return limited;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "no such recipe", code: "not_found" }, { status: 404 });
    }
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

    const parsed = parseRecipeUpdate(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error, code: "invalid_request" }, { status: 400 });
    }

    const hash = fingerprintRequest(`recipes.update:${id}`, body);
    const previous = await findStoredResult(context.familyId, key.key);
    if (previous) {
      if (previous.request_hash !== hash) {
        return NextResponse.json({ error: "Idempotency-Key reused with different arguments", code: "conflict" }, { status: 409 });
      }
      return NextResponse.json(previous.response, { status: previous.status, headers: { "idempotent-replay": "true" } });
    }

    try {
      const recipe = await updateRecipe(context.familyId, id, parsed.value);
      if (!recipe) {
        return NextResponse.json({ error: "no such recipe", code: "not_found" }, { status: 404 });
      }
      const origin = publicOrigin(request.headers, request.nextUrl.origin);
      const response = { recipe: { ...recipe, image_url: absoluteStorageUrl(recipe.image_url, origin) } };
      await storeResult({
        familyId: context.familyId, key: key.key, service: "recipes.update",
        requestHash: hash, status: 200, response,
      });
      return NextResponse.json(response);
    } catch (err) {
      await logApiError("integration/recipes/update", err);
      return NextResponse.json({ error: "Could not change the recipe", code: "internal_error" }, { status: 500 });
    }
  });
}
