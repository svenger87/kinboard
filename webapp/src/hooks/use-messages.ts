"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import type { Message } from "@/types/database";
import { messageState } from "@/lib/message-state";
import { applyOffset } from "@/lib/server-clock";
import { useServerClockOffset } from "./use-server-clock";

const KEY = "messages";

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
  const { data: messages = [] } = useMessages();
  const { device } = useFamilyStore();
  const [now, setNow] = useState(() => new Date());
  const serverNow = applyOffset(now, useServerClockOffset());

  const candidates = messages.filter((m) => m.sender_device_id !== (device?.id ?? null));
  const hasPending = candidates.some((m) => messageState(m, serverNow) !== "done");

  useEffect(() => {
    if (!hasPending) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [hasPending]);

  return candidates.find((m) => messageState(m, serverNow) === "takeover") ?? null;
}
