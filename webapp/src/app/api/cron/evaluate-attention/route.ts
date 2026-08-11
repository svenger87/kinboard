import { NextRequest, NextResponse } from "next/server";
import { runAttentionForAllFamilies } from "@/lib/attention/runner";
import { recordHeartbeat } from "@/lib/heartbeat";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * POST /api/cron/evaluate-attention
 *
 * Runs the Heute-Motor for every family and reconciles what it says with what
 * is stored.
 *
 * Every five minutes, not every minute. The rules that matter to a minute —
 * "leave in 30 minutes" — cross their threshold once and stay true for the
 * whole window afterwards, so a finer interval would buy a more precise
 * countdown and nothing else. Coarser than five would let a morning reminder
 * arrive after the school run.
 *
 * Server-side and behind the cron secret because the evaluator decides what a
 * household is told. An endpoint a browser could call is one a child could
 * call, repeatedly, until the board said something different.
 */
export async function POST(request: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await recordHeartbeat();

  try {
    const results = await runAttentionForAllFamilies();
    const total = results.reduce(
      (acc, r) => ({
        raised: acc.raised + r.raised,
        resolved: acc.resolved + r.resolved,
        unsnoozed: acc.unsnoozed + r.unsnoozed,
        suppressed: acc.suppressed + r.suppressed,
        active: acc.active + r.active,
      }),
      { raised: 0, resolved: 0, unsnoozed: 0, suppressed: 0, active: 0 }
    );
    return NextResponse.json({ families: results.length, ...total });
  } catch (err) {
    // Reported rather than swallowed: unlike a missed notification, a board
    // that has silently stopped thinking looks exactly like a quiet day.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "evaluation failed" },
      { status: 500 }
    );
  }
}
