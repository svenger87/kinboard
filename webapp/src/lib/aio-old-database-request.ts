import type { DeleteResult } from "@/lib/aio-old-database";

/**
 * Who may delete the database folder a PostgreSQL upgrade left behind
 * (lib/aio-old-database.ts), in the order the route asks:
 *
 *   1. the all-in-one image at all (a compose install: 404, as if the route
 *      did not exist);
 *   2. the install's operator (lib/install-operator.ts): the folder belongs
 *      to the install, not to a family; anyone else 403;
 *   3. the settings PIN typed then and there, checked by verifySettingsPin
 *      and its shared limiter, as "Trust this assistant" asks for it: an
 *      unlocked settings screen is not enough to remove data for good, and
 *      a family without a PIN cannot delete it (set one first);
 *   4. then deleteOldDatabase's own refusals: inside the rollback window, an
 *      upgrade in progress, a folder that is not the recorded cluster.
 *
 * Pure: every dependency comes in, so each gate is tested against fakes in
 * e2e/aio-old-database.spec.ts.
 */

export interface OldDatabaseDeleteDeps {
  isAio: () => boolean;
  isOperator: (familyId: string) => Promise<boolean>;
  hasPin: (familyId: string) => Promise<boolean>;
  verifyPin: (familyId: string, pin: string) => Promise<"valid" | "invalid" | "rate_limited">;
  remove: () => Promise<DeleteResult>;
  log: (line: string) => void;
}

const MAX_PIN = 32;

const REFUSAL_STATUS: Record<string, number> = {
  not_aio: 404,
  nothing_to_delete: 404,
  upgrade_in_progress: 409,
  rollback_window: 409,
  busy: 409,
  not_the_recorded_cluster: 409,
  symlink: 409,
  not_a_folder: 409,
  not_owner: 409,
  failed: 500,
};

export async function deleteOldDatabaseRequest(
  input: { familyId: string; deviceId: string | null; body: unknown },
  deps: OldDatabaseDeleteDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!deps.isAio()) return { status: 404, body: { error: "not_found" } };
  if (!(await deps.isOperator(input.familyId))) return { status: 403, body: { error: "not_operator" } };

  const pin = (input.body as { pin?: unknown } | null)?.pin;
  if (typeof pin !== "string" || pin.length === 0 || pin.length > MAX_PIN) {
    return { status: 400, body: { error: "invalid_request" } };
  }
  // Not "pin_required": the settings screen reads that as "lock again".
  if (!(await deps.hasPin(input.familyId))) return { status: 403, body: { error: "pin_not_set" } };
  const verdict = await deps.verifyPin(input.familyId, pin);
  if (verdict === "rate_limited") return { status: 429, body: { error: "rate_limited" } };
  if (verdict !== "valid") return { status: 403, body: { error: "pin_invalid" } };

  const who = `family ${input.familyId}, device ${input.deviceId ?? "unknown"}`;
  const result = await deps.remove();
  if (!result.ok) {
    deps.log(`aio: the old database folder was NOT deleted (${result.refusal}${result.detail ? `: ${result.detail}` : ""}), asked by ${who}`);
    return { status: REFUSAL_STATUS[result.refusal] ?? 500, body: { error: result.refusal } };
  }
  deps.log(
    `aio: deleted the database folder from before the PostgreSQL upgrade (PostgreSQL ${result.fromMajor}, ` +
      `${Math.round(result.bytes / 1048576)} MB freed), asked by ${who}`,
  );
  return { status: 200, body: { ok: true, freedBytes: result.bytes } };
}
