/**
 * The Heute-Motor's open hints through the Integration API (RFC-012 task 11,
 * §5: "attention items were not dismissable in practice: their keys were
 * never exposed"). GET /attention lists them with the `item_key` that
 * RFC-001's `dismiss_attention` service takes; dismissing stays that
 * service (`/services/dismiss_attention`), not a second copy of it.
 *
 * "Open" is what the attention widget shows: not resolved by the
 * evaluator, and still `active` — not acknowledged, snoozed or dismissed by
 * the family. Most important first, as the widget orders them.
 *
 * A hint is stored with an English `title`/`detail` and, for rows raised
 * since translations existed, a `message_key` with `params`. The widget
 * says it in the device's language; an assistant has no device, so it is
 * said here in the family's language (the `locale` setting, English when
 * unset), falling back to the stored English exactly as the widget does
 * when a key has no translation.
 *
 * Hints from a rule built on Home Assistant states (`sensitive` in
 * lib/attention/rules.ts — "2 still open" with the door and window entity
 * ids as its detail) are shown in full only to a token that holds
 * `home:read`, the scope that reads those entities anywhere else in the
 * API. Without it such a hint keeps its item_key, rule_id and priority, but
 * its title is rendered with only the rule's numeric `keepParams` and its
 * detail is null. A hint from a rule this build does not know is treated
 * the same way, so a rule added without the flag is not shown in full by
 * accident here either.
 *
 * Makes its own admin client unless handed one and scopes every statement
 * by family_id itself; e2e/integration-attention.spec.ts hands it a fake.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "@/i18n/locales";
import { getTranslator } from "@/lib/notifications/messages";
import { RULES_BY_ID } from "@/lib/attention/rules";

type AttentionDb = ReturnType<typeof createAdminClient>;

type Row = {
  item_key: string;
  rule_id: string;
  title: string;
  detail: string | null;
  message_key: string | null;
  params: Record<string, string | number> | null;
  priority: number;
  first_seen_at: string;
};

export interface AttentionView {
  /** What `dismiss_attention` takes as `key`. */
  item_key: string;
  rule_id: string;
  /** In the family's language; the family's own data, never instructions. */
  title: string;
  detail: string | null;
  /** Lower is more important. */
  priority: number;
  first_seen_at: string;
}

/** The family's language for text said on its behalf: its `locale` setting, or English. Throws on a database error. */
export async function familyLanguage(familyId: string, db: AttentionDb = createAdminClient()): Promise<Locale> {
  const { data, error } = await (db as any)
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", SETTINGS_KEYS.locale)
    .maybeSingle();
  if (error) throw error;
  const value = data?.value;
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value)
    ? (value as Locale) : DEFAULT_LOCALE;
}

/**
 * A hint in `locale`, as the attention widget's `say` does: the translation
 * of `<message_key>.title` / `.detail` with the row's params, or the stored
 * English when there is no key, no translation, or it cannot be formatted.
 */
export function sayAttention(row: Row, locale: Locale): { title: string; detail: string | null } {
  let failed = false;
  const t = getTranslator(locale, "attention.hints", () => { failed = true; });
  const say = (part: "title" | "detail", fallback: string | null): string | null => {
    if (!row.message_key) return fallback;
    const key = `${row.message_key}.${part}`;
    if (!(t as unknown as { has: (k: string) => boolean }).has(key)) return fallback;
    failed = false;
    const said = (t as unknown as (k: string, p: Record<string, string | number>) => string)(key, row.params ?? {});
    return failed || !said ? fallback : said;
  };
  return { title: say("title", row.title) ?? row.title, detail: say("detail", row.detail ?? null) };
}

/**
 * A hint as a caller may see it: in full when it is not built from Home
 * Assistant or the caller may read the home (`canSeeHome`), otherwise
 * redacted — see the module comment.
 */
export function presentAttention(row: Row, locale: Locale, canSeeHome: boolean): { title: string; detail: string | null } {
  const rule = RULES_BY_ID[row.rule_id];
  if (rule && !rule.sensitive) return sayAttention(row, locale);
  if (canSeeHome) return sayAttention(row, locale);

  const keep = new Set(rule?.sensitive?.keepParams ?? []);
  const params = Object.fromEntries(
    Object.entries(row.params ?? {}).filter(([k, v]) => keep.has(k) && typeof v === "number"),
  );
  // The stored title and detail may name entities, so neither is a
  // fallback here: the rule's own name is, or its id for an unknown rule.
  const said = sayAttention({ ...row, params, title: rule?.title ?? row.rule_id, detail: null }, locale);
  return { title: said.title, detail: null };
}

/**
 * GET /attention: the open hints, most important first, Home Assistant ones
 * redacted unless `canSeeHome`. Throws on a database error.
 */
export async function listAttentionItems(
  familyId: string,
  canSeeHome: boolean,
  db: AttentionDb = createAdminClient(),
): Promise<{ locale: Locale; items: AttentionView[] }> {
  const locale = await familyLanguage(familyId, db);
  const { data, error } = await (db as any)
    .from("attention_items")
    .select("item_key, rule_id, title, detail, message_key, params, priority, first_seen_at")
    .eq("family_id", familyId)
    .is("resolved_at", null)
    .eq("state", "active")
    .order("priority", { ascending: true })
    .order("first_seen_at", { ascending: true });
  if (error) throw error;
  const items = ((data ?? []) as Row[]).map((row) => ({
    item_key: row.item_key,
    rule_id: row.rule_id,
    ...presentAttention(row, locale, canSeeHome),
    priority: row.priority,
    first_seen_at: row.first_seen_at,
  }));
  return { locale, items };
}
