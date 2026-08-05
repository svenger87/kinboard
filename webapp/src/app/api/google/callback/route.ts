import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createAdminClient } from "@/lib/supabase/server";
import { splitSecrets, upsertSecrets } from "@/lib/integration-secrets";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/google/callback";

// GET: Handle OAuth callback from Google
//
// `state` is base64 JSON the caller composed on the way out, not something
// Google vouches for, so the family named in it is the caller's word. Google
// returns here as a top-level navigation, which carries the session cookie —
// so the family the tokens get written against is checked against the device
// that is actually signed in, not against whatever came back in the URL.
//
// Failures redirect rather than returning JSON: this is a page navigation,
// and the settings screen turns ?error= into a toast.
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return NextResponse.redirect(
      new URL("/settings/google?error=not_authenticated", request.url)
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // Handle OAuth errors
  if (error) {
    console.error("Google OAuth error:", error);
    return NextResponse.redirect(
      new URL(`/settings/google?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/settings/google?error=missing_params", request.url)
    );
  }

  // Decode state to get family_id
  let familyId: string;
  try {
    const stateData = JSON.parse(Buffer.from(state, "base64").toString());
    familyId = stateData.family_id;
  } catch {
    return NextResponse.redirect(
      new URL("/settings/google?error=invalid_state", request.url)
    );
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.redirect(
      new URL("/settings/google?error=not_authenticated", request.url)
    );
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(
      new URL("/settings/google?error=not_configured", request.url)
    );
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token) {
      throw new Error("No access token received");
    }

    // Set credentials with token_type
    oauth2Client.setCredentials({
      ...tokens,
      token_type: tokens.token_type || "Bearer",
    });

    // Try to get user info (optional - don't fail if it doesn't work)
    let userEmail: string | undefined;
    try {
      const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
      const { data: userInfo } = await oauth2.userinfo.get();
      userEmail = userInfo.email || undefined;
    } catch (userInfoError) {
      console.warn("Could not fetch user info:", userInfoError);
      // Continue without email - not critical
    }

    // Store tokens in Supabase settings
    const supabase = createAdminClient();

    const googleSettings = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      token_type: tokens.token_type || "Bearer",
      email: userEmail,
      connected_at: new Date().toISOString(),
    };

    // Split tokens into the secrets table; everything else stays in settings.
    const { publicValue, secretValue } = splitSecrets("google_calendar", googleSettings);

    try {
      if (secretValue) {
        await upsertSecrets(familyId, "google_calendar", secretValue);
      }
    } catch (secretsError) {
      console.error("Error saving Google secrets:", secretsError);
      return NextResponse.redirect(
        new URL("/settings/google?error=save_failed", request.url)
      );
    }

    // Upsert the google_calendar setting - use type assertion to bypass strict typing

    const { error: upsertError } = await (supabase as any)
      .from("settings")
      .upsert(
        {
          family_id: familyId,
          key: "google_calendar",
          value: publicValue,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "family_id,key",
        }
      );

    if (upsertError) {
      console.error("Error saving Google credentials:", upsertError);
      return NextResponse.redirect(
        new URL("/settings/google?error=save_failed", request.url)
      );
    }

    // Success - redirect back to settings
    return NextResponse.redirect(
      new URL("/settings/google?success=true", request.url)
    );
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    return NextResponse.redirect(
      new URL("/settings/google?error=token_exchange_failed", request.url)
    );
  }
}
