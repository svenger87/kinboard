import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { pointHistory } from "../src/lib/pocket-money/point-history";
import { pocketMoneyChildren } from "../src/lib/pocket-money/widget-children";
import { DEFAULT_POCKET_MONEY_WIDGET_SETTINGS } from "../src/types/widgets";

/**
 * #470: the dashboard's pocket-money widget shows every child, not one at a
 * time behind a switcher, and can list each child's latest activity.
 *
 * Two things are easy to get wrong:
 *
 *   - Which children it shows. A child whose creature grows with points may
 *     have no pocket-money account at all; listing only accounts leaves them
 *     off the widget although they have a balance.
 *   - What "latest activity" means for a child on points. Points have no
 *     ledger: the balance is computed from task awards, a parent's
 *     adjustments, approved reward requests and shop purchases, so the
 *     history has to be merged from all four, and a pending or denied
 *     request has not moved the balance.
 */

const people = [
  { id: "mia", name: "Mia", is_child: true },
  { id: "ben", name: "Ben", is_child: true },
  { id: "lina", name: "Lina", is_child: true },
  { id: "mum", name: "Mum", is_child: false },
];

test("children with an account come first, in the accounts' order", () => {
  const accounts = [{ id: "a2", person_id: "ben" }, { id: "a1", person_id: "mia" }];
  expect(pocketMoneyChildren(accounts, people, []).map((c) => c.personId)).toEqual(["ben", "mia"]);
});

test("a child on points without an account is shown too", () => {
  const accounts = [{ id: "a1", person_id: "mia" }];
  const creatures = [{ person_id: "lina", enabled: true }];
  const children = pocketMoneyChildren(accounts, people, creatures);
  expect(children.map((c) => c.personId)).toEqual(["mia", "lina"]);
  expect(children[1].account).toBeNull();
});

test("a child with both an account and a creature is listed once", () => {
  const accounts = [{ id: "a1", person_id: "mia" }];
  const creatures = [{ person_id: "mia", enabled: true }];
  expect(pocketMoneyChildren(accounts, people, creatures).map((c) => c.personId)).toEqual(["mia"]);
});

test("a switched-off creature or a grown-up's does not add a child", () => {
  const creatures = [
    { person_id: "lina", enabled: false },
    { person_id: "mum", enabled: true },
  ];
  expect(pocketMoneyChildren([], people, creatures)).toEqual([]);
});

const award = (id: string, at: string, points: number, extra: Partial<{ kind: "task" | "adjustment"; note: string; todo_id: string; person_id: string }> = {}) => ({
  id,
  person_id: "lina",
  points,
  kind: "task" as const,
  note: null,
  todo_id: null,
  created_at: at,
  ...extra,
});

test("point history merges awards, adjustments, approved rewards and purchases, newest first", () => {
  const entries = pointHistory({
    personId: "lina",
    awards: [
      award("t1", "2026-11-10T08:00:00Z", 5, { todo_id: "todo-1" }),
      award("adj", "2026-11-12T08:00:00Z", -3, { kind: "adjustment", note: "Streit" }),
    ],
    redemptions: [
      { id: "r1", person_id: "lina", title: "Kino", cost_points: 20, status: "approved", decided_at: "2026-11-13T08:00:00Z", created_at: "2026-11-09T08:00:00Z" },
    ],
    purchases: [{ id: "p1", person_id: "lina", item_id: "cap", cost: 10, created_at: "2026-11-11T08:00:00Z" }],
    limit: 10,
  });
  expect(entries.map((e) => [e.kind, e.points])).toEqual([
    ["reward", -20],
    ["adjustment", -3],
    ["shop", -10],
    ["task", 5],
  ]);
});

test("a reward counts when it was approved, not when it was asked for", () => {
  const entries = pointHistory({
    personId: "lina",
    awards: [award("t1", "2026-11-10T08:00:00Z", 5)],
    redemptions: [
      { id: "r1", person_id: "lina", title: "Kino", cost_points: 20, status: "approved", decided_at: "2026-11-11T08:00:00Z", created_at: "2026-11-01T08:00:00Z" },
    ],
    purchases: [],
    limit: 10,
  });
  expect(entries[0].kind).toBe("reward");
});

test("pending and denied requests are left out, and so is another child's activity", () => {
  const entries = pointHistory({
    personId: "lina",
    awards: [award("t1", "2026-11-10T08:00:00Z", 5, { person_id: "mia" })],
    redemptions: [
      { id: "r1", person_id: "lina", title: "Kino", cost_points: 20, status: "pending", decided_at: null, created_at: "2026-11-11T08:00:00Z" },
      { id: "r2", person_id: "lina", title: "Eis", cost_points: 5, status: "denied", decided_at: "2026-11-12T08:00:00Z", created_at: "2026-11-11T08:00:00Z" },
    ],
    purchases: [{ id: "p1", person_id: "mia", item_id: "cap", cost: 10, created_at: "2026-11-11T08:00:00Z" }],
    limit: 10,
  });
  expect(entries).toEqual([]);
});

test("the history stops at the limit, and 0 means off", () => {
  const awards = [1, 2, 3, 4, 5].map((d) => award(`t${d}`, `2026-11-0${d}T08:00:00Z`, d));
  const args = { personId: "lina", awards, redemptions: [], purchases: [] };
  expect(pointHistory({ ...args, limit: 3 }).map((e) => e.points)).toEqual([5, 4, 3]);
  expect(pointHistory({ ...args, limit: 0 })).toEqual([]);
});

test("the defaults keep the widget as it was: one child at a time, no list", () => {
  // An update must not change a family's dashboard by itself, nor put
  // transaction notes on a shared wall screen nobody asked for.
  expect(DEFAULT_POCKET_MONEY_WIDGET_SETTINGS).toEqual({ displayMode: "toggle", recentTransactions: 0 });
});

test("a child on points lists point activity, not money transactions", () => {
  const src = readFileSync("src/components/widgets/pocket-money-widget.tsx", "utf8");
  expect(src).toMatch(/pointsMode \? \(\s*<RecentPoints /);
});
