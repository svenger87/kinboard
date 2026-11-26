import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { googleRedirectUri } from "@/lib/google-redirect";
import { resolveGoogleClient } from "@/lib/api-keys";


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

  // The family's own OAuth client from Settings, else the server's
  // (lib/api-keys.ts). The session's family: a family_id that names another
  // is refused below anyway.
  const client = await resolveGoogleClient(auth.session.familyId);
  if (!client) {
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
    client.clientId,
    client.clientSecret,
    // The same address both ways: Google refuses the token exchange otherwise.
    googleRedirectUri(request.headers, request.nextUrl.origin),
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
