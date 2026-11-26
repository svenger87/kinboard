import { NextRequest, NextResponse } from "next/server";
import { googleAcceptsRedirect, googleRedirectUri } from "@/lib/google-redirect";
import { requireSession } from "@/lib/require-session";
import { resolveGoogleClient } from "@/lib/api-keys";
import { pickCredential } from "@/lib/api-key-status";

// Minimal probe so the Google settings page can detect when neither the
// family (Settings -> Google Calendar) nor the self-hoster (GOOGLE_CLIENT_ID /
// GOOGLE_CLIENT_SECRET) has set an OAuth client yet — without exposing the
// actual values to the browser. Returns HTTP 200 either way
// (degrade-gracefully convention from CLAUDE.md).
//
// It also says which redirect URI this screen would ask Google for, so the
// page can show the exact address to register in Cloud Console, and whether
// Google takes it at all (lib/google-redirect.ts). Nothing secret: it is the
// address the browser is already on, or the one the operator configured.
//
// Without a session it answers for the server's environment alone, as it
// did before a family could set its own client.
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  const configured = auth.ok
    ? (await resolveGoogleClient(auth.session.familyId)) !== null
    : pickCredential("google_oauth_client", null, process.env).source !== "none";
  const redirectUri = googleRedirectUri(request.headers, request.nextUrl.origin);
  return NextResponse.json({
    configured,
    redirectUri,
    redirectFixed: Boolean(process.env.GOOGLE_REDIRECT_URI?.trim()),
    redirectAccepted: googleAcceptsRedirect(redirectUri),
  });
}
