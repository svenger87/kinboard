"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import type { Message } from "@/types/database";
import { messageState } from "@/lib/message-state";
import { applyOffset } from "@/lib/server-clock";
import { useServerClockOffset } from "./use-server-clock";

const KEY = "messages";

// See the comment in `useTakeoverMessage` for why this needs to be a single
// stable reference rather than an inline `[]` default.
const EMPTY_MESSAGES: Message[] = [];

/**
 * Take the row out of the cache ourselves rather than trusting a refetch to
 * come back with a list that no longer has it.
 *
 * `invalidateQueries` is deduped against whatever fetch is already in flight,
 * and on a family board something usually is. A message somebody acknowledged
 * on the other panel, still on this one, is the failure this avoids.
 */
function forget(qc: QueryClient, familyId: string | undefined, id: string) {
  qc.setQueryData<Message[]>([KEY, familyId], (old) => old?.filter((x) => x.id !== id));
  void qc.invalidateQueries({ queryKey: [KEY, familyId] });
}

export function useMessages() {
  const { family } = useFamilyStore();
  return useQuery({
    queryKey: [KEY, family?.id],
    enabled: Boolean(family?.id),
    queryFn: async (): Promise<Message[]> => {
      const r = await fetch(`/api/messages?family_id=${family!.id}`);
      if (!r.ok) throw new Error(`messages: ${r.status}`);
      return ((await r.json()) as { messages: Message[] }).messages;
    },
    /*
      A backstop for dropped realtime messages, not the primary path. This stack
      puts ~23 tables on one channel and its realtime server sheds load once a
      channel exceeds its per-second budget. Missing the change here is worse
      than for any other table: it is either a message nobody sees, or one that
      stays on the wall after somebody dealt with it.
    */
    refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? 10_000 : 30_000),
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (body: string): Promise<Message> => {
      const r = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_id: family!.id, body }),
      });
      if (!r.ok) throw new Error(`send message: ${r.status}`);
      return ((await r.json()) as { message: Message }).message;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, family?.id] }),
  });
}

export function useAcknowledgeMessage() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const r = await fetch(`/api/messages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_id: family!.id }),
      });
      if (!r.ok) throw new Error(`acknowledge message: ${r.status}`);
    },
    onSuccess: (_data, id) => forget(qc, family?.id, id),
  });
}

/**
 * The message currently entitled to the board, or null.
 *
 * Never the reader's own: the sender knows what they typed, and a screen that
 * shouted your own message back at you is the first thing anyone would
 * complain about. The realtime change reaches every client including the
 * sender's, so this filter is where that rule is applied — it cannot be done
 * server-side, because realtime broadcasts one change to one channel rather
 * than a message per recipient.
 *
 * Used by the takeover panel and by the screensaver, from one measurement of
 * the server clock, so the two cannot disagree about whether a message is
 * still demanding attention.
 */
export function useTakeoverMessage(): Message | null {
  // Not `= []`: an inline default is a fresh array literal on every render
  // that `data` is undefined, and the effect below keys off `messages`'
  // identity to know when new data has actually arrived. On a route with no
  // family yet — this hook now also runs inside `ScreensaverProvider`, which
  // is mounted on every route including the pre-auth `/join` screen — the
  // query is permanently `enabled: false`, `data` never leaves `undefined`,
  // and a fresh `[]` each render made that effect fire every render, forever:
  // an unthrottled `setState` loop that pegs the tab at 100% CPU and — caught
  // here — starved `/join` badly enough that its own button never painted.
  // `EMPTY_MESSAGES` gives "no data yet" one stable identity so the effect
  // sees no change and does not fire.
  const { data: messages = EMPTY_MESSAGES } = useMessages();
  const { device } = useFamilyStore();
  const [now, setNow] = useState(() => new Date());
  const serverNow = applyOffset(now, useServerClockOffset());

  /*
    Not `m.sender_device_id !== (device?.id ?? null)`. Coalescing both sides to
    one sentinel makes two different nulls equal: a message whose sender device
    has since been deleted has a null sender, and a viewer whose store has not
    hydrated has no device id — and the comparison then reads that message as
    "mine" and hides it from precisely the screen least able to know better.
    RFC-005 §2 is explicit that a null sender shows everywhere. So the
    exclusion applies only when this screen actually knows which device it is.
  */
  const myDeviceId = device?.id ?? null;
  const candidates = messages.filter(
    (m) => myDeviceId === null || m.sender_device_id !== myDeviceId,
  );
  // Only a takeover is on a clock. "waiting" ends when somebody taps, which is
  // an event and not a tick, so scoping the interval to `!== "done"` would keep
  // a wall display ticking once a second for as long as any message sits
  // unacknowledged — which is exactly the state this feature is designed to
  // leave it in. `useRingingTimer` scopes its tick the same way, to "running".
  const hasPending = candidates.some((m) => messageState(m, serverNow) === "takeover");

  /*
    New data means the frozen clock is about to be asked a question it cannot
    answer. The tick only runs during a takeover, so between them `now` can be
    hours old — and a message that surfaces already older than a minute (the
    poll catching one a dropped realtime message lost) would be measured
    against that stale reading as though it came from the future, and flash as
    a takeover for one frame. Nobody should be interrupted by a message that
    was over before the screen heard about it. Re-read the clock when the set
    changes; TanStack keeps the array identity stable when the data has not,
    so this does not fire on every refetch.
  */
  useEffect(() => {
    setNow(new Date());
  }, [messages]);

  useEffect(() => {
    if (!hasPending) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [hasPending]);

  return candidates.find((m) => messageState(m, serverNow) === "takeover") ?? null;
}
