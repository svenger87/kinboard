import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { addAdjustment, isAdjustment, removeAdjustment, MAX_ADJUSTMENT } from "../src/lib/creatures/adjustments";
import { pointTotals } from "../src/lib/pocket-money/points";
import { pointsTotal } from "../src/lib/todo-points";
import type { RpcClient } from "../src/lib/pocket-money/booking";
import { codeOnly } from "./source-helpers";

/**
 * A parent adds or removes a child's points by hand (discussion #349). The
 * adjustments are rows of todo_point_awards (kind 'adjustment'), so every
 * total counts them with no change; point-adjustments-db.spec.ts runs the SQL.
 */

const read = (file: string) => readFileSync(join(__dirname, "..", file), "utf8");
const FAMILY = "f0000000-0000-4000-8000-000000000001";
const KID = "f0000000-0000-4000-8000-0000000000a1";
const ADJ = "f0000000-0000-4000-8000-0000000000d1";

function fakeRpc(answer: unknown, error: { message: string } | null = null) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client: RpcClient = {
    rpc: (fn, args) => {
      calls.push({ fn, args });
      return Promise.resolve({ data: answer, error });
    },
  };
  return { client, calls };
}

test("an adjustment is a whole number of points, not zero, within the table's limit", () => {
  for (const ok of [1, -1, 50, -10, MAX_ADJUSTMENT, -MAX_ADJUSTMENT]) expect(isAdjustment(ok), String(ok)).toBe(true);
  for (const bad of [0, 1.5, MAX_ADJUSTMENT + 1, -MAX_ADJUSTMENT - 1, "5", null, Number.NaN]) {
    expect(isAdjustment(bad), String(bad)).toBe(false);
  }
});

test("adding one passes the family from the session, the points and a trimmed note", async () => {
  const { client, calls } = fakeRpc({ ok: true, adjustment: { id: ADJ, points: 5 }, balance: 15 });
  const answer = await addAdjustment(client, { familyId: FAMILY, personId: KID, points: 5, note: "  Helped wash the car  " });
  expect(answer).toEqual({ status: 201, body: { adjustment: { id: ADJ, points: 5 }, balance: 15 } });
  expect(calls).toEqual([{ fn: "adjust_person_points", args: { p_family_id: FAMILY, p_person_id: KID, p_points: 5, p_note: "Helped wash the car" } }]);
});

test("a correction is a negative number; an empty note is no note", async () => {
  const { client, calls } = fakeRpc({ ok: true, adjustment: {}, balance: 0 });
  await addAdjustment(client, { familyId: FAMILY, personId: KID, points: -9, note: "   " });
  expect(calls[0].args).toMatchObject({ p_points: -9, p_note: null });
});

test("what is refused before the database is asked, and how its refusals read", async () => {
  const none = fakeRpc(null);
  expect((await addAdjustment(none.client, { familyId: FAMILY, personId: "not-a-uuid", points: 5, note: null })).status).toBe(404);
  expect((await addAdjustment(none.client, { familyId: FAMILY, personId: KID, points: 0, note: null })).body).toEqual({ error: "invalid_points" });
  expect((await addAdjustment(none.client, { familyId: FAMILY, personId: KID, points: 5, note: 42 })).body).toEqual({ error: "invalid_note" });
  expect(none.calls).toHaveLength(0);

  const notFound = fakeRpc({ ok: false, error: "not_found" });
  expect((await addAdjustment(notFound.client, { familyId: FAMILY, personId: KID, points: 5, note: null })).status).toBe(404);
  const broken = fakeRpc(null, { message: "boom" });
  expect((await addAdjustment(broken.client, { familyId: FAMILY, personId: KID, points: 5, note: null })).status).toBe(500);
});

test("taking one back names only the adjustment and the session's family", async () => {
  const { client, calls } = fakeRpc({ ok: true, removed: { id: ADJ }, balance: 10 });
  expect(await removeAdjustment(client, { familyId: FAMILY, adjustmentId: ADJ })).toEqual({ status: 200, body: { removed: { id: ADJ }, balance: 10 } });
  expect(calls).toEqual([{ fn: "remove_person_point_adjustment", args: { p_family_id: FAMILY, p_adjustment_id: ADJ } }]);
  expect((await removeAdjustment(fakeRpc({ ok: false, error: "not_found" }).client, { familyId: FAMILY, adjustmentId: ADJ })).status).toBe(404);
  expect((await removeAdjustment(fakeRpc(null).client, { familyId: FAMILY, adjustmentId: "x" })).status).toBe(404);
});

test("an adjustment counts in the totals like task points, and a correction past what was spent is owed", () => {
  // 60 from tasks, a 50-point hat bought, then a 30-point correction and a 5-point bonus.
  const awards = [
    { person_id: "kid", points: 60 },
    { person_id: "kid", points: -30 },
    { person_id: "kid", points: 5 },
  ];
  const earned = pointsTotal(awards, "kid");
  expect(earned).toBe(35);
  expect(pointTotals(earned, [], [{ cost: 50 }])).toMatchObject({ earned: 35, purchased: 50, balance: 0, owed: 15, available: 0 });
  // The same numbers as point_person_totals() in the database spec.
});

test("both routes are behind the session and the settings PIN, and take the family from the session", () => {
  for (const file of ["src/app/api/points/adjustments/route.ts", "src/app/api/points/adjustments/[id]/route.ts"]) {
    const route = codeOnly(read(file));
    expect(route, file).toMatch(/const auth = await requireSession\(request\);\s*if \(!auth\.ok\) return auth\.response;/);
    expect(route, file).toMatch(/const locked = await requireSettingsUnlock\(auth\.session\);\s*if \(locked\) return locked;/);
    expect(route, file).toContain("familyId: auth.session.familyId");
    expect(route, file).not.toMatch(/body\??\.family_id/);
  }
});

test("the table holds a task's award positive and lets only an adjustment be negative; only the server writes", () => {
  const sql = codeOnly(read("docker/migration_zzzzzzzzzzzz_point_adjustments.sql"), { sql: true });
  expect(sql).toContain("(kind = 'task' AND points > 0)");
  expect(sql).toContain("(kind = 'adjustment' AND points <> 0 AND points BETWEEN -10000 AND 10000 AND todo_id IS NULL)");
  // Only an adjustment can be taken back from here; a task's award goes with an un-tick.
  expect(sql).toMatch(/DELETE FROM public\.todo_point_awards\s+WHERE id = p_adjustment_id AND family_id = p_family_id AND kind = 'adjustment'/);
  expect(sql).toContain("REVOKE ALL ON FUNCTION public.adjust_person_points(uuid, uuid, integer, text) FROM authenticated;");
  expect(sql).toContain("REVOKE ALL ON FUNCTION public.remove_person_point_adjustment(uuid, uuid) FROM authenticated;");
  // Both take the child's lock, like a purchase and an approval.
  expect(sql.match(/PERFORM public\.point_lock_person/g)).toHaveLength(2);
});

test("the parent's list and every total move on every screen when an adjustment is made", () => {
  const realtime = codeOnly(read("src/hooks/use-realtime.ts"));
  expect(realtime).toMatch(/case "todo_point_awards":[\s\S]*?"todo-point-awards"[\s\S]*?"point-adjustments"/);
  const sql = codeOnly(read("docker/migration_zzzzzzzzzzzz_point_adjustments.sql"), { sql: true });
  expect(sql).toContain("ALTER PUBLICATION supabase_realtime ADD TABLE public.todo_point_awards");
});
