import { NextRequest, NextResponse } from "next/server";
import { getMergedSetting } from "@/lib/integration-secrets";

export const dynamic = "force-dynamic";

// Server-side merged shape: unlike the client's BringCredentials, this
// includes the real tokens (re-injected by getMergedSetting from
// integration_secrets — never sent to the browser).
interface BringSettings {
  credentials: {
    uuid: string;
    accessToken: string;
    refreshToken: string;
  } | null;
}

const BRING_API_URL = "https://api.getbring.com/rest/v2";
const BRING_API_KEY = "cof4Nc6D8saplXjE3h3HXqHH8m7VU2i1Gs0g85Sp";

interface BringList {
  listUuid: string;
  name: string;
  theme: string;
}

interface BringListsResponse {
  lists: BringList[];
}

export async function GET(request: NextRequest) {
  try {
    const familyId = request.nextUrl.searchParams.get("family_id");
    if (!familyId) {
      return NextResponse.json(
        { error: "family_id is required" },
        { status: 400 }
      );
    }
    const settings = await getMergedSetting<BringSettings>(familyId, "bring_settings");
    const credentials = settings?.credentials;
    if (!credentials?.accessToken) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    const authHeader = `Bearer ${credentials.accessToken}`;
    const uuid = credentials.uuid;

    // Fetch user's lists
    const response = await fetch(`${BRING_API_URL}/bringusers/${uuid}/lists`, {
      headers: {
        Authorization: authHeader,
        "X-BRING-API-KEY": BRING_API_KEY,
        "X-BRING-CLIENT": "webApp",
        "X-BRING-CLIENT-SOURCE": "webApp",
        "X-BRING-COUNTRY": "DE",
        "X-BRING-USER-UUID": uuid,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return NextResponse.json(
          { error: "Token expired" },
          { status: 401 }
        );
      }
      throw new Error(`Failed to fetch lists: ${response.status}`);
    }

    const data: BringListsResponse = await response.json();

    // Transform to simpler format
    const lists = data.lists.map((list) => ({
      id: list.listUuid,
      name: list.name,
      theme: list.theme,
    }));

    return NextResponse.json(lists);
  } catch (error) {
    console.error("Bring lists error:", error);
    return NextResponse.json(
      { error: "Failed to fetch lists" },
      { status: 500 }
    );
  }
}
