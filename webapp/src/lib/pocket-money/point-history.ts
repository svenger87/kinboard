/**
 * A child's recent point activity, newest first, for the pocket-money
 * widget's list under a child whose creature grows with points. Points have
 * no ledger of their own: the balance is computed (usePointTotals) from the
 * task awards and a parent's adjustments (both in todo_point_awards), the
 * approved reward requests and the shop purchases, so the history is merged
 * from the same sources. A pending request has not moved the balance yet and
 * a denied one never will, so neither is listed.
 */

export type PointHistoryEntry =
  | { id: string; at: string; points: number; kind: "task"; todoId: string | null }
  | { id: string; at: string; points: number; kind: "adjustment"; note: string | null }
  | { id: string; at: string; points: number; kind: "reward"; title: string }
  | { id: string; at: string; points: number; kind: "shop"; itemId: string };

interface AwardLike {
  id: string;
  person_id: string;
  points: number;
  kind: "task" | "adjustment";
  note: string | null;
  todo_id: string | null;
  created_at: string;
}

interface RedemptionLike {
  id: string;
  person_id: string;
  title: string;
  cost_points: number;
  status: "pending" | "approved" | "denied";
  decided_at: string | null;
  created_at: string;
}

interface PurchaseLike {
  id: string;
  person_id: string;
  item_id: string;
  cost: number;
  created_at: string;
}

export function pointHistory(args: {
  personId: string;
  awards: readonly AwardLike[];
  redemptions: readonly RedemptionLike[];
  purchases: readonly PurchaseLike[];
  limit: number;
}): PointHistoryEntry[] {
  const { personId, limit } = args;
  if (limit <= 0) return [];
  const out: PointHistoryEntry[] = [];
  for (const a of args.awards) {
    if (a.person_id !== personId) continue;
    out.push(
      a.kind === "adjustment"
        ? { id: `a-${a.id}`, at: a.created_at, points: a.points, kind: "adjustment", note: a.note }
        : { id: `a-${a.id}`, at: a.created_at, points: a.points, kind: "task", todoId: a.todo_id },
    );
  }
  for (const r of args.redemptions) {
    if (r.person_id !== personId || r.status !== "approved") continue;
    // Spent when a parent approved it, not when the child asked.
    out.push({ id: `r-${r.id}`, at: r.decided_at ?? r.created_at, points: -r.cost_points, kind: "reward", title: r.title });
  }
  for (const p of args.purchases) {
    if (p.person_id !== personId) continue;
    out.push({ id: `p-${p.id}`, at: p.created_at, points: -p.cost, kind: "shop", itemId: p.item_id });
  }
  // Timestamps from Postgres all carry the same offset, but compare instants
  // rather than strings so a mixed format cannot reorder the list.
  out.sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  return out.slice(0, limit);
}
