import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import { listRewards } from "@/lib/integration-rewards";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/rewards
 *
 * Every child with a creature switched on (people in the recycle bin left
 * out): their points -- balance, earned, owed, pending, available -- and
 * their creature's species, stage (number and name in the family's language)
 * and the next stage's threshold. With the family's active rewards and the
 * requests waiting for a parent. Never the creature's look or the name the
 * child gave it (lib/integration-rewards.ts).
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    try {
      return NextResponse.json(await listRewards(context.familyId));
    } catch (err) {
      await logApiError("integration/rewards/list", err);
      return NextResponse.json({ error: "Could not read points and rewards", code: "internal_error" }, { status: 500 });
    }
  });
}
