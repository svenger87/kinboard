import { NextRequest, NextResponse } from "next/server";
import { getMergedSetting } from "@/lib/integration-secrets";

export const dynamic = "force-dynamic";

// Server-side merged shape: unlike the client's BringCredentials, this
// includes the real access token (re-injected by getMergedSetting from
// integration_secrets — never sent to the browser).
interface BringSettings {
  credentials: {
    accessToken: string;
  } | null;
}

const BRING_API_URL = "https://api.getbring.com/rest/v2";
const BRING_API_KEY = "cof4Nc6D8saplXjE3h3HXqHH8m7VU2i1Gs0g85Sp";

interface BringItem {
  name: string;
  specification: string;
}

interface BringItemsResponse {
  uuid: string;
  status: string;
  purchase: BringItem[];
  recently: BringItem[];
}

export async function GET(request: NextRequest) {
  try {
    const familyId = request.nextUrl.searchParams.get("family_id");
    const listId = request.nextUrl.searchParams.get("listId");

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

    if (!listId) {
      return NextResponse.json(
        { error: "List ID required" },
        { status: 400 }
      );
    }

    // Fetch list items
    const response = await fetch(`${BRING_API_URL}/bringlists/${listId}`, {
      headers: {
        Authorization: authHeader,
        "X-BRING-API-KEY": BRING_API_KEY,
        "X-BRING-CLIENT": "webApp",
        "X-BRING-CLIENT-SOURCE": "webApp",
        "X-BRING-COUNTRY": "DE",
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return NextResponse.json(
          { error: "Token expired" },
          { status: 401 }
        );
      }
      throw new Error(`Failed to fetch items: ${response.status}`);
    }

    const data: BringItemsResponse = await response.json();

    return NextResponse.json({
      listId: data.uuid,
      items: data.purchase.map((item) => ({
        name: item.name,
        specification: item.specification || "",
        completed: false,
      })),
      recentItems: data.recently.map((item) => ({
        name: item.name,
        specification: item.specification || "",
      })),
    });
  } catch (error) {
    console.error("Bring items error:", error);
    return NextResponse.json(
      { error: "Failed to fetch items" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { listId, itemName, specification, family_id: familyId } = await request.json();

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

    if (!listId || !itemName) {
      return NextResponse.json(
        { error: "List ID and item name required" },
        { status: 400 }
      );
    }

    // Add item to list
    const response = await fetch(`${BRING_API_URL}/bringlists/${listId}`, {
      method: "PUT",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-BRING-API-KEY": BRING_API_KEY,
        "X-BRING-CLIENT": "webApp",
        "X-BRING-CLIENT-SOURCE": "webApp",
        "X-BRING-COUNTRY": "DE",
      },
      body: new URLSearchParams({
        uuid: listId,
        purchase: itemName,
        specification: specification || "",
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to add item: ${response.status}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Bring add item error:", error);
    return NextResponse.json(
      { error: "Failed to add item" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const familyId = request.nextUrl.searchParams.get("family_id");
    const listId = request.nextUrl.searchParams.get("listId");
    const itemName = request.nextUrl.searchParams.get("itemName");

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

    if (!listId || !itemName) {
      return NextResponse.json(
        { error: "List ID and item name required" },
        { status: 400 }
      );
    }

    // Remove item from list (mark as completed)
    const response = await fetch(`${BRING_API_URL}/bringlists/${listId}`, {
      method: "PUT",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-BRING-API-KEY": BRING_API_KEY,
        "X-BRING-CLIENT": "webApp",
        "X-BRING-CLIENT-SOURCE": "webApp",
        "X-BRING-COUNTRY": "DE",
      },
      body: new URLSearchParams({
        uuid: listId,
        recently: itemName,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to remove item: ${response.status}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Bring remove item error:", error);
    return NextResponse.json(
      { error: "Failed to remove item" },
      { status: 500 }
    );
  }
}
