/**
 * Backups across the RFC-017 data move (/api/import). Pure, so the specs can
 * run it on a payload without a database.
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * A redemption from a backup made before RFC-017 names an account, not a
 * child. Its child is the account's person in the same backup; the ids are
 * the backup's own, remapped afterwards like every other reference.
 */
export function personForOldRedemptions(data: Record<string, unknown[] | undefined>): void {
  const personOfAccount = new Map<string, string>();
  for (const a of data.pocket_money_accounts ?? []) {
    if (isRecord(a) && typeof a.id === "string" && typeof a.person_id === "string") {
      personOfAccount.set(a.id, a.person_id);
    }
  }
  for (const r of data.point_redemptions ?? []) {
    if (isRecord(r) && typeof r.person_id !== "string" && typeof r.account_id === "string") {
      const person = personOfAccount.get(r.account_id);
      if (person) r.person_id = person;
    }
  }
}

/**
 * Whether the backup was made with creatures in it. Absent means older than
 * RFC-017: its creatures are derived from its accounts. Present, even empty,
 * means a family's own choice, taken as it is.
 */
export function backupHasCreatures(data: Record<string, unknown>): boolean {
  return Array.isArray(data.creatures);
}

/**
 * The creature's fields as they sat on a pocket-money account until RFC-017.
 * The columns are gone (migration_zzzzzzzz_pocket_money_creatures_out_zz_drop
 * .sql), so a backup that still carries them -- one made by 1.12, or by a 1.13
 * that kept them for one release -- must not try to insert them.
 */
export const OLD_ACCOUNT_CREATURE_COLUMNS = [
  "avatar_species",
  "avatar_style",
  "avatar_look",
  "best_tier",
  "last_seen_tier",
  "reward_mode",
] as const;

function stage(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(8, Math.max(1, Math.round(value))) : 1;
}

/**
 * The creatures a backup from before RFC-017 had, built from its accounts by
 * the rule the migration used for live installs
 * (migration_zzzzzzzz_pocket_money_creatures_out.sql, RFC-017 §3.3): one per
 * CHILD with an account -- a grown-up's account never showed a creature --
 * with the account's species (a dragon if none), style (classic if none),
 * look (an object, or {}), best_tier and last_seen_tier held to 1..8, growing
 * with points where reward_mode was 'points' and with money otherwise, the
 * shop on, and switched on unless the family had pocket money switched off.
 *
 * Ids are the backup's own; the import remaps person_id and family_id like
 * every other row, and its normalize step turns a style or a look this
 * release would refuse into classic or {}.
 */
export function creaturesFromOldAccounts(data: Record<string, unknown[] | undefined>): Record<string, unknown>[] {
  const children = new Set<string>();
  for (const p of data.people ?? []) {
    if (isRecord(p) && typeof p.id === "string" && p.is_child === true) children.add(p.id);
  }
  const pocketMoneyOff = (data.settings ?? []).some(
    (s) => isRecord(s) && s.key === "enabled_plugins" && isRecord(s.value) && s.value["pocket-money"] === false,
  );
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const a of data.pocket_money_accounts ?? []) {
    if (!isRecord(a) || typeof a.person_id !== "string") continue;
    if (!children.has(a.person_id) || seen.has(a.person_id)) continue;
    seen.add(a.person_id);
    out.push({
      person_id: a.person_id,
      family_id: a.family_id,
      species: typeof a.avatar_species === "string" ? a.avatar_species : "dragon",
      style: typeof a.avatar_style === "string" ? a.avatar_style : "classic",
      look: isRecord(a.avatar_look) ? a.avatar_look : {},
      best_tier: stage(a.best_tier),
      last_seen_tier: stage(a.last_seen_tier),
      grows_with: a.reward_mode === "points" ? "points" : "money",
      shop_enabled: true,
      enabled: !pocketMoneyOff,
    });
  }
  return out;
}

/**
 * Before the import: a backup without creatures (older than RFC-017) gets
 * them from its accounts; then every account loses the old creature fields,
 * whichever release wrote it. A backup that carries `creatures`, even empty,
 * keeps exactly those -- a child with an account and no creature there is a
 * child whose parent never switched one on.
 */
export function moveCreaturesOffOldAccounts(data: Record<string, unknown[] | undefined>): void {
  if (!backupHasCreatures(data)) data.creatures = creaturesFromOldAccounts(data);
  for (const a of data.pocket_money_accounts ?? []) {
    if (!isRecord(a)) continue;
    for (const column of OLD_ACCOUNT_CREATURE_COLUMNS) delete a[column];
  }
}
