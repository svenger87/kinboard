import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/google/callback";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

// GET: Start OAuth flow - redirect to Google
//
// The family_id here is carried through Google and comes back in `state`,
// where the callback uses it to decide whose account the tokens belong to.
// Anyone could therefore start a flow naming someone else's family and, with
// their own Google consent, attach their calendar to that household. It's a
// top-level navigation from a signed-in device, so the session cookie is
// present (SameSite=Lax sends it on GET navigations) and can be checked.
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    // The settings page renders ?error= codes as a toast; a JSON 500 on a
    // full-page navigation would strand the user on a raw error body.
    return NextResponse.redirect(
      new URL("/settings/google?error=not_configured", request.url)
    );
  }

  // Get family_id from query params to pass through OAuth state
  const searchParams = request.nextUrl.searchParams;
  const familyId = searchParams.get("family_id");

  if (!familyId) {
    return NextResponse.json(
      { error: "family_id is required" },
      { status: 400 }
    );
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );

  // Create state with family_id for callback
  const state = Buffer.from(JSON.stringify({ family_id: familyId })).toString("base64");

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    state,
    prompt: "consent", // Force consent to get refresh token
  });

  return NextResponse.redirect(authUrl);
}
