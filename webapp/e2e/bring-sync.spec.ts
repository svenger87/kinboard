import { test, expect } from "@playwright/test";
import {
  planBringSync,
  syncBringFamily,
  type BringSyncDeps,
  type BringSyncPatch,
  type SyncShoppingRow,
} from "../src/lib/bring-sync";
import { BringAuthError, getBringList, removeBringListItem, addBringListItem, type BringListItem, type ServerBringSettings } from "../src/lib/bring-server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * #407: Bring! sync only pushed. Items added in the Bring! app never reached
 * Kinboard's shopping list, and items bought there stayed open. The plan
 * below is the reconcile, as a pure function of the two lists; the network
 * and the database are injected, so none of this needs either.
 */

let seq = 0;
const row = (over: Partial<SyncShoppingRow>): SyncShoppingRow => ({
  id: `row-${++seq}`,
  name: "",
  checked: false,
  bring_item_id: null,
  bring_checked: null,
  quantity: null,
  unit: null,
  ...over,
});
const item = (name: string, specification = ""): BringListItem => ({ name, specification });
const patchOf = (plan: ReturnType<typeof planBringSync>, id: string) =>
  plan.updates.find((u) => u.id === id)?.patch;

test.describe("Bring! → Kinboard", () => {
  test("an item added in the Bring! app appears on the shopping list", () => {
    const plan = planBringSync({ purchase: [item("Milch"), item("Äpfel", "1 kg")], rows: [], push: true });
    expect(plan.inserts).toEqual([
      { name: "Milch", bring_item_id: "Milch", quantity: null, unit: null, notes: null },
      { name: "Äpfel", bring_item_id: "Äpfel", quantity: 1, unit: "kg", notes: null },
    ]);
    expect(plan.bringAdd).toEqual([]);
    expect(plan.bringRemove).toEqual([]);
  });

  test("a specification that is not an amount is kept as a note", () => {
    const plan = planBringSync({ purchase: [item("Brot", "vom Bäcker")], rows: [], push: true });
    expect(plan.inserts[0]).toMatchObject({ quantity: null, unit: null, notes: "vom Bäcker" });
  });

  test("it is shown in the family's language but keeps the Bring! key", () => {
    const plan = planBringSync({
      purchase: [item("Milch")],
      rows: [],
      translations: new Map([["Milch", "Milk"]]),
      push: true,
    });
    expect(plan.inserts[0]).toMatchObject({ name: "Milk", bring_item_id: "Milch" });
  });

  test("an item bought in the Bring! app is ticked off", () => {
    const milk = row({ name: "Milk", bring_item_id: "Milch", bring_checked: false });
    const plan = planBringSync({ purchase: [], rows: [milk], push: true });
    expect(patchOf(plan, milk.id)).toEqual({ checked: true, bring_checked: true });
    expect(plan.bringAdd).toEqual([]);
  });

  test("a bought item put back on the list in the app comes back, once", () => {
    const old = row({ name: "Milch", checked: true, bring_item_id: "Milch", bring_checked: true });
    const latest = row({ name: "Milch", checked: true, bring_item_id: "Milch", bring_checked: true });
    const plan = planBringSync({ purchase: [item("Milch")], rows: [old, latest], push: true });
    expect(patchOf(plan, latest.id)).toEqual({ checked: false, bring_checked: false });
    expect(patchOf(plan, old.id)).toBeUndefined();
    expect(plan.inserts).toEqual([]);
  });

  test("nothing changes when both sides agree", () => {
    const plan = planBringSync({
      purchase: [item("Milch")],
      rows: [
        row({ name: "Milch", bring_item_id: "Milch", bring_checked: false }),
        row({ name: "Brot", checked: true, bring_item_id: "Brot", bring_checked: true }),
      ],
      push: true,
    });
    expect(plan).toEqual({ inserts: [], bringAdd: [], bringRemove: [], updates: [] });
  });

  test("an item already on both lists is linked rather than added twice", () => {
    const milk = row({ name: "milch" });
    const plan = planBringSync({ purchase: [item("Milch")], rows: [milk], push: true });
    expect(plan.inserts).toEqual([]);
    expect(patchOf(plan, milk.id)).toEqual({ bring_item_id: "Milch", bring_checked: false });
  });

  test("a Kinboard item in the family's language matches its Bring! key", () => {
    const milk = row({ name: "Milk" });
    const plan = planBringSync({
      purchase: [item("Milch")],
      rows: [milk],
      translations: new Map([["Milch", "Milk"]]),
      push: true,
    });
    expect(plan.inserts).toEqual([]);
    expect(patchOf(plan, milk.id)).toEqual({ bring_item_id: "Milch", bring_checked: false });
  });

  test("an item pushed under its translated name is the same item, not a second one", () => {
    // The shopping page pushes what was typed, "Milk", which Bring! keeps as
    // a custom item next to the catalogue's "Milch".
    const milk = row({ name: "Milk" });
    const plan = planBringSync({
      purchase: [item("Milk")],
      rows: [milk],
      translations: new Map([["Milch", "Milk"]]),
      push: true,
    });
    expect(plan.inserts).toEqual([]);
    expect(plan.bringAdd).toEqual([]);
    expect(patchOf(plan, milk.id)).toEqual({ bring_item_id: "Milk", bring_checked: false });
  });
});

test.describe("Kinboard → Bring!", () => {
  test("an item that never reached Bring! is pushed, under its Bring! key", () => {
    const milk = row({ name: "Milk", quantity: 2, unit: "l" });
    const plan = planBringSync({
      purchase: [],
      rows: [milk],
      translations: new Map([["Milch", "Milk"]]),
      push: true,
    });
    expect(plan.bringAdd).toEqual([{ name: "Milch", specification: "2 l" }]);
    expect(patchOf(plan, milk.id)).toEqual({ bring_item_id: "Milch", bring_checked: false });
  });

  test("a tick from any screen is sent to Bring!, not undone", () => {
    // Ticked in the shop mode or by an assistant: Bring! was never told.
    const milk = row({ name: "Milch", checked: true, bring_item_id: "Milch", bring_checked: false });
    const plan = planBringSync({ purchase: [item("Milch")], rows: [milk], push: true });
    expect(plan.bringRemove).toEqual(["Milch"]);
    expect(patchOf(plan, milk.id)).toEqual({ bring_checked: true });
  });

  test("an untick in Kinboard puts the item back on Bring!", () => {
    const milk = row({ name: "Milch", checked: false, bring_item_id: "Milch", bring_checked: true });
    const plan = planBringSync({ purchase: [], rows: [milk], push: true });
    expect(plan.bringAdd).toEqual([{ name: "Milch", specification: undefined }]);
    expect(patchOf(plan, milk.id)).toEqual({ bring_checked: false });
  });

  test("an open item deleted in Kinboard is taken off Bring!, not read back in", () => {
    const plan = planBringSync({ purchase: [item("Milch")], rows: [], removed: ["Milch"], push: true });
    expect(plan.inserts).toEqual([]);
    expect(plan.bringRemove).toEqual(["Milch"]);
  });

  test("a deletion does not bring an older ticked copy back", () => {
    const old = row({ name: "Milch", checked: true, bring_item_id: "Milch", bring_checked: true });
    const plan = planBringSync({ purchase: [item("Milch")], rows: [old], removed: ["Milch"], push: true });
    expect(plan.bringRemove).toEqual(["Milch"]);
    expect(patchOf(plan, old.id)).toBeUndefined();
  });
});

test.describe("two-way sync off: Kinboard mirrors Bring!", () => {
  test("nothing is pushed, and Bring! wins a disagreement", () => {
    const local = row({ name: "Kinboard only" });
    const ticked = row({ name: "Milch", checked: true, bring_item_id: "Milch", bring_checked: false });
    const plan = planBringSync({ purchase: [item("Milch")], rows: [local, ticked], removed: ["Brot"], push: false });
    expect(plan.bringAdd).toEqual([]);
    expect(plan.bringRemove).toEqual([]);
    expect(patchOf(plan, local.id)).toBeUndefined();
    expect(patchOf(plan, ticked.id)).toEqual({ checked: false });
  });
});

test.describe("applying a plan", () => {
  function fakeDeps(over: {
    settings?: ServerBringSettings | null;
    purchase?: BringListItem[];
    rows?: SyncShoppingRow[];
    removals?: { id: number; bring_item_id: string; bring_list_id?: string | null }[];
    failAdd?: boolean;
  }) {
    const calls = {
      adds: [] as string[],
      removes: [] as string[],
      inserts: [] as unknown[],
      updates: [] as { id: string; patch: BringSyncPatch }[],
      cleared: [] as number[],
    };
    const deps: BringSyncDeps = {
      loadSettings: async () =>
        over.settings === undefined
          ? { credentials: { accessToken: "token" }, selectedListId: "list-1" }
          : over.settings,
      withAccess: async (_familyId, settings, call) => {
        if (!settings?.credentials?.accessToken) throw new BringAuthError();
        return call(settings.credentials.accessToken);
      },
      getList: async ({ listId }) => ({ uuid: listId, purchase: over.purchase ?? [], recently: [] }),
      add: async ({ itemName }) => {
        if (over.failAdd) throw new Error("Bring! is down");
        calls.adds.push(itemName);
      },
      remove: async ({ itemName }) => {
        calls.removes.push(itemName);
      },
      translations: async () => new Map(),
      category: async () => "milchprodukte",
      rows: async () => over.rows ?? [],
      removals: async () => over.removals ?? [],
      clearRemovals: async (_familyId, ids) => {
        calls.cleared.push(...ids);
      },
      insert: async (_familyId, rows) => {
        calls.inserts.push(...rows);
      },
      update: async (_familyId, id, patch) => {
        calls.updates.push({ id, patch });
      },
    };
    return { deps, calls };
  }

  test("not connected or no list: nothing happens", async () => {
    expect(await syncBringFamily("fam-a", fakeDeps({ settings: null }).deps)).toEqual({
      status: "skipped",
      reason: "not_connected",
    });
    expect(
      await syncBringFamily("fam-b", fakeDeps({ settings: { credentials: { accessToken: "t" }, selectedListId: null } }).deps),
    ).toEqual({ status: "skipped", reason: "no_list" });
  });

  test("new Bring! items are inserted with a category, removals cleared", async () => {
    const { deps, calls } = fakeDeps({
      purchase: [item("Milch")],
      removals: [{ id: 7, bring_item_id: "Brot" }],
    });
    const outcome = await syncBringFamily("fam-c", deps);
    expect(outcome).toEqual({ status: "synced", added: 1, updated: 0, pushed: 0, removed: 0 });
    expect(calls.inserts).toEqual([
      { name: "Milch", bring_item_id: "Milch", quantity: null, unit: null, notes: null, category: "milchprodukte", bring_list_id: "list-1" },
    ]);
    expect(calls.cleared).toEqual([7]);
  });

  test("a failed push changes no row, so the next sync tries again", async () => {
    const { deps, calls } = fakeDeps({ rows: [row({ name: "Brot" })], failAdd: true });
    await expect(syncBringFamily("fam-d", deps)).rejects.toThrow("Bring! is down");
    expect(calls.updates).toEqual([]);
  });

  test("an item gone from the same list was bought there and is ticked off", async () => {
    const milk = row({ name: "Milch", bring_item_id: "Milch", bring_checked: false, bring_list_id: "list-1" });
    const { deps, calls } = fakeDeps({ rows: [milk], settings: { credentials: { accessToken: "t" }, selectedListId: "list-1", twoWaySync: false } });
    await syncBringFamily("fam-f", deps);
    expect(calls.updates).toEqual([{ id: milk.id, patch: { checked: true, bring_checked: true } }]);
  });

  test("after switching to another Bring! list, nothing is ticked off for not being on it", async () => {
    // Linked to the old list; the new one is empty. One-way: left alone.
    const rows = [
      row({ name: "Milch", bring_item_id: "Milch", bring_checked: false, bring_list_id: "list-old" }),
      row({ name: "Brot", bring_item_id: "Brot", bring_checked: false, bring_list_id: null }),
    ];
    const oneWay = fakeDeps({ rows, settings: { credentials: { accessToken: "t" }, selectedListId: "list-1", twoWaySync: false } });
    await syncBringFamily("fam-g", oneWay.deps);
    expect(oneWay.calls.updates).toEqual([]);

    // Two-way: they go onto the new list and are linked to it.
    const twoWay = fakeDeps({ rows });
    await syncBringFamily("fam-h", twoWay.deps);
    expect(twoWay.calls.adds.sort()).toEqual(["Brot", "Milch"]);
    for (const update of twoWay.calls.updates) {
      expect(update.patch).toEqual({ bring_item_id: expect.any(String), bring_checked: false, bring_list_id: "list-1" });
    }
    expect(twoWay.calls.updates).toHaveLength(2);
  });

  test("a deletion recorded against another list is not taken off this one", async () => {
    const ticked = row({ name: "Milch", checked: true, bring_item_id: "Milch", bring_checked: true, bring_list_id: "list-1" });
    const { deps, calls } = fakeDeps({
      purchase: [item("Milch")],
      rows: [ticked],
      removals: [{ id: 9, bring_item_id: "Milch", bring_list_id: "list-old" }],
    });
    await syncBringFamily("fam-i", deps);
    expect(calls.removes).toEqual([]);
    expect(calls.cleared).toEqual([9]);
  });

  test("two syncs of one family run one after the other", async () => {
    let concurrent = 0;
    let peak = 0;
    const { deps } = fakeDeps({ purchase: [item("Milch")] });
    const slowRows = deps.rows;
    deps.rows = async (familyId) => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 20));
      concurrent--;
      return slowRows(familyId);
    };
    await Promise.all([syncBringFamily("fam-e", deps), syncBringFamily("fam-e", deps)]);
    expect(peak).toBe(1);
  });
});

test.describe("list ids", () => {
  test("a list id that is not a Bring! id is refused before any request", async () => {
    // The routes take listId from the request and it goes into the URL path.
    for (const listId of ["../bringusers/x/lists", "a/b", "", "id?x=1"]) {
      await expect(getBringList({ accessToken: "t", listId })).rejects.toThrow("Invalid Bring! list id");
      await expect(removeBringListItem({ accessToken: "t", listId, itemName: "Milch" })).rejects.toThrow("Invalid Bring! list id");
      await expect(addBringListItem({ accessToken: "t", listId, itemName: "Milch" })).rejects.toThrow("Invalid Bring! list id");
    }
  });
});

test.describe("wiring", () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, "..", ...parts), "utf8");

  test("ofelia runs the pull every two minutes", () => {
    expect(read("docker", "docker-compose.yml")).toContain('ofelia.job-exec.sync-bring.schedule: "@every 2m"');
    expect(read("docker", "Dockerfile")).toContain("http://localhost:3000/api/cron/sync-bring");
  });

  test("the shopping page ticks and deletes on Bring! under the Bring! key", () => {
    const page = read("src", "app", "shopping", "page.tsx");
    expect(page).not.toContain("itemName: item.name,");
    expect(page).toContain("itemName: bringItemName(item),");
  });

  test("deletions are recorded by a trigger, for every path that deletes", () => {
    const sql = read("docker", "migration_bring_pull_sync.sql");
    expect(sql).toContain("AFTER DELETE ON public.shopping_items");
    expect(sql).toContain("WHEN (OLD.bring_item_id IS NOT NULL AND OLD.checked IS NOT TRUE)");
  });
});
