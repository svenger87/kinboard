import { NextRequest, NextResponse } from "next/server";
import { googleAcceptsRedirect, googleRedirectUri } from "@/lib/google-redirect";

// Minimal probe so the Google settings page can detect when the
// self-hoster hasn't filled in GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
// yet — without exposing the actual values to the browser. Returns
// HTTP 200 either way (degrade-gracefully convention from CLAUDE.md).
//
// It also says which redirect URI this screen would ask Google for, so the
// page can show the exact address to register in Cloud Console, and whether
// Google takes it at all (lib/google-redirect.ts). Nothing secret: it is the
// address the browser is already on, or the one the operator configured.
export async function GET(request: NextRequest) {
  const redirectUri = googleRedirectUri(request.headers, request.nextUrl.origin);
  return NextResponse.json({
    configured: Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
    ),
    redirectUri,
    redirectFixed: Boolean(process.env.GOOGLE_REDIRECT_URI?.trim()),
    redirectAccepted: googleAcceptsRedirect(redirectUri),
  });
}
