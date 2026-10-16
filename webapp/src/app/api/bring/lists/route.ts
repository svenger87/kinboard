import { NextRequest, NextResponse } from "next/server";
import { getMergedSetting } from "@/lib/integration-secrets";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { BRING_API_URL, BRING_HEADERS, BringAuthError, withBringAccess } from "@/lib/bring-server";

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

interface BringList {
  listUuid: string;
  name: string;
  theme: string;
}

interface BringListsResponse {
  lists: BringList[];
}

// Talks to Bring! as the family, with the account credentials stored for them.
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  try {
    const familyId = request.nextUrl.searchParams.get("family_id");
    if (!familyId) {
      return NextResponse.json(
        { error: "family_id is required" },
        { status: 400 }
      );
    }

    if (!familyMatchesSession(auth.session, familyId)) {
      return NextResponse.json({ error: "not authenticated" }, { status: 401 });
    }

    const settings = await getMergedSetting<BringSettings>(familyId, "bring_settings");
    const credentials = settings?.credentials;
    if (!credentials?.accessToken) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    const uuid = credentials.uuid;

    // Fetch user's lists, with the token renewed once if Bring! has expired it
    const response = await withBringAccess(familyId, settings, async (accessToken) => {
      const res = await fetch(`${BRING_API_URL}/bringusers/${uuid}/lists`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...BRING_HEADERS,
          "X-BRING-USER-UUID": uuid,
        },
      });
      if (res.status === 401) throw new BringAuthError();
      return res;
    });

    if (!response.ok) {
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
    if (error instanceof BringAuthError) {
      return NextResponse.json({ error: "Token expired" }, { status: 401 });
    }
    console.error("Bring lists error:", error);
    return NextResponse.json(
      { error: "Failed to fetch lists" },
      { status: 500 }
    );
  }
}
