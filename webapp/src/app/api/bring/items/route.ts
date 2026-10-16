import { NextRequest, NextResponse } from "next/server";
import { getMergedSetting } from "@/lib/integration-secrets";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import {
  BringAuthError,
  addBringListItem,
  getBringList,
  removeBringListItem,
  withBringAccess,
  type ServerBringSettings,
} from "@/lib/bring-server";

export const dynamic = "force-dynamic";

// Talks to Bring! as the family, with the account credentials stored for them.
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  try {
    const familyId = request.nextUrl.searchParams.get("family_id");
    const listId = request.nextUrl.searchParams.get("listId");

    if (!familyId) {
      return NextResponse.json(
        { error: "family_id is required" },
        { status: 400 }
      );
    }

    if (!familyMatchesSession(auth.session, familyId)) {
      return NextResponse.json({ error: "not authenticated" }, { status: 401 });
    }

    const settings = await getMergedSetting<ServerBringSettings>(familyId, "bring_settings");
    const credentials = settings?.credentials;
    if (!credentials?.accessToken) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    if (!listId) {
      return NextResponse.json(
        { error: "List ID required" },
        { status: 400 }
      );
    }

    const data = await withBringAccess(familyId, settings, (accessToken) =>
      getBringList({ accessToken, listId })
    );

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
    if (error instanceof BringAuthError) {
      return NextResponse.json({ error: "Token expired" }, { status: 401 });
    }
    console.error("Bring items error:", error);
    return NextResponse.json(
      { error: "Failed to fetch items" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  try {
    const { listId, itemName, specification, family_id: familyId } = await request.json();

    if (!familyId) {
      return NextResponse.json(
        { error: "family_id is required" },
        { status: 400 }
      );
    }

    if (!familyMatchesSession(auth.session, familyId)) {
      return NextResponse.json({ error: "not authenticated" }, { status: 401 });
    }

    const settings = await getMergedSetting<ServerBringSettings>(familyId, "bring_settings");
    const credentials = settings?.credentials;
    if (!credentials?.accessToken) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    if (!listId || !itemName) {
      return NextResponse.json(
        { error: "List ID and item name required" },
        { status: 400 }
      );
    }

    // Add item to list
    await withBringAccess(familyId, settings, (accessToken) =>
      addBringListItem({ accessToken, listId, itemName, specification })
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof BringAuthError) {
      return NextResponse.json({ error: "Token expired" }, { status: 401 });
    }
    console.error("Bring add item error:", error);
    return NextResponse.json(
      { error: "Failed to add item" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

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

    if (!familyMatchesSession(auth.session, familyId)) {
      return NextResponse.json({ error: "not authenticated" }, { status: 401 });
    }

    const settings = await getMergedSetting<ServerBringSettings>(familyId, "bring_settings");
    const credentials = settings?.credentials;
    if (!credentials?.accessToken) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    if (!listId || !itemName) {
      return NextResponse.json(
        { error: "List ID and item name required" },
        { status: 400 }
      );
    }

    // Remove item from list (mark as completed)
    await withBringAccess(familyId, settings, (accessToken) =>
      removeBringListItem({ accessToken, listId, itemName })
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof BringAuthError) {
      return NextResponse.json({ error: "Token expired" }, { status: 401 });
    }
    console.error("Bring remove item error:", error);
    return NextResponse.json(
      { error: "Failed to remove item" },
      { status: 500 }
    );
  }
}
