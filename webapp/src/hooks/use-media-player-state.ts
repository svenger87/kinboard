"use client";

import { useMemo } from "react";
import { useCallService, useHomeAssistantEntityStates } from "./use-home-assistant";
import { stateFromHaEntity } from "@/plugins/media/drivers/home-assistant";
import type { MediaCommand, MediaPlayerState } from "@/plugins/media/types";
import type { MediaPlayer } from "@/types/database";

/** RFC-003 §2.3. */
const ALL_POLL_MS = 10_000;
const ACTIVE_POLL_MS = 3_000;

/** The HA entity a row points at. `config` is `Json`, so the cast happens here. */
export function entityIdOf(player: MediaPlayer): string {
  return String((player.config as { entity_id?: string })?.entity_id ?? "");
}

/**
 * Read every configured player, and read the one on screen more often.
 *
 * Two rates rather than one: something has to notice that a device started
 * playing, which is a slow question, while the device already on screen needs
 * volume and track changes to feel immediate. Position is not a reason to poll
 * at all — it is interpolated. RFC-003 §2.3.
 */
export function useMediaPlayerStates(
  players: MediaPlayer[],
  activeId?: string,
): Record<string, MediaPlayerState> {
  const allIds = useMemo(
    () => players.map(entityIdOf).filter(Boolean),
    [players],
  );
  const activeEntity = useMemo(() => {
    const p = players.find((x) => x.id === activeId);
    return p ? [entityIdOf(p)].filter(Boolean) : [];
  }, [players, activeId]);

  // Noticing that something started is a slow question; the device already on
  // screen needs to feel immediate. Position is not a reason to poll at all.
  const all = useHomeAssistantEntityStates(allIds, undefined, ALL_POLL_MS);
  const active = useHomeAssistantEntityStates(activeEntity, undefined, ACTIVE_POLL_MS);

  return useMemo(() => {
    const byEntity = new Map((all.data ?? []).map((e) => [e.entity_id, e]));
    // The active device's fresher read wins where both exist.
    for (const e of active.data ?? []) byEntity.set(e.entity_id, e);

    const out: Record<string, MediaPlayerState> = {};
    for (const p of players) {
      out[p.id] = stateFromHaEntity(byEntity.get(entityIdOf(p)));
    }
    return out;
  }, [players, all.data, active.data]);
}

/**
 * Issue a command.
 *
 * Errors are returned to the caller rather than surfaced here: the card shows a
 * quiet inline mark and rolls its optimistic state back. A modal on a wall
 * display nobody is standing at is worse than the failed tap. RFC-003 §8.
 */
export function useMediaCommand() {
  const { mutateAsync, isPending } = useCallService();

  const run = async (player: MediaPlayer, command: MediaCommand) => {
    const entity_id = entityIdOf(player);
    if (!entity_id) throw new Error("player has no entity_id");

    // HAServiceCall (src/types/home-assistant.ts) nests extra fields under
    // `service_data`, not at the top level — every other convenience hook in
    // use-home-assistant.ts (useMediaPlayerControl, useLightControl, ...)
    // follows that shape, so this does too.
    const call = (service: string, service_data?: Record<string, unknown>) =>
      mutateAsync({ domain: "media_player", service, entity_id, service_data });

    switch (command.kind) {
      case "playPause":
        return void (await call("media_play_pause"));
      case "next":
        return void (await call("media_next_track"));
      case "previous":
        return void (await call("media_previous_track"));
      case "seek":
        return void (await call("media_seek", { seek_position: command.position }));
      case "setVolume":
        return void (await call("volume_set", { volume_level: command.volume }));
      case "setMuted":
        return void (await call("volume_mute", { is_volume_muted: command.muted }));
      case "selectSource":
        return void (await call("select_source", { source: command.source }));
    }
  };

  return { run, isPending };
}
