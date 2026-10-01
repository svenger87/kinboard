import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-route";
import { logApiError } from "@/lib/api-error";
import { listPocketMoney } from "@/lib/integration-pocket-money";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/v1/pocket-money
 *
 * Every child's pocket-money account (people in the recycle bin left out):
 * balance, currency, lifetime savings, allowance and the active saving goals
 * with their progress — in currency units (lib/integration-pocket-money.ts).
 */
export async function GET(request: NextRequest) {
  return withIntegrationAuth(request, "family:read", async (context) => {
    try {
      return NextResponse.json({ accounts: await listPocketMoney(context.familyId) });
    } catch (err) {
      await logApiError("integration/pocket-money/list", err);
      return NextResponse.json({ error: "Could not read pocket money", code: "internal_error" }, { status: 500 });
    }
  });
}
