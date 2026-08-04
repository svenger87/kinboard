import { test, expect } from "@playwright/test";
import { mergeOperations } from "../src/lib/offline-db";
import type { OfflineQueueOperation } from "../src/types/offline";

/**
 * mergeOperations collapses several queued operations on one item into a
 * single request — three edits become one update, a create-then-delete
 * becomes nothing. The drain then removed only the id it was handed.
 *
 * So every row that had been merged away stayed in IndexedDB marked
 * "pending". The badge never cleared, however many times you synced, and
 * each later drain re-merged the leftovers and re-sent the request they had
 * already produced.
 *
 * These pin the contract the drain relies on: the merged operations, and the
 * rows that merged away to nothing, together account for every row in.
 */

let seq = 0;
const op = (
  type: OfflineQueueOperation["type"],
  serverId: string | undefined,
  payload: Record<string, unknown> = {},
  extra: Partial<OfflineQueueOperation> = {},
): OfflineQueueOperation => ({
  id: `op-${++seq}`,
  type,
  table: "shopping_items",
  timestamp: seq * 1000,
  familyId: "fam",
  data: { serverId, payload },
  retryCount: 0,
  status: "pending",
  ...extra,
});

/** Every row that went in must come out, once, in one list or the other. */
function accountsForEverything(input: OfflineQueueOperation[]) {
  const { operations, discarded } = mergeOperations(input);
  const covered = [...operations.flatMap((o) => o.mergedFrom ?? [o.id]), ...discarded];
  expect(covered.sort()).toEqual(input.map((o) => o.id).sort());
  return { operations, discarded };
}

test("three updates to one item merge into one, and name all three rows", () => {
  const input = [
    op("update", "item-1", { quantity: 1 }),
    op("update", "item-1", { quantity: 2 }),
    op("update", "item-1", { note: "ripe" }),
  ];
  const { operations, discarded } = accountsForEverything(input);

  expect(operations).toHaveLength(1);
  expect(discarded).toEqual([]);
  expect(operations[0].mergedFrom).toHaveLength(3);
  // Last write wins, other keys survive.
  expect(operations[0].data.payload).toEqual({ quantity: 2, note: "ripe" });
});

test("create then delete sends nothing but still clears both rows", () => {
  // This is the case that stuck hardest: nothing is sent, so nothing was
  // ever removed, and two rows sat pending for good.
  const input = [op("create", undefined, { name: "milk" }), op("delete", undefined)];
  input[1].data.localId = input[0].data.localId = "local-1";

  const { operations, discarded } = accountsForEverything(input);
  expect(operations).toEqual([]);
  expect(discarded).toHaveLength(2);
});

test("create plus updates merges into one create naming every row", () => {
  const input = [
    op("create", undefined, { name: "milk" }),
    op("update", undefined, { quantity: 2 }),
  ];
  input.forEach((o) => (o.data.localId = "local-2"));

  const { operations } = accountsForEverything(input);
  expect(operations).toHaveLength(1);
  expect(operations[0].type).toBe("create");
  expect(operations[0].data.payload).toEqual({ name: "milk", quantity: 2 });
  expect(operations[0].mergedFrom).toHaveLength(2);
});

test("a lone operation names itself, so the drain has one code path", () => {
  const { operations } = accountsForEverything([op("update", "item-9", { x: 1 })]);
  expect(operations[0].mergedFrom).toEqual([operations[0].id]);
});

test("delete after updates keeps the delete and names all the rows", () => {
  const input = [
    op("update", "item-3", { quantity: 5 }),
    op("update", "item-3", { quantity: 6 }),
    op("delete", "item-3"),
  ];
  const { operations } = accountsForEverything(input);
  expect(operations).toHaveLength(1);
  expect(operations[0].type).toBe("delete");
  expect(operations[0].mergedFrom).toHaveLength(3);
});

test("unrelated items stay separate", () => {
  const input = [
    op("update", "item-a", { q: 1 }),
    op("update", "item-b", { q: 2 }),
    op("update", "item-a", { q: 3 }),
  ];
  const { operations } = accountsForEverything(input);
  expect(operations).toHaveLength(2);
});

test("an empty queue is empty", () => {
  const { operations, discarded } = mergeOperations([]);
  expect(operations).toEqual([]);
  expect(discarded).toEqual([]);
});

test("a mixed queue leaves nothing behind", () => {
  // The realistic case: a few items touched in different ways in one
  // offline session. Under the old code this left five orphans.
  const create = op("create", undefined, { name: "bread" });
  create.data.localId = "local-3";
  const createUpdate = op("update", undefined, { quantity: 2 });
  createUpdate.data.localId = "local-3";

  const gone = op("create", undefined, { name: "typo" });
  gone.data.localId = "local-4";
  const goneDelete = op("delete", undefined);
  goneDelete.data.localId = "local-4";

  const input = [
    create,
    createUpdate,
    gone,
    goneDelete,
    op("update", "item-x", { q: 1 }),
    op("update", "item-x", { q: 2 }),
    op("delete", "item-y"),
  ];

  const { operations, discarded } = accountsForEverything(input);
  expect(operations).toHaveLength(3); // the create, the merged update, the delete
  expect(discarded).toHaveLength(2); // the create-then-delete pair
});
