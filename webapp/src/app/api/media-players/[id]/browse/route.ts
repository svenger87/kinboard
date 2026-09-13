import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { familyIdFrom, rowInFamily } from "@/lib/family-scope";
import { getMergedSetting } from "@/lib/integration-secrets";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { HAWebSocketError, haWebSocketCommand } from "@/lib/ha-websocket";
import { browseNodesFromHa } from "@/plugins/media/drivers/home-assistant";
import type { HomeAssistantSettings } from "@/types/home-assistant";
import type { MediaPlayer } from "@/types/database";

export const dynamic = "force-dynamic";

/**
 * One level of a player's library.
 *
 * Home Assistant exposes `media_player/browse_media` on its WebSocket API
 * only — there is no REST equivalent — so this is the one route that does not
 * speak to HA the way every other one does. See `lib/ha-websocket.ts` for why
 * the socket lives on the server and why it is opened per request.
 *
 * The entity id is resolved here from the player row rather than accepted
 * from the caller. That matters: this route holds the household's Home
 * Assistant token, and a caller who could name the entity could browse
 * anything HA can see, whether or not the household added it to Kinboard.
 * Same reasoning as the artwork route beside it.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const familyId = familyIdFrom(request);
  if (!familyId) {
    return NextResponse.json({ error: "family_id required" }, { status: 400 });
  }
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Service-role client: RLS is bypassed by design, so this is the only thing
  // standing between another family's player id and this family's HA token.
  if (!(await rowInFamily(supabase, "media_players", id, familyId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data: playerRow } = await supabase
    .from("media_players")
    .select("driver, config")
    .eq("id", id)
    .maybeSingle();
  const player = playerRow as Pick<MediaPlayer, "driver" | "config"> | null;

  if (!player || player.driver !== "home_assistant") {
    // Browsing is per-driver. Only the HA driver exists today; a native
    // driver (RFC-003 M2) would answer here with its own tree.
    return NextResponse.json({ error: "browsing not supported for this player" }, { status: 400 });
  }

  const entityId = (player.config as { entity_id?: string } | null)?.entity_id;
  if (!entityId) {
    return NextResponse.json({ error: "player has no entity_id" }, { status: 400 });
  }

  const ha = await getMergedSetting<HomeAssistantSettings>(familyId, SETTINGS_KEYS.homeAssistant);
  if (!ha?.url || !ha.access_token) {
    return NextResponse.json({ error: "home assistant not configured" }, { status: 404 });
  }

  // Absent on the first call, which asks the player for its own root.
  const mediaContentId = request.nextUrl.searchParams.get("media_content_id") ?? undefined;
  const mediaContentType = request.nextUrl.searchParams.get("media_content_type") ?? undefined;

  try {
    const result = await haWebSocketCommand<Parameters<typeof browseNodesFromHa>[0]>(
      ha.url,
      ha.access_token,
      {
        type: "media_player/browse_media",
        entity_id: entityId,
        ...(mediaContentId ? { media_content_id: mediaContentId } : {}),
        ...(mediaContentType ? { media_content_type: mediaContentType } : {}),
      },
    );
    return NextResponse.json({
      title: result?.title ?? null,
      nodes: browseNodesFromHa(result),
    });
  } catch (error) {
    // A household should be told the library could not be read, not shown an
    // empty one — an empty tree and an unreachable speaker look identical.
    const message = error instanceof HAWebSocketError ? error.message : "browse failed";
    console.warn("[media] browse failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
