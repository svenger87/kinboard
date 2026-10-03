"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import { applyOffset } from "@/lib/server-clock";
import { activeTakeover, takeoverRemainingMs, type CameraTakeoverRow } from "@/lib/camera-takeover";
import { useServerClockOffset } from "./use-server-clock";

const KEY = "camera-takeover";

/**
 * The camera `show_camera` has put on this screen (#335), or null once it has
 * ended, or if this screen isn't one of its targets. Read by the screensaver
 * gate and the overlay from one place, so the two cannot disagree about
 * whether the doorbell still has the wall.
 *
 * Realtime is the primary path. A wall display also checks every 10 seconds,
 * because this stack's realtime server sheds changes when its one channel is
 * busy (see useMessages), and a doorbell that is over in a minute cannot wait
 * for the 30 seconds a message's backstop allows. Anything else relies on
 * realtime alone: it is only ever a target when somebody names it.
 */
export function useCameraTakeover(): CameraTakeoverRow | null {
  const { family, device } = useFamilyStore();
  const { data = null } = useQuery({
    queryKey: [KEY, family?.id],
    enabled: Boolean(family?.id && device?.id),
    queryFn: async (): Promise<CameraTakeoverRow | null> => {
      const r = await fetch(`/api/camera-takeover?family_id=${family!.id}`);
      if (!r.ok) throw new Error(`camera takeover: ${r.status}`);
      return ((await r.json()) as { takeover: CameraTakeoverRow | null }).takeover;
    },
    refetchInterval: device?.is_kiosk ? 10_000 : false,
  });

  const offset = useServerClockOffset();
  const [now, setNow] = useState(() => new Date());
  // A new row is judged against the time it arrived, not the last tick.
  useEffect(() => setNow(new Date()), [data]);

  const active = activeTakeover(data, device?.id, applyOffset(now, offset));
  const endsAt = active?.ends_at ?? null;

  // One timer for the end rather than a tick every second: nothing on screen
  // counts down, it only has to go when the minute is up.
  useEffect(() => {
    if (!endsAt) return;
    const ms = takeoverRemainingMs({ ends_at: endsAt }, applyOffset(new Date(), offset));
    const id = window.setTimeout(() => setNow(new Date()), ms + 50);
    return () => window.clearTimeout(id);
  }, [endsAt, offset]);

  return active;
}
