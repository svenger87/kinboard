import { NextRequest, NextResponse } from "next/server";
import { upsertSecrets } from "@/lib/integration-secrets";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

const BRING_API_URL = "https://api.getbring.com/rest/v2";
const BRING_API_KEY = "cof4Nc6D8saplXjE3h3HXqHH8m7VU2i1Gs0g85Sp";

interface BringAuthResponse {
  uuid: string;
  publicUuid: string;
  email: string;
  name: string;
  photoPath: string;
  bringListUUID: string;
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

// Talks to Bring! as the family, with the account credentials stored for them.
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  try {
    const { email, password, family_id } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password required" },
        { status: 400 }
      );
    }

    if (!family_id) {
      return NextResponse.json(
        { error: "family_id is required" },
        { status: 400 }
      );
    }

    if (!familyMatchesSession(auth.session, family_id)) {
      return NextResponse.json({ error: "not authenticated" }, { status: 401 });
    }

    // Authenticate with Bring!
    const response = await fetch(`${BRING_API_URL}/bringauth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-BRING-API-KEY": BRING_API_KEY,
        "X-BRING-CLIENT": "webApp",
        "X-BRING-CLIENT-SOURCE": "webApp",
        "X-BRING-COUNTRY": "DE",
      },
      body: new URLSearchParams({
        email,
        password,
      }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        return NextResponse.json(
          { error: "Invalid credentials" },
          { status: 401 }
        );
      }
      throw new Error(`Bring auth failed: ${response.status}`);
    }

    const data: BringAuthResponse = await response.json();

    await upsertSecrets(family_id, "bring_settings", {
      credentials: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
      },
    });

    // Return sanitized auth data — tokens stay server-side.
    return NextResponse.json({
      uuid: data.uuid,
      email: data.email,
      name: data.name,
      defaultListId: data.bringListUUID,
      expiresIn: data.expires_in,
    });
  } catch (error) {
    console.error("Bring auth error:", error);
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 500 }
    );
  }
}
