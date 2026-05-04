import { NextRequest, NextResponse } from "next/server";

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

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password required" },
        { status: 400 }
      );
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
          { error: "Ungültige Anmeldedaten" },
          { status: 401 }
        );
      }
      throw new Error(`Bring auth failed: ${response.status}`);
    }

    const data: BringAuthResponse = await response.json();

    // Return sanitized auth data
    return NextResponse.json({
      uuid: data.uuid,
      email: data.email,
      name: data.name,
      defaultListId: data.bringListUUID,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    });
  } catch (error) {
    console.error("Bring auth error:", error);
    return NextResponse.json(
      { error: "Authentifizierung fehlgeschlagen" },
      { status: 500 }
    );
  }
}
