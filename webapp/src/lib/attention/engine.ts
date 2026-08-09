import type { DayContext, ProposedItem, Rule, Signals } from "./types";

/**
 * The evaluator.
 *
 * A pure function: (signals, rules, family settings) -> items. No clock, no
 * database, no network. That is not tidiness, it is the plan's first exit
 * criterion — the same data has to produce the same items — and the only way
 * to be sure of that is for there to be nothing else that could vary.
 *
 * It is also what makes simulation mode free: run it with a `now` in the
 * fixtures and you have next Tuesday morning, with no clock to fake.
 */

/**
 * The plan's contexts, as half-open ranges on local time.
 *
 * The gaps are deliberate and not an oversight. 09:00–14:00 is nobody's
 * "morning rush" and nobody's "afternoon" — it is the middle of the day, when
 * the board should be quiet. Stretching the ranges to cover every minute would
 * mean something is always urgent, which is how a display becomes wallpaper.
 */
const CONTEXT_RANGES: Array<{ context: DayContext; startMinute: number; endMinute: number }> = [
  { context: "morning", startMinute: 5 * 60 + 30, endMinute: 9 * 60 },
  { context: "afternoon", startMinute: 14 * 60, endMinute: 18 * 60 },
  { context: "evening", startMinute: 18 * 60, endMinute: 22 * 60 },
];

/**
 * Which part of the day it is, in the family's own timezone.
 *
 * Taken from the passed clock, never from Date.now(), so a caller cannot
 * accidentally make the result depend on when the code happened to run.
 */
export function resolveDayContext(now: Date, timeZone: string): DayContext {
  const minutes = localMinutes(now, timeZone);
  for (const range of CONTEXT_RANGES) {
    if (minutes >= range.startMinute && minutes < range.endMinute) return range.context;
  }
  return "quiet";
}

/** Minutes since local midnight, in an arbitrary IANA zone. */
export function localMinutes(instant: Date, timeZone: string): number {
  // Intl rather than arithmetic on the UTC offset: the offset changes twice a
  // year, and a family's morning does not move with it.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  // Intl renders midnight as "24" in some locales/engines; normalise it.
  return (hour % 24) * 60 + minute;
}

export interface FamilyRuleState {
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface EvaluateOptions {
  /** Per-family overrides, keyed by rule id. A missing entry means defaults. */
  ruleState?: Record<string, FamilyRuleState>;
}

export interface EvaluatedItem extends ProposedItem {
  ruleId: string;
  priority: number;
  context: DayContext;
}

/**
 * Run every applicable rule and return the items, in the order they should be
 * shown.
 *
 * A rule that throws is skipped rather than allowed to take the whole board
 * down with it. One badly-behaved rule should cost its own hint, not the
 * school run reminder next to it — and on a wall display in a kitchen there is
 * nobody to read a stack trace.
 */
export function evaluate(
  signals: Signals,
  rules: Rule[],
  options: EvaluateOptions = {}
): EvaluatedItem[] {
  const dayContext = resolveDayContext(signals.now, signals.timeZone);
  const state = options.ruleState ?? {};
  const items: EvaluatedItem[] = [];

  for (const rule of rules) {
    const familyState = state[rule.id];
    // Absent means on. A family that has never opened the settings should get
    // every rule, so the table stores only the exceptions.
    if (familyState && !familyState.enabled) continue;

    if (rule.contexts && rule.contexts.length > 0 && !rule.contexts.includes(dayContext)) {
      continue;
    }

    const config = { ...(rule.defaultConfig ?? {}), ...(familyState?.config ?? {}) };

    let produced: ProposedItem[];
    try {
      produced = rule.evaluate(signals, { config, dayContext });
    } catch {
      continue;
    }

    for (const item of produced) {
      if (!item?.key || !item.title) continue; // A nameless hint helps nobody.
      items.push({
        ...item,
        ruleId: rule.id,
        priority: item.priority ?? 100,
        context: item.context ?? dayContext,
      });
    }
  }

  // Deterministic ordering, and deterministic de-duplication. Two rules can
  // legitimately reach the same conclusion; the family should see it once, and
  // which copy survives must not depend on object iteration order.
  const byKey = new Map<string, EvaluatedItem>();
  for (const item of items) {
    const existing = byKey.get(item.key);
    if (!existing || item.priority < existing.priority) byKey.set(item.key, item);
  }

  return [...byKey.values()].sort(
    (a, b) => a.priority - b.priority || a.key.localeCompare(b.key)
  );
}
