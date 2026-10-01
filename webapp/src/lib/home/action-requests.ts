/**
 * Assistant actions that wait for a person — RFC-011 §4.3, §5, §7.
 *
 * A sensitive home action (a lock, an alarm panel, a garage door, a script,
 * …) is not run when an assistant asks. It is stored as a pending request;
 * every Kinboard screen shows it and every phone is pushed. A family member
 * approves or denies it there with the settings PIN, and only an approval
 * runs it — with the domain, service, entity and data **as stored**, never
 * anything from the approving request.
 *
 * Without I/O: the table, the PIN check, Home Assistant and the push come in
 * as dependencies, so every branch — and every "Home Assistant was never
 * called" — is tested against counting fakes in
 * `e2e/assistant-actions.spec.ts`. The real ones are in
 * `lib/home/action-requests-live.ts`.
 *
 * The rules for deciding:
 *
 * 1. Approving needs the settings PIN; a family with no PIN cannot approve
 *    (`pin_required`). The PIN is the household's proof that a person, not
 *    whoever can reach a screen, said yes. Denying needs no PIN — stopping
 *    an unexpected unlock must be possible for anyone at a screen — and
 *    never touches the PIN limiter.
 * 2. Only a pending request can be decided. One past `expires_at`, or whose
 *    assistant has been revoked (token revoked or gone), is ended on the spot
 *    — `expired` / `denied` — and nothing runs. The same happens lazily on
 *    every read, so a revoked assistant's requests vanish from the screens.
 * 3. The decision is one conditional UPDATE, `pending → approved|denied`
 *    while not expired (by the clock at that moment). Two screens approving
 *    at once: one wins, the other is told it was already decided, and Home
 *    Assistant hears it once.
 * 4. After winning, the assistant is checked again (a revoke racing the
 *    approval ends it as denied), the entity must still be in the family's
 *    catalogue, and the stored action is re-checked against the policy;
 *    otherwise it ends `failed` with a `reason` and Home Assistant is not
 *    called. Then Home Assistant is called once and the row becomes `done`
 *    or `failed` with `result = { status }` — the HTTP status only.
 * 5. A row left `approved` for over a minute (the server stopped between the
 *    claim and the answer) is reported, and marked best-effort, as `failed`
 *    with `reason: "unknown_outcome"`: it may or may not have happened.
 */

import { decideHomeAction, ENTITY_ID } from "@/lib/home/policy";

export type ActionStatus = "pending" | "approved" | "denied" | "expired" | "failed" | "done";

/** RFC-011 §4.3: a request lives two minutes. */
export const ACTION_REQUEST_TTL_MS = 120_000;

/**
 * How long a row may sit in `approved`. The Home Assistant call it waits on
 * times out after 10 s, so a minute means the process that claimed it is gone.
 */
export const APPROVED_STALE_MS = 60_000;

/** Why an approved action did not reach Home Assistant, or why its outcome is unknown. */
export type ActionFailureReason = "not_in_catalogue" | "catalogue_unavailable" | "not_allowed" | "unknown_outcome";

export interface ActionResult {
  /** Home Assistant's HTTP status; 0 when it was not reached or did not answer. */
  status: number;
  reason?: ActionFailureReason;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_NAME = 200;

export interface ActionRequestRow {
  id: string;
  family_id: string;
  token_id: string | null;
  client_name: string;
  entity_id: string;
  entity_name: string;
  domain: string;
  service: string;
  data: Record<string, unknown>;
  status: ActionStatus;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  decided_by_device_id: string | null;
  result: ActionResult | null;
}

export type NewActionRow = Omit<ActionRequestRow, "id" | "created_at">;

export interface ActionPatch {
  status: ActionStatus;
  decided_at?: string;
  decided_by_device_id?: string | null;
  result?: ActionResult | null;
}

export interface ActionRequestStore {
  insert: (row: NewActionRow) => Promise<ActionRequestRow>;
  /** One row of this family, or null. */
  get: (id: string, familyId: string) => Promise<ActionRequestRow | null>;
  /** This family's pending rows, newest first. */
  listPending: (familyId: string) => Promise<ActionRequestRow[]>;
  /**
   * One conditional UPDATE: changes the row only while it belongs to this
   * family and its status is `from` — and, with `unexpiredAt`, only while
   * `expires_at > unexpiredAt`. Returns the updated row, or null when the
   * condition did not hold (somebody else got there first).
   */
  transition: (
    id: string, familyId: string, from: ActionStatus, patch: ActionPatch, unexpiredAt?: string,
  ) => Promise<ActionRequestRow | null>;
  /** True only for a token that exists, belongs to this family and is not revoked. */
  tokenActive: (tokenId: string | null, familyId: string) => Promise<boolean>;
}

// ── describing an action ───────────────────────────────────────────────────

/**
 * The services a confirmation can be for, as the key of their verb in
 * `messages/*.json` → `assistantActions.verbs`. Covers every sensitive
 * service in the policy; anything else falls back to `generic`.
 */
const VERB_KEYS: ReadonlySet<string> = new Set([
  "lock_lock", "lock_unlock", "lock_open",
  "alarm_control_panel_alarm_arm_home", "alarm_control_panel_alarm_arm_away",
  "alarm_control_panel_alarm_arm_night", "alarm_control_panel_alarm_disarm",
  "cover_open_cover", "cover_close_cover", "cover_stop_cover", "cover_set_cover_position",
  "scene_turn_on", "script_turn_on", "button_press", "input_button_press",
  "switch_turn_on", "switch_turn_off", "switch_toggle",
  "input_boolean_turn_on", "input_boolean_turn_off", "input_boolean_toggle",
  "siren_turn_on", "siren_turn_off",
  "lawn_mower_start_mowing", "lawn_mower_dock", "lawn_mower_pause",
]);

export function actionVerbKey(domain: string, service: string): string {
  const key = `${domain}_${service}`;
  return VERB_KEYS.has(key) ? key : "generic";
}

/** A translator over the `assistantActions` namespace (next-intl's `t`, server or client). */
export type ActionTranslator = (key: string, values?: Record<string, string | number>) => string;

export interface DescribableAction {
  client_name: string;
  entity_name: string;
  room?: string | null;
  domain: string;
  service: string;
  data: Record<string, unknown>;
}

/**
 * "Claude wants to unlock Front door (Hallway)", in the family's language.
 * Each verb carries `{device}` itself, so a language can put the device
 * where it belongs ("Haustür aufschließen").
 */
export function describeAction(t: ActionTranslator, action: DescribableAction): string {
  const position = action.data.position;
  const device = action.room
    ? t("deviceInRoom", { name: action.entity_name, room: action.room })
    : action.entity_name;
  const verb = t(`verbs.${actionVerbKey(action.domain, action.service)}`, {
    device,
    service: action.service,
    position: typeof position === "number" ? position : 0,
  });
  return t("request", { client: action.client_name, action: verb });
}

// ── creating ────────────────────────────────────────────────────────────────

export interface PushRequest {
  familyId: string;
  requestId: string;
  clientName: string;
  entityName: string;
  room: string | null;
  domain: string;
  service: string;
  data: Record<string, unknown>;
}

export interface CreateDeps {
  store: Pick<ActionRequestStore, "insert">;
  /** Must not throw for a failed push; a throw is caught here anyway. */
  push: (request: PushRequest) => Promise<void>;
  now?: () => Date;
}

export interface CreateActionInput {
  familyId: string;
  tokenId: string;
  clientName: string;
  entityId: string;
  entityName: string;
  room?: string | null;
  domain: string;
  service: string;
  /** Already validated and rebuilt by the policy. */
  data: Record<string, unknown>;
}

const PUSH_TIMEOUT_MS = 5_000;

/**
 * Store a pending request and tell the family's phones. The row is what
 * matters — every screen gets it over realtime — so a push that fails or
 * hangs never fails the request; it is cut off after five seconds.
 */
export async function createActionRequest(
  input: CreateActionInput,
  deps: CreateDeps,
): Promise<{ id: string; expiresAt: string }> {
  const now = (deps.now ?? (() => new Date()))();
  const row = await deps.store.insert({
    family_id: input.familyId,
    token_id: input.tokenId,
    client_name: input.clientName.slice(0, MAX_NAME),
    entity_id: input.entityId,
    entity_name: input.entityName.slice(0, MAX_NAME),
    domain: input.domain,
    service: input.service,
    data: input.data,
    status: "pending",
    expires_at: new Date(now.getTime() + ACTION_REQUEST_TTL_MS).toISOString(),
    decided_at: null,
    decided_by_device_id: null,
    result: null,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    deps.push({
      familyId: input.familyId,
      requestId: row.id,
      clientName: row.client_name,
      entityName: row.entity_name,
      room: input.room ?? null,
      domain: input.domain,
      service: input.service,
      data: input.data,
    }).catch((err) => console.error("[assistant-actions] push failed:", err)),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, PUSH_TIMEOUT_MS); }),
  ]);
  clearTimeout(timer);

  return { id: row.id, expiresAt: row.expires_at };
}

/**
 * The record of an action that needed no confirmation (RFC-011 §7: every
 * action is attributable). Written after Home Assistant answered; the
 * caller logs a failure to write it and does not fail the action, which has
 * already happened.
 */
export async function recordHomeAction(
  input: Omit<CreateActionInput, "room"> & { ok: boolean; status: number },
  deps: { store: Pick<ActionRequestStore, "insert">; now?: () => Date },
): Promise<void> {
  const now = (deps.now ?? (() => new Date()))().toISOString();
  await deps.store.insert({
    family_id: input.familyId,
    token_id: input.tokenId,
    client_name: input.clientName.slice(0, MAX_NAME),
    entity_id: input.entityId,
    entity_name: input.entityName.slice(0, MAX_NAME),
    domain: input.domain,
    service: input.service,
    data: input.data,
    status: input.ok ? "done" : "failed",
    expires_at: now,
    decided_at: now,
    decided_by_device_id: null,
    result: { status: input.status },
  });
}

// ── reading ─────────────────────────────────────────────────────────────────

function expired(row: ActionRequestRow, now: Date): boolean {
  const at = Date.parse(row.expires_at);
  // An unreadable expiry is an expired one.
  return !Number.isFinite(at) || at <= now.getTime();
}

type Ended = "expired" | "revoked";

/**
 * End a pending request that can no longer be decided: past its expiry, or
 * its assistant revoked. Returns the row as it now is, and why it ended.
 */
async function settle(
  row: ActionRequestRow,
  store: ActionRequestStore,
  now: Date,
): Promise<{ row: ActionRequestRow; ended?: Ended }> {
  if (row.status === "approved") return { row: await settleStaleApproved(row, store, now) };
  if (row.status !== "pending") return { row };
  let ended: Ended | undefined;
  let patch: ActionPatch | undefined;
  if (expired(row, now)) {
    ended = "expired";
    patch = { status: "expired" };
  } else if (!(await store.tokenActive(row.token_id, row.family_id))) {
    ended = "revoked";
    patch = { status: "denied", decided_at: now.toISOString(), decided_by_device_id: null, result: null };
  }
  if (!patch || !ended) return { row };
  const updated = await store.transition(row.id, row.family_id, "pending", patch);
  // Lost the race to someone else's decision: report what they decided.
  if (!updated) return { row: (await store.get(row.id, row.family_id)) ?? row };
  return { row: updated, ended };
}

/**
 * An `approved` row older than `APPROVED_STALE_MS` will never be finished by
 * the request that claimed it. Report it as failed with an unknown outcome,
 * and write that down if we can — a failed write still reports it.
 */
async function settleStaleApproved(row: ActionRequestRow, store: ActionRequestStore, now: Date): Promise<ActionRequestRow> {
  const decidedAt = Date.parse(row.decided_at ?? "");
  if (Number.isFinite(decidedAt) && now.getTime() - decidedAt <= APPROVED_STALE_MS) return row;
  const patch: ActionPatch = { status: "failed", result: { status: 0, reason: "unknown_outcome" } };
  try {
    const updated = await store.transition(row.id, row.family_id, "approved", patch);
    if (updated) return updated;
    // Finished meanwhile: report what it became.
    return (await store.get(row.id, row.family_id)) ?? { ...row, ...patch };
  } catch {
    return { ...row, ...patch };
  }
}

/** The family's pending requests, after ending any that expired or lost their assistant. */
export async function pendingActionRequests(
  familyId: string,
  deps: { store: ActionRequestStore; now?: () => Date },
): Promise<ActionRequestRow[]> {
  const now = (deps.now ?? (() => new Date()))();
  const rows = await deps.store.listPending(familyId);
  const out: ActionRequestRow[] = [];
  for (const row of rows) {
    if (row.family_id !== familyId) continue;
    const settled = await settle(row, deps.store, now);
    if (settled.row.status === "pending") out.push(settled.row);
  }
  return out;
}

/** One request of this family, settled; null when there is none. */
export async function familyActionRequest(
  id: string,
  familyId: string,
  deps: { store: ActionRequestStore; now?: () => Date },
): Promise<ActionRequestRow | null> {
  if (!UUID.test(id)) return null;
  const row = await deps.store.get(id, familyId);
  if (!row || row.family_id !== familyId) return null;
  return (await settle(row, deps.store, (deps.now ?? (() => new Date()))())).row;
}

/**
 * `get_action_status`: one request, but only for the assistant that made it
 * — any other id, including another assistant's in the same family, is null
 * (404). Expired pending rows are marked `expired` on the way.
 */
export async function actionRequestStatus(
  input: { id: string; familyId: string; tokenId: string },
  deps: { store: ActionRequestStore; now?: () => Date },
): Promise<ActionRequestRow | null> {
  const row = await familyActionRequest(input.id, input.familyId, deps);
  if (!row || row.token_id === null || row.token_id !== input.tokenId) return null;
  return row;
}

/** What a screen sees of a request. Not the token id or the deciding device. */
export function toScreenRequest(row: ActionRequestRow, room: string | null = null) {
  return {
    id: row.id,
    client_name: row.client_name,
    entity_id: row.entity_id,
    entity_name: row.entity_name,
    room,
    domain: row.domain,
    service: row.service,
    data: row.data,
    status: row.status,
    created_at: row.created_at,
    expires_at: row.expires_at,
    decided_at: row.decided_at,
    result: row.result,
  };
}

export type ScreenRequest = ReturnType<typeof toScreenRequest>;

/** What the assistant sees of its own request. */
export function toAssistantRequest(row: ActionRequestRow) {
  return {
    id: row.id,
    status: row.status,
    entity_id: row.entity_id,
    service: row.service,
    created_at: row.created_at,
    expires_at: row.expires_at,
    decided_at: row.decided_at,
    result: row.result,
  };
}

// ── deciding ────────────────────────────────────────────────────────────────

export interface DecideDeps {
  store: ActionRequestStore;
  hasPin: (familyId: string) => Promise<boolean>;
  /** `verifySettingsPin`: the shared, race-safe limiter. */
  verifyPin: (familyId: string, pin: string) => Promise<"valid" | "invalid" | "rate_limited">;
  callHaService: (
    familyId: string, domain: string, service: string, entityId: string, data: Record<string, unknown>,
  ) => Promise<{ ok: boolean; status: number }>;
  /** The family's catalogue entry for the entity, or null; throws when unreadable. */
  catalogueEntity: (familyId: string, entityId: string) => Promise<unknown | null>;
  now?: () => Date;
}

export interface DecideInput {
  id: string;
  familyId: string;
  deviceId: string | null;
  decision: unknown;
  pin: unknown;
}

export type DecideError =
  | "invalid_request" | "not_found" | "pin_required" | "pin_invalid" | "rate_limited"
  | "expired" | "revoked" | "already_decided";

export type DecideResult =
  | { status: 200; request: ActionRequestRow }
  | { status: 400 | 403 | 404 | 409 | 429; error: DecideError; request?: ActionRequestRow };

const MAX_PIN = 32;

/** Why a lost compare-and-swap lost: it expired meanwhile, or somebody decided it. */
async function conflict(id: string, familyId: string, deps: DecideDeps, now: Date): Promise<DecideResult> {
  const row = await deps.store.get(id, familyId);
  if (!row) return { status: 404, error: "not_found" };
  const settled = await settle(row, deps.store, now);
  if (settled.ended) return { status: 409, error: settled.ended, request: settled.row };
  return { status: 409, error: "already_decided", request: settled.row };
}

/** Is the stored action still one the policy allows on this entity? It always should be. */
function stillAllowed(row: ActionRequestRow): boolean {
  if (!ENTITY_ID.test(row.entity_id)) return false;
  if (row.entity_id.slice(0, row.entity_id.indexOf(".")) !== row.domain) return false;
  return decideHomeAction({ entityId: row.entity_id, service: row.service, data: row.data, deviceClass: null }).ok;
}

export async function decideActionRequest(input: DecideInput, deps: DecideDeps): Promise<DecideResult> {
  // Read afresh at each step that needs it: PIN checks and reads take time,
  // and the swap must judge expiry by the moment it runs.
  const clock = deps.now ?? (() => new Date());
  const { id, familyId } = input;

  if (input.decision !== "approve" && input.decision !== "deny") {
    return { status: 400, error: "invalid_request" };
  }
  const approve = input.decision === "approve";
  // Deny ignores `pin` entirely.
  if (approve && (typeof input.pin !== "string" || input.pin.length === 0 || input.pin.length > MAX_PIN)) {
    return { status: 400, error: "invalid_request" };
  }
  if (!UUID.test(id)) return { status: 404, error: "not_found" };

  // 1. No PIN, no approval. Throws (unreadable) → the route answers 500: fail closed.
  if (approve && !(await deps.hasPin(familyId))) return { status: 403, error: "pin_required" };

  // 2. Only a pending request, still within its two minutes, of a live assistant.
  const found = await deps.store.get(id, familyId);
  if (!found || found.family_id !== familyId) return { status: 404, error: "not_found" };
  const settled = await settle(found, deps.store, clock());
  if (settled.ended) return { status: 409, error: settled.ended, request: settled.row };
  if (settled.row.status !== "pending") return { status: 409, error: "already_decided", request: settled.row };

  // 3. Approving: the PIN, through the shared limiter.
  if (approve) {
    const verdict = await deps.verifyPin(familyId, input.pin as string);
    if (verdict === "rate_limited") return { status: 429, error: "rate_limited" };
    if (verdict !== "valid") return { status: 403, error: "pin_invalid" };
  }

  // 4. One conditional UPDATE decides; whoever loses it is told so.
  const decidedAt = clock().toISOString();
  if (!approve) {
    const denied = await deps.store.transition(
      id, familyId, "pending",
      { status: "denied", decided_at: decidedAt, decided_by_device_id: input.deviceId },
      decidedAt,
    );
    return denied ? { status: 200, request: denied } : conflict(id, familyId, deps, clock());
  }

  const approved = await deps.store.transition(
    id, familyId, "pending",
    { status: "approved", decided_at: decidedAt, decided_by_device_id: input.deviceId },
    decidedAt,
  );
  if (!approved) return conflict(id, familyId, deps, clock());

  // 5. Revoked while the PIN was being typed: nothing runs.
  if (!(await deps.store.tokenActive(approved.token_id, familyId))) {
    const denied = await deps.store.transition(id, familyId, "approved", { status: "denied", result: null });
    return { status: 409, error: "revoked", request: denied ?? approved };
  }

  // 6. Still in the catalogue, and still allowed — or it ends here, unrun.
  const blocked = await whyNotRun(approved, familyId, deps);
  if (blocked) {
    console.error("[assistant-actions] not run:", blocked, approved.id);
    return finish(id, familyId, approved, false, { status: 0, reason: blocked }, deps);
  }

  // 7. Exactly what was stored — from the row the UPDATE returned, never the request.
  let outcome: { ok: boolean; status: number };
  try {
    outcome = await deps.callHaService(familyId, approved.domain, approved.service, approved.entity_id, approved.data);
  } catch (err) {
    // HomeUnavailable (not connected) or a bug: either way it did not run as far as we know.
    console.error("[assistant-actions] Home Assistant call failed:", err instanceof Error ? err.name : "error");
    outcome = { ok: false, status: 0 };
  }
  return finish(id, familyId, approved, outcome.ok, { status: outcome.status }, deps);
}

async function whyNotRun(row: ActionRequestRow, familyId: string, deps: DecideDeps): Promise<ActionFailureReason | null> {
  let entity: unknown;
  try {
    entity = await deps.catalogueEntity(familyId, row.entity_id);
  } catch {
    return "catalogue_unavailable";
  }
  if (!entity) return "not_in_catalogue";
  if (!stillAllowed(row)) return "not_allowed";
  return null;
}

async function finish(
  id: string, familyId: string, approved: ActionRequestRow, ok: boolean, result: ActionResult, deps: DecideDeps,
): Promise<DecideResult> {
  const status: ActionStatus = ok ? "done" : "failed";
  const finished = await deps.store.transition(id, familyId, "approved", { status, result });
  return { status: 200, request: finished ?? { ...approved, status, result } };
}
