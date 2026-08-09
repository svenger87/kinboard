"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamilyStore } from "@/stores/family-store";

/**
 * `acted_by` is left unset on purpose.
 *
 * A device is not a person: the kitchen tablet is shared and nobody is signed
 * in to it, so the honest answer to "who acknowledged this?" is that we do not
 * know. Recording the device instead would look like an answer and be one of
 * up to five people. The column stays available for a future where a phone can
 * say who it belongs to.
 */

/**
 * The Heute-Motor, from the browser.
 *
 * Read and respond only. Raising and resolving items is the evaluator's job
 * and it runs server-side behind the cron secret — the database grants say the
 * same thing, so a browser that tried to invent an alert would be refused by
 * Postgres rather than by politeness.
 *
 * What a family *may* do is answer: acknowledge it, put it off, dismiss it, or
 * turn the rule off entirely. The plan requires every hint to be disableable
 * from itself, which is why `useDisableRule` takes the rule id an item already
 * carries rather than sending anybody to a settings page to find it.
 */

export type AttentionState = "active" | "acknowledged" | "snoozed" | "dismissed";

export interface AttentionItem {
  id: string;
  family_id: string;
  rule_id: string;
  item_key: string;
  title: string;
  detail: string | null;
  evidence: Record<string, unknown>;
  priority: number;
  context: string | null;
  subject_type: string | null;
  subject_id: string | null;
  state: AttentionState;
  snoozed_until: string | null;
  acted_at: string | null;
  acted_by: string | null;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
}

export const attentionKeys = {
  items: (familyId: string) => ["attention-items", familyId] as const,
  rules: (familyId: string) => ["context-rules", familyId] as const,
};

/** Everything still outstanding, most important first. */
export function useAttentionItems() {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: attentionKeys.items(family?.id ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attention_items")
        .select("*")
        .eq("family_id", family!.id)
        .is("resolved_at", null)
        .order("priority", { ascending: true })
        .order("first_seen_at", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as AttentionItem[];
    },
    enabled: !!family?.id,
    // The evaluator runs every five minutes, so asking more often than that
    // mostly re-fetches the same answer. Half the interval keeps a wall
    // display within about two minutes of the truth without hammering.
    refetchInterval: 150_000,
  });
}

function useInvalidateAttention() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();
  return () => {
    queryClient.invalidateQueries({ queryKey: attentionKeys.items(family?.id ?? "") });
  };
}

/**
 * Mark an item as seen and dealt with.
 *
 * Deliberately does not resolve it. Whether the situation is still true is the
 * evaluator's judgement, not the family's — acknowledging the sports kit
 * reminder means "I know", not "it is packed", and the item goes quiet without
 * anybody having to lie to the board.
 */
export function useAcknowledgeAttention() {
  const supabase = createClient();
  const invalidate = useInvalidateAttention();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("attention_items")
        .update({
          state: "acknowledged",
          acted_at: new Date().toISOString(),
        } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Put it off. The evaluator brings it back when the time passes. */
export function useSnoozeAttention() {
  const supabase = createClient();
  const invalidate = useInvalidateAttention();

  return useMutation({
    mutationFn: async ({ id, minutes }: { id: string; minutes: number }) => {
      const until = new Date(Date.now() + minutes * 60_000).toISOString();
      const { error } = await supabase
        .from("attention_items")
        .update({
          state: "snoozed",
          snoozed_until: until,
          acted_at: new Date().toISOString(),
        } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Not now and not later — but the rule stays on for next time. */
export function useDismissAttention() {
  const supabase = createClient();
  const invalidate = useInvalidateAttention();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("attention_items")
        .update({
          state: "dismissed",
          acted_at: new Date().toISOString(),
        } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Which rules this family has switched off. Absent means on. */
export function useContextRules() {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: attentionKeys.rules(family?.id ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("context_rules")
        .select("*")
        .eq("family_id", family!.id);
      if (error) throw error;
      return (data ?? []) as unknown as {
        rule_id: string;
        enabled: boolean;
        config: Record<string, unknown>;
      }[];
    },
    enabled: !!family?.id,
  });
}

/**
 * Turn a rule off (or back on) from the hint it produced.
 *
 * Upsert, because "on" is the absence of a row: a family that has never
 * touched the settings has no rows at all and gets every rule, so switching
 * one off is the first row they ever write.
 */
export function useSetRuleEnabled() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("context_rules")
        .upsert(
          {
            family_id: family!.id,
            rule_id: ruleId,
            enabled,
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: "family_id,rule_id" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: attentionKeys.rules(family?.id ?? "") });
      queryClient.invalidateQueries({ queryKey: attentionKeys.items(family?.id ?? "") });
    },
  });
}
