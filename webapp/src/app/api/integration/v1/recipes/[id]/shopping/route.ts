import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import {
  findStoredResult, fingerprintRequest, storeResult, validateIdempotencyKey,
} from "@/lib/integration-idempotency";
import { addRecipeToShoppingList, isUuid, parseRecipeShoppingInput } from "@/lib/integration-recipes";

export const dynamic = "force-dynamic";

/**
 * POST /api/integration/v1/recipes/{id}/shopping
 *
 * Put a recipe's ingredients — all, or the `ingredient_ids` chosen — on the
 * shopping list, scaled to `servings`, as the recipe page's "add to shopping
 * list" does (lib/integration-recipes.ts). Each item is also put on Bring!
 * when two-way sync is on; Bring! or the catalogue failing never fails the
 * add. A create, so an Idempotency-Key is required: a retried call must not
 * put the whole recipe on the list twice.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withIntegrationAuth(request, "shopping:write", async (context) => {
    const key = validateIdempotencyKey(request.headers.get("idempotency-key"));
    if (!key.ok) {
      return NextResponse.json({ error: "An Idempotency-Key is required", code: "invalid_request" }, { status: 400 });
    }
    if (!isUuid(id)) {
      return NextResponse.json({ error: "no such recipe", code: "not_found" }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown> : {};
    } catch {
      body = {};
    }

    const input = parseRecipeShoppingInput(body);
    if (!input.ok) {
      return NextResponse.json({ error: input.error, code: "invalid_request" }, { status: 400 });
    }

    const hash = fingerprintRequest("recipes.shopping", { recipe_id: id.toLowerCase(), ...body });
    const previous = await findStoredResult(context.familyId, key.key);
    if (previous) {
      if (previous.request_hash !== hash) {
        return NextResponse.json({ error: "Idempotency-Key reused with different arguments", code: "conflict" }, { status: 409 });
      }
      return NextResponse.json(previous.response, { status: previous.status, headers: { "idempotent-replay": "true" } });
    }

    try {
      const result = await addRecipeToShoppingList(context.familyId, id, input.value);
      if (!result) {
        return NextResponse.json({ error: "no such recipe", code: "not_found" }, { status: 404 });
      }
      if ("error" in result) {
        return NextResponse.json(
          { error: `these ingredient ids are not in this recipe: ${result.ids.join(", ")}`, code: "invalid_request" },
          { status: 400 },
        );
      }

      const response = { added: result.added };
      await storeResult({ familyId: context.familyId, key: key.key, service: "recipes.shopping", requestHash: hash, status: 201, response });
      return NextResponse.json(response, { status: 201 });
    } catch (err) {
      await logApiError("integration/recipes/shopping", err);
      return NextResponse.json({ error: "Could not add the ingredients", code: "internal_error" }, { status: 500 });
    }
  });
}
