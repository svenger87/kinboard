import { creatureChildren } from "@/lib/creatures/surfaces";

/**
 * The children the dashboard's pocket-money widget shows: every child with a
 * pocket-money account, in the accounts' order as before, then every child
 * whose creature grows with points but who has no account -- a child on
 * points alone still has a balance to show and activity to list. `account`
 * is null for those.
 */
export interface PocketMoneyChild<A> {
  personId: string;
  account: A | null;
}

export function pocketMoneyChildren<
  A extends { person_id: string },
  P extends { id: string; is_child?: boolean | null },
  C extends { person_id: string; enabled?: boolean | null },
>(
  accounts: readonly A[],
  people: readonly P[] | undefined,
  creatures: readonly C[] | undefined,
): PocketMoneyChild<A>[] {
  const out: PocketMoneyChild<A>[] = accounts.map((a) => ({ personId: a.person_id, account: a }));
  const seen = new Set(out.map((c) => c.personId));
  for (const { person } of creatureChildren(people, creatures)) {
    if (seen.has(person.id)) continue;
    seen.add(person.id);
    out.push({ personId: person.id, account: null });
  }
  return out;
}
