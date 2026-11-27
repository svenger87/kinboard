import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db/server";
import { extendAllSeries } from "@/lib/event-series";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Daily: every repeating event due a top-up gets its next occurrences, so a
 * series with no end always reaches close to its horizon (about four months
 * for a daily one, thirteen for weekly, three years monthly, ten yearly); each
 * is due about once a month. Safe to run again, and beside an edit: it starts
 * after the last day already made, skips a series written since it read it,
 * and one series failing does not stop the rest (they are counted in the
 * response).
 */
export async function POST(request: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await extendAllSeries(createAdminClient(), new Date());
    return NextResponse.json(result);
  } catch (error) {
    console.error("extend-event-series failed", error);
    return NextResponse.json({ error: "could not extend repeating events" }, { status: 500 });
  }
}
