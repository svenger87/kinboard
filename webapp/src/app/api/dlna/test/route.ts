import { NextRequest, NextResponse } from "next/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { describeServer } from "@/lib/dlna-client";

/**
 * Check a DLNA description URL and report what is behind it.
 *
 * The settings page calls this before saving, so an owner learns "that is a
 * printer, not a media server" while they still have the field open rather
 * than from an empty screensaver three hours later.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    family_id?: string;
    description_url?: string;
  };
  const familyId = body.family_id;
  const descriptionUrl = body.description_url?.trim();

  if (!familyId || !descriptionUrl) {
    return NextResponse.json(
      { error: "family_id and description_url are required" },
      { status: 400 },
    );
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  try {
    const server = await describeServer(descriptionUrl);
    return NextResponse.json({ ok: true, ...server });
  } catch (e) {
    // The message is the useful half — "no ContentDirectory service" and
    // "returned 404" send an owner to different places.
    const message = e instanceof Error ? e.message : "unreachable";
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
