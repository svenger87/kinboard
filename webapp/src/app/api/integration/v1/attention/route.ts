import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import { listAttentionItems } from "@/lib/integration-attention";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/attention
 *
 * The Heute-Motor's hints the attention widget shows right now, most
 * important first, each with the `item_key` that
 * `POST /services/dismiss_attention` takes and its title in the family's
 * language (lib/integration-attention.ts). A hint built from Home Assistant
 * (an open door at bedtime) is shown with its count only, no entity names,
 * unless the token also holds `home:read`.
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    try {
      // Hints built from Home Assistant name the household's entities; only
      // a token that may read the home sees them in full.
      return NextResponse.json(await listAttentionItems(context.familyId, context.scopes.includes("home:read")));
    } catch (err) {
      await logApiError("integration/attention/list", err);
      return NextResponse.json({ error: "Could not read the attention items", code: "internal_error" }, { status: 500 });
    }
  });
}
