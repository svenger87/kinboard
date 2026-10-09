/**
 * A parent adds or removes a child's points by hand (discussion #349): a
 * bonus, or a correction for a task that was given the wrong points.
 * adjust_person_points() and remove_person_point_adjustment() in
 * docker/migration_zzzzzzzzzzzz_point_adjustments.sql do it under the child's
 * lock; this turns their answers into HTTP ones. The routes check the
 * settings PIN before getting here. The client is a parameter so a spec can
 * hand it a fake.
 */

import { UUID } from "@/lib/home/action-requests";
import type { RpcClient } from "@/lib/pocket-money/booking";

type Answer = { status: number; body: Record<string, unknown> };

/** The most a single adjustment may add or take away; the table's own limit. */
export const MAX_ADJUSTMENT = 10_000;
/** The longest note kept; the table's own limit. */
export const MAX_NOTE = 200;

/** Whole points, not zero, within the limit: a valid adjustment. */
export function isAdjustment(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value !== 0 && Math.abs(value) <= MAX_ADJUSTMENT;
}

export async function addAdjustment(
  client: RpcClient,
  input: { familyId: string; personId: unknown; points: unknown; note: unknown },
): Promise<Answer> {
  if (typeof input.personId !== "string" || !UUID.test(input.personId)) {
    return { status: 404, body: { error: "not found" } };
  }
  if (!isAdjustment(input.points)) {
    return { status: 400, body: { error: "invalid_points" } };
  }
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") {
    return { status: 400, body: { error: "invalid_note" } };
  }
  const note = typeof input.note === "string" ? input.note.trim().slice(0, MAX_NOTE) : "";
  const { data, error } = await client.rpc("adjust_person_points", {
    p_family_id: input.familyId,
    p_person_id: input.personId,
    p_points: input.points,
    p_note: note || null,
  });
  if (error) return { status: 500, body: { error: error.message } };
  const answer = data as { ok?: unknown; error?: unknown; adjustment?: unknown; balance?: unknown } | null;
  if (answer?.ok === true) return { status: 201, body: { adjustment: answer.adjustment, balance: answer.balance } };
  if (answer?.error === "not_found") return { status: 404, body: { error: "not found" } };
  if (answer?.error === "invalid_points") return { status: 400, body: { error: "invalid_points" } };
  return { status: 500, body: { error: "unexpected answer from adjust_person_points" } };
}

export async function removeAdjustment(
  client: RpcClient,
  input: { familyId: string; adjustmentId: string },
): Promise<Answer> {
  if (!UUID.test(input.adjustmentId)) return { status: 404, body: { error: "not found" } };
  const { data, error } = await client.rpc("remove_person_point_adjustment", {
    p_family_id: input.familyId,
    p_adjustment_id: input.adjustmentId,
  });
  if (error) return { status: 500, body: { error: error.message } };
  const answer = data as { ok?: unknown; error?: unknown; removed?: unknown; balance?: unknown } | null;
  if (answer?.ok === true) return { status: 200, body: { removed: answer.removed, balance: answer.balance } };
  if (answer?.error === "not_found") return { status: 404, body: { error: "not found" } };
  return { status: 500, body: { error: "unexpected answer from remove_person_point_adjustment" } };
}
