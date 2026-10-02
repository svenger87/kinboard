import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { logApiError } from "@/lib/api-error";
import { hitLimit } from "@/lib/rate-limit";
import { hasOpenHolidays, resolveRegion } from "@/lib/holidays/region";
import { liveSchoolSyncDeps } from "@/lib/school-sync/live";
import { schoolRegionOptions } from "@/lib/school-sync/options";
import { topLevel } from "@/lib/school-sync/school-region";
import { SyncError } from "@/lib/school-sync/openholidays";

export const dynamic = "force-dynamic";

const CODE = /^[A-Z]{2}(-[\p{Lu}\p{N}]{1,8}){1,3}$/u;

/** The school regions and groups the family's country offers (RFC-014 §5.3). */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const familyId = auth.session.familyId;

  const deps = liveSchoolSyncDeps();
  if (!deps.installEnabled) {
    return NextResponse.json({ error: "the school-holiday sync is off on this install", code: "sync_off" }, { status: 403 });
  }
  const limit = hitLimit(`school-options:${familyId}`, 20, 60_000);
  if (limit.limited) {
    return NextResponse.json(
      { error: "too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }
  const subdivision = request.nextUrl.searchParams.get("subdivision");
  if (subdivision !== null && !CODE.test(subdivision)) {
    return NextResponse.json({ error: "invalid subdivision", code: "invalid_request" }, { status: 400 });
  }

  try {
    const holiday = await deps.store.holidayRegion(familyId);
    const country = holiday?.code ? (resolveRegion(holiday.code)?.country ?? null) : null;
    if (!country || !hasOpenHolidays(country)) {
      return NextResponse.json({ error: "not covered", code: "not_covered" }, { status: 409 });
    }
    const language = await deps.store.language(familyId);
    return NextResponse.json(await schoolRegionOptions(country, subdivision ? topLevel(subdivision) : null, language, deps));
  } catch (err) {
    if (err instanceof SyncError) {
      return NextResponse.json({ error: err.message, code: "openholidays_unreachable" }, { status: 502 });
    }
    await logApiError("school-holidays/options", err);
    return NextResponse.json({ error: "could not load the options" }, { status: 500 });
  }
}
