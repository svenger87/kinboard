import { createAdminClient } from "@/lib/supabase/server";
import { collectSignals, resetSignalCaches, type CollectOptions } from "./signals";
import { evaluate, type EvaluatedItem, type FamilyRuleState } from "./engine";
import { RULES } from "./rules";

/**
 * Running the Heute-Motor and reconciling what it says with what is stored.
 *
 * The evaluator is a pure function of the signals, so the *set* of items is
 * derivable at any moment. What is not derivable is the family's response to
 * them — acknowledged, snoozed until after school, already dealt with. That is
 * the whole reason there is a table, and the whole difficulty of this file:
 * every run has to update what an item says without forgetting what a person
 * did about it.
 *
 * Reconciliation, not replacement. Deleting and re-inserting each run would be
 * far simpler and would throw away every acknowledgement once a minute.
 */

export interface RunResult {
  familyId: string;
  raised: number;
  refreshed: number;
  resolved: number;
  unsnoozed: number;
  active: number;
}

interface StoredItem {
  id: string;
  item_key: string;
  state: string;
  snoozed_until: string | null;
}

/** Per-family rule settings, defaulted by the rules themselves when absent. */
async function loadRuleState(familyId: string): Promise<Record<string, FamilyRuleState>> {
  try {
    const supabase = createAdminClient();
    const { data } = await (supabase as any)
      .from("context_rules")
      .select("rule_id, enabled, config")
      .eq("family_id", familyId);

    const state: Record<string, FamilyRuleState> = {};
    for (const row of data ?? []) {
      state[String(row.rule_id)] = {
        enabled: row.enabled !== false,
        config: (row.config ?? {}) as Record<string, unknown>,
      };
    }
    return state;
  } catch {
    // A missing table or an unreachable database must not mean "every rule is
    // off". Defaults are the safe direction: the family sees the hints they
    // would have seen before anybody touched the settings.
    return {};
  }
}

export async function runAttentionForFamily(
  familyId: string,
  options: CollectOptions = {}
): Promise<RunResult> {
  const supabase = createAdminClient();
  const now = options.now ?? new Date();

  resetSignalCaches();
  const signals = await collectSignals(familyId, { ...options, now });
  const ruleState = await loadRuleState(familyId);
  const proposed = evaluate(signals, RULES, { ruleState });

  const { data: existingRows } = await (supabase as any)
    .from("attention_items")
    .select("id, item_key, state, snoozed_until")
    .eq("family_id", familyId)
    .is("resolved_at", null);

  const existing = new Map<string, StoredItem>(
    ((existingRows ?? []) as StoredItem[]).map((r) => [r.item_key, r])
  );
  const proposedByKey = new Map<string, EvaluatedItem>(proposed.map((i) => [i.key, i]));

  const result: RunResult = {
    familyId,
    raised: 0,
    refreshed: 0,
    resolved: 0,
    unsnoozed: 0,
    active: 0,
  };
  const nowIso = now.toISOString();

  // -- still true: refresh the wording, keep the response ------------------
  for (const [key, item] of proposedByKey) {
    const row = existing.get(key);
    if (!row) continue;

    // A snooze that has run out returns the item to active. Doing it here
    // rather than in a query means it happens exactly when the item is next
    // confirmed to still be true — an item that resolved itself while snoozed
    // should never come back at all.
    const wokeUp =
      row.state === "snoozed" &&
      row.snoozed_until !== null &&
      new Date(row.snoozed_until) <= now;

    await (supabase as any)
      .from("attention_items")
      .update({
        title: item.title,
        detail: item.detail ?? null,
        evidence: item.evidence ?? {},
        priority: item.priority,
        context: item.context,
        last_seen_at: nowIso,
        ...(wokeUp ? { state: "active", snoozed_until: null } : {}),
      })
      .eq("id", row.id);

    result.refreshed += 1;
    if (wokeUp) result.unsnoozed += 1;
  }

  // -- newly true ----------------------------------------------------------
  const fresh = proposed.filter((i) => !existing.has(i.key));
  if (fresh.length > 0) {
    await (supabase as any).from("attention_items").insert(
      fresh.map((item) => ({
        family_id: familyId,
        rule_id: item.ruleId,
        item_key: item.key,
        title: item.title,
        detail: item.detail ?? null,
        evidence: item.evidence ?? {},
        priority: item.priority,
        context: item.context,
        subject_type: item.subjectType ?? null,
        subject_id: item.subjectId ?? null,
        state: "active",
        first_seen_at: nowIso,
        last_seen_at: nowIso,
      }))
    );
    result.raised = fresh.length;
  }

  // -- no longer true ------------------------------------------------------
  const goneKeys = [...existing.keys()].filter((k) => !proposedByKey.has(k));
  if (goneKeys.length > 0) {
    // Resolved, not deleted. "Three things you have already dealt with today"
    // is worth showing, and keeping the row also stops a flapping signal from
    // raising a brand-new item every few minutes.
    await (supabase as any)
      .from("attention_items")
      .update({ resolved_at: nowIso })
      .eq("family_id", familyId)
      .is("resolved_at", null)
      .in("item_key", goneKeys);
    result.resolved = goneKeys.length;
  }

  result.active = proposed.length;
  return result;
}

/** Every family on the instance. One failing must not stop the others. */
export async function runAttentionForAllFamilies(
  options: CollectOptions = {}
): Promise<RunResult[]> {
  const supabase = createAdminClient();
  const { data } = await (supabase as any).from("families").select("id");

  const results: RunResult[] = [];
  for (const row of data ?? []) {
    try {
      results.push(await runAttentionForFamily(String(row.id), options));
    } catch {
      // Deliberately swallowed per family: an instance hosting five families
      // should not lose the board for four of them because one has a broken
      // calendar.
    }
  }
  return results;
}
