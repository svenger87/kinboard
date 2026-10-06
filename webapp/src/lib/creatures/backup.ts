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
