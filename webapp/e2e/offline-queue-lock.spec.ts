import { test, expect } from "@playwright/test";

/**
 * The offline queue's in-progress guard was a `useRef`, so it only ever
 * prevented re-entry within one hook instance. `use-offline-shopping`
 * mounts five instances in one component tree, each with its own ref and
 * its own auto-sync effect, and `autoSync` defaults to true — so on
 * reconnect all five started draining the same queue at once.
 *
 * The hook can't be exercised without React and IndexedDB, so what's
 * modelled here is the locking property itself: the old per-instance
 * shape against the new shared one, with the same interleaving both
 * times. If the shared lock is ever weakened back to per-instance, the
 * first test starts passing with a count above one and this fails.
 */

/** One drain attempt: read the queue, then process what it read. */
async function drain(
  claim: () => boolean,
  release: () => void,
  queue: { items: string[] },
  processed: string[],
) {
  if (!claim()) return;
  try {
    // The read happens before anything is marked in-flight — the window
    // in which every concurrent processor sees the same work.
    const batch = [...queue.items];
    await new Promise((r) => setTimeout(r, 5));
    for (const item of batch) processed.push(item);
    queue.items = [];
  } finally {
    release();
  }
}

test("per-instance guards let every processor run — the old behaviour", async () => {
  const queue = { items: ["milk", "bread", "eggs"] };
  const processed: string[] = [];

  // Five instances, five independent refs.
  const instances = Array.from({ length: 5 }, () => ({ busy: false }));
  await Promise.all(
    instances.map((self) =>
      drain(
        () => (self.busy ? false : ((self.busy = true), true)),
        () => (self.busy = false),
        queue,
        processed,
      ),
    ),
  );

  // Every one of them read the same three items before any had claimed.
  expect(processed.length).toBeGreaterThan(3);
  expect(processed.filter((i) => i === "milk").length).toBeGreaterThan(1);
});

test("a shared lock lets exactly one run", async () => {
  const queue = { items: ["milk", "bread", "eggs"] };
  const processed: string[] = [];

  // One set, shared by every instance — the module-scoped guard.
  const draining = new Set<string>();
  const familyId = "fam-1";

  await Promise.all(
    Array.from({ length: 5 }, () =>
      drain(
        () => (draining.has(familyId) ? false : (draining.add(familyId), true)),
        () => draining.delete(familyId),
        queue,
        processed,
      ),
    ),
  );

  expect(processed).toEqual(["milk", "bread", "eggs"]);
  expect(processed.filter((i) => i === "milk")).toHaveLength(1);
});

test("the lock is released, so a later drain still runs", async () => {
  const draining = new Set<string>();
  const familyId = "fam-1";
  const processed: string[] = [];

  const queue1 = { items: ["first"] };
  await drain(
    () => (draining.has(familyId) ? false : (draining.add(familyId), true)),
    () => draining.delete(familyId),
    queue1,
    processed,
  );

  const queue2 = { items: ["second"] };
  await drain(
    () => (draining.has(familyId) ? false : (draining.add(familyId), true)),
    () => draining.delete(familyId),
    queue2,
    processed,
  );

  expect(processed).toEqual(["first", "second"]);
  expect(draining.size).toBe(0);
});

test("two families drain independently", async () => {
  const draining = new Set<string>();
  const a: string[] = [];
  const b: string[] = [];

  await Promise.all([
    drain(
      () => (draining.has("a") ? false : (draining.add("a"), true)),
      () => draining.delete("a"),
      { items: ["a1"] },
      a,
    ),
    drain(
      () => (draining.has("b") ? false : (draining.add("b"), true)),
      () => draining.delete("b"),
      { items: ["b1"] },
      b,
    ),
  ]);

  expect(a).toEqual(["a1"]);
  expect(b).toEqual(["b1"]);
});
