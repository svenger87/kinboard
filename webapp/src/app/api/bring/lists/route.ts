import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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
    const authHeader = request.headers.get("authorization");
    const uuid = request.headers.get("x-bring-uuid");

    if (!authHeader || !uuid) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

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
