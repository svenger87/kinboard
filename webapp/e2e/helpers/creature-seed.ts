/**
 * A child's creature (RFC-017) for a spec that works in the stack's real
 * family: switched on with the fields the spec needs, and put back exactly as
 * it was afterwards -- or removed, when the child had none.
 */

type Psql = (sql: string) => string;

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

export interface CreatureSeed {
  /** UPDATE creatures SET <set> for this child. */
  set: (assignments: string) => void;
  /** Put the row back as it was before the spec. */
  restore: () => void;
}

export function seedCreature(psql: Psql, familyId: string, personId: string, fields: Record<string, string | number | boolean>): CreatureSeed {
  const before = psql(`SELECT to_jsonb(c)::text FROM creatures c WHERE person_id = ${lit(personId)}`);
  psql(`INSERT INTO creatures (person_id, family_id) VALUES (${lit(personId)}, ${lit(familyId)}) ON CONFLICT (person_id) DO NOTHING`);
  const assignments = Object.entries({ enabled: true, ...fields })
    .map(([k, v]) => `${k} = ${typeof v === "string" ? lit(v) : String(v)}`)
    .join(", ");
  psql(`UPDATE creatures SET ${assignments} WHERE person_id = ${lit(personId)}`);
  return {
    set: (a) => psql(`UPDATE creatures SET ${a} WHERE person_id = ${lit(personId)}`),
    restore: () => {
      if (!before) {
        psql(`DELETE FROM creatures WHERE person_id = ${lit(personId)}`);
        return;
      }
      // best_tier only climbs: lower it past the trigger by replacing the row.
      psql(`DELETE FROM creatures WHERE person_id = ${lit(personId)};
        INSERT INTO creatures SELECT * FROM jsonb_populate_record(NULL::creatures, ${lit(before)}::jsonb)`);
    },
  };
}
