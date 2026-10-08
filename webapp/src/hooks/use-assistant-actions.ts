"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import type { ScreenRequest } from "@/lib/home/action-requests";
import { isTerminal } from "@/lib/home/action-prompt";
import { invalidatePocketMoney } from "./use-pocket-money-accounts";
import { POINT_PURCHASES_KEY, POINT_REDEMPTIONS_KEY, POINT_REWARDS_KEY } from "./use-point-rewards";

const KEY = "assistant-actions";

// One stable empty list, so "no data yet" does not re-render consumers every pass.
const EMPTY: ScreenRequest[] = [];

/**
 * What assistants are waiting on a person for (RFC-011 §4.3).
 *
 * Realtime (`use-realtime.ts`) invalidates this on every change to the
 * table; the 10-second poll is the backstop for a dropped realtime message,
 * which here would mean a door request nobody sees until it expires.
 */
export function usePendingAssistantActions(enabled = true): ScreenRequest[] {
  const { family } = useFamilyStore();
  const { data = EMPTY } = useQuery({
    queryKey: [KEY, family?.id],
    enabled: enabled && Boolean(family?.id),
    queryFn: async (): Promise<ScreenRequest[]> => {
      const r = await fetch("/api/assistant-actions");
      if (!r.ok) throw new Error(`assistant-actions: ${r.status}`);
      return ((await r.json()) as { requests: ScreenRequest[] }).requests;
    },
    refetchInterval: 10_000,
  });
  return data;
}

/** One request, in whatever state, for the push notification's deep link. */
export function useAssistantAction(id: string) {
  const { family } = useFamilyStore();
  return useQuery({
    queryKey: [KEY, family?.id, id],
    enabled: Boolean(family?.id) && Boolean(id),
    queryFn: async (): Promise<ScreenRequest | null> => {
      const r = await fetch(`/api/assistant-actions/${encodeURIComponent(id)}`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`assistant-action: ${r.status}`);
      return ((await r.json()) as { request: ScreenRequest }).request;
    },
    // While it waits for an answer, keep looking; once it is final — including
    // an approval the server has settled as "outcome unknown" — stop.
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && !isTerminal(data) ? 5_000 : false;
    },
  });
}

export class DecisionError extends Error {
  constructor(readonly code: string, readonly request?: ScreenRequest) {
    super(code);
    this.name = "DecisionError";
  }
}

export function useDecideAssistantAction() {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  return useMutation({
    mutationFn: async (args: { id: string; decision: "approve" | "deny"; pin?: string }): Promise<ScreenRequest> => {
      const r = await fetch(`/api/assistant-actions/${encodeURIComponent(args.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Deny sends no PIN at all.
        body: JSON.stringify(args.decision === "approve" ? { decision: "approve", pin: args.pin } : { decision: "deny" }),
      });
      const body = (await r.json().catch(() => null)) as { request?: ScreenRequest; error?: string } | null;
      if (!r.ok || !body?.request) throw new DecisionError(body?.error ?? "generic", body?.request);
      return body.request;
    },
    onSuccess: (request) => {
      // An allowed booking or reward decision was written by the server just
      // now. This screen refetches what it changed straight away rather than
      // waiting for realtime to bring the change back to it.
      if (request.kind === "pocket_money" || request.kind === "reward_decision") {
        invalidatePocketMoney(qc);
        qc.invalidateQueries({ queryKey: [POINT_REWARDS_KEY] });
        qc.invalidateQueries({ queryKey: [POINT_REDEMPTIONS_KEY] });
        qc.invalidateQueries({ queryKey: [POINT_PURCHASES_KEY] });
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [KEY, family?.id] }),
  });
}
