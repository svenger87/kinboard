/**
 * Assistant actions that wait for a person — RFC-011 §4.3, §5, §7; RFC-012 §3.
 *
 * A sensitive home action (a lock, an alarm panel, a garage door, a script,
 * …) is not run when an assistant asks. Nor is anything else of a `kind`
 * that needs a person (RFC-012 §3: a pocket-money booking). It is stored as
 * a pending request;
 * every Kinboard screen shows it and every phone is pushed. A family member
 * approves it there with the settings PIN, or denies it — which needs no PIN
 * — and only an approval runs it — with the domain, service, entity and data **as stored**, never
 * anything from the approving request.
 *
 * What a request is for is its `kind`. Everything up to the moment it runs —
 * PIN, deny, expiry, revocation, the compare-and-swap, the limits — is the
 * same for every kind. Running it is not: each kind has a handler in
 * `ACTION_KIND_HANDLERS` — `validate` (may it still run?), `execute` (run it,
 * as stored) and `describe` (what it is, in words, for the screens, the push
 * and the assistant).
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
 *    approval ends it as denied), then its kind's `validate` — for a home
 *    request: the entity must still be in the family's catalogue, and the
 *    stored action is re-checked against the policy; otherwise it ends
 *    `failed` with a `reason` and nothing runs. Then its kind's `execute`
 *    runs it once — for home, one Home Assistant call — and the row becomes
 *    `done` or `failed` with `result = { status }` — the HTTP status only.
 * 5. A row left `approved` for over a minute (the server stopped between the
 *    claim and the answer) is reported, and marked best-effort, as `failed`
 *    with `reason: "unknown_outcome"`: it may or may not have happened.
 */

import { decideHomeAction, ENTITY_ID } from "@/lib/home/policy";
import type { IntegrationScope } from "@/lib/integration-auth";
import { MAX_ASSISTANT_BOOKING_CENTS, type BookingInput, type BookingResult } from "@/lib/pocket-money/booking";

export type ActionStatus = "pending" | "approved" | "denied" | "expired" | "failed" | "done";

/** What a request asks for. The table's CHECK lists the same (RFC-012 §3). */
export const ACTION_KINDS = ["home", "pocket_money"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/**
 * Who may follow a request at `GET /actions/{id}`: a token that can make a
 * confirmation request of any kind. Any one is enough; the request must
 * still be that token's own.
 */
export const ACTION_STATUS_SCOPES = ["home:control", "pocket_money:write"] as const satisfies readonly IntegrationScope[];

/** RFC-011 §4.3: a request lives two minutes. */
export const ACTION_REQUEST_TTL_MS = 120_000;

/**
 * How long a row may sit in `approved`. The Home Assistant call it waits on
 * times out after 10 s, so a minute means the process that claimed it is gone.
 */
export const APPROVED_STALE_MS = 60_000;

/**
 * Why an approved request did not run, or why its outcome is unknown.
 * `not_available`: Kinboard cannot run this kind of request (yet).
 * Pocket money: `insufficient_funds` (a withdrawal larger than the balance),
 * `no_account` (the child or their account is gone), `booking_failed` (the
 * database could not be read or refused the booking).
 */
export type ActionFailureReason =
  | "not_in_catalogue" | "catalogue_unavailable" | "not_allowed" | "unknown_outcome" | "not_available"
  | "insufficient_funds" | "no_account" | "booking_failed";

export interface ActionResult {
  /** Home Assistant's HTTP status; 0 when it was not reached or did not answer. Other kinds: 0. */
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
  kind: ActionKind;
  /** The Home Assistant fields: always set for `home` (a CHECK says so), null for other kinds. */
  entity_id: string | null;
  entity_name: string | null;
  domain: string | null;
  service: string | null;
  /** home: the service data, run as is. pocket_money: the booking (RFC-012 §3). */
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

/**
 * A translator over the `assistantActions` namespace (next-intl's `t`, server
 * or client). `formats` names number formats a message uses, such as the
 * `money` of a pocket-money booking, formatted in the translator's locale.
 */
export type ActionTranslator = (
  key: string,
  values?: Record<string, string | number>,
  formats?: { number?: Record<string, Intl.NumberFormatOptions> },
) => string;

export interface DescribableAction {
  client_name: string;
  entity_name: string;
  room?: string | null;
  domain: string;
  service: string;
  data: Record<string, unknown>;
}

/** Any request, as its kind's `describe` sees it. */
export interface DescribableRequest {
  kind: ActionKind;
  client_name: string;
  entity_name: string | null;
  room?: string | null;
  domain: string | null;
  service: string | null;
  data: Record<string, unknown>;
}

/** How much of an assistant's self-chosen name a screen or a push shows. */
export const CLIENT_LABEL_MAX = 40;

/**
 * An assistant's name as shown to the family: at most 40 characters, the
 * last an ellipsis when cut. The name is whatever the client registered
 * itself as, so it is shown as a short label — never as a sentence that
 * could talk the person at the screen into allowing something.
 */
export function clientLabel(name: string): string {
  const flat = name.replace(/\s+/g, " ").trim();
  return flat.length > CLIENT_LABEL_MAX ? `${flat.slice(0, CLIENT_LABEL_MAX - 1).trimEnd()}…` : flat;
}

/** "unlock Front door (Hallway)" — the action alone, in the family's language. */
export function describeVerb(t: ActionTranslator, action: Omit<DescribableAction, "client_name">): string {
  const position = action.data.position;
  const device = action.room
    ? t("deviceInRoom", { name: action.entity_name, room: action.room })
    : action.entity_name;
  return t(`verbs.${actionVerbKey(action.domain, action.service)}`, {
    device,
    service: action.service,
    position: typeof position === "number" ? position : 0,
  });
}

/**
 * "Claude wants to unlock Front door (Hallway)", in the family's language —
 * for the push and other plain text. Each verb carries `{device}` itself, so
 * a language can put the device where it belongs ("Haustür aufschließen").
 */
export function describeAction(t: ActionTranslator, action: DescribableAction): string {
  return t("request", { client: clientLabel(action.client_name), action: describeVerb(t, action) });
}

/** The action alone, in words, for any kind: its handler's `describe`. */
export function describeRequestVerb(t: ActionTranslator, request: DescribableRequest): string {
  const handler = (ACTION_KIND_HANDLERS as Partial<Record<string, ActionKindHandler>>)[request.kind];
  return handler ? handler.describe(t, request) : t("kinds.unknown");
}

/** "Claude wants to …" for any kind — the push title. */
export function describeRequest(t: ActionTranslator, request: DescribableRequest): string {
  return t("request", { client: clientLabel(request.client_name), action: describeRequestVerb(t, request) });
}

// ── creating ────────────────────────────────────────────────────────────────

export interface PushRequest {
  familyId: string;
  requestId: string;
  /** What to put into words; the push describes it with `describeRequest`. */
  request: DescribableRequest;
}

export interface CreateDeps {
  store: Pick<ActionRequestStore, "insert">;
  /** Must not throw for a failed push; a throw is caught here anyway. */
  push: (request: PushRequest) => Promise<void>;
  now?: () => Date;
}

/** A home request: what `control_device` asked for, already through the policy. */
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

/** A request of a kind without a device: everything it runs is in `data`. */
export interface CreateKindRequestInput {
  kind: Exclude<ActionKind, "home">;
  familyId: string;
  tokenId: string;
  clientName: string;
  /** Already validated by the kind's own route. */
  data: Record<string, unknown>;
}

const PUSH_TIMEOUT_MS = 5_000;

/**
 * Store a pending request and tell the family's phones. The row is what
 * matters — every screen gets it over realtime — so a push that fails or
 * hangs never fails the request; it is cut off after five seconds.
 */
export async function createActionRequest(
  input: CreateActionInput | CreateKindRequestInput,
  deps: CreateDeps,
): Promise<{ id: string; expiresAt: string }> {
  const now = (deps.now ?? (() => new Date()))();
  const home = !("kind" in input);
  const row = await deps.store.insert({
    family_id: input.familyId,
    token_id: input.tokenId,
    client_name: input.clientName.slice(0, MAX_NAME),
    kind: home ? "home" : input.kind,
    entity_id: home ? input.entityId : null,
    entity_name: home ? input.entityName.slice(0, MAX_NAME) : null,
    domain: home ? input.domain : null,
    service: home ? input.service : null,
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
      request: {
        kind: row.kind,
        client_name: row.client_name,
        entity_name: row.entity_name,
        room: home ? input.room ?? null : null,
        domain: row.domain,
        service: row.service,
        data: input.data,
      },
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
    kind: "home",
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
  input: { id: string; familyId: string; tokenId: string; kind?: ActionKind },
  deps: { store: ActionRequestStore; now?: () => Date },
): Promise<ActionRequestRow | null> {
  const row = await familyActionRequest(input.id, input.familyId, deps);
  if (!row || row.token_id === null || row.token_id !== input.tokenId) return null;
  // `/home/actions/{id}` asks for home requests only.
  if (input.kind && row.kind !== input.kind) return null;
  return row;
}

/**
 * What a screen sees of a request. Not the token id or the deciding device.
 * `description` is the action in words ("unlock Front door (Hallway)"), in
 * the screen's language — the screen shows it as is and never builds it from
 * the other fields, so a new kind needs no change on the client.
 */
export function toScreenRequest(row: ActionRequestRow, t: ActionTranslator, room: string | null = null) {
  return {
    id: row.id,
    kind: row.kind,
    description: describeRequestVerb(t, { ...row, room }),
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

/** What the assistant sees of its own request at `/home/actions/{id}` (RFC-011, unchanged). */
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

/**
 * What the assistant sees of its own request at the generic `/actions/{id}`:
 * the same, plus what kind of request it is and what it asked for, in words.
 */
export function toAssistantStatus(row: ActionRequestRow, t: ActionTranslator) {
  return { ...toAssistantRequest(row), kind: row.kind, description: describeRequestVerb(t, row) };
}

// ── deciding ────────────────────────────────────────────────────────────────

export interface DecideDeps {
  store: ActionRequestStore;
  hasPin: (familyId: string) => Promise<boolean>;
  /** `verifySettingsPin`: the shared, race-safe limiter. */
  verifyPin: (familyId: string, pin: string) => Promise<"valid" | "invalid" | "rate_limited">;
  // What the `home` handler runs with.
  callHaService: (
    familyId: string, domain: string, service: string, entityId: string, data: Record<string, unknown>,
  ) => Promise<{ ok: boolean; status: number }>;
  /** The family's catalogue entry for the entity, or null; throws when unreadable. */
  catalogueEntity: (familyId: string, entityId: string) => Promise<unknown | null>;
  // What the `pocket_money` handler runs with. Without them it runs nothing.
  /**
   * The pocket-money account of a person who is a child of this family and
   * not in the recycle bin, or null. Throws when unreadable.
   */
  pocketMoneyAccount?: (familyId: string, personId: string) => Promise<{ accountId: string; currency: string } | null>;
  /** `lib/pocket-money/booking.ts`: one atomic booking. */
  bookPocketMoney?: (input: BookingInput) => Promise<BookingResult>;
  /** Replaces a kind's handler in `ACTION_KIND_HANDLERS`. For tests. */
  kinds?: Partial<Record<ActionKind, ActionKindHandler>>;
  now?: () => Date;
}

// ── kinds ───────────────────────────────────────────────────────────────────

/**
 * What differs between kinds of request: whether an approved one may still
 * run, running it, and saying what it is. Everything else — PIN, deny,
 * expiry, revocation, who wins a race, the limits — is the same for all.
 */
export interface ActionKindHandler {
  /**
   * Called after the approval won and the assistant was re-checked, before
   * anything runs: why this stored request must not run now, or null.
   * Throws only for a bug; the request then ends unrun.
   */
  validate: (row: ActionRequestRow, familyId: string, deps: DecideDeps) => Promise<ActionFailureReason | null>;
  /**
   * Run it once, exactly as stored. `ok: false` with a result is a failure
   * that reached the outside; a throw means it did not run as far as is known.
   */
  execute: (row: ActionRequestRow, familyId: string, deps: DecideDeps) => Promise<{ ok: boolean; result: ActionResult }>;
  /** The action alone, in words, in `t`'s language: "unlock Front door (Hallway)". */
  describe: (t: ActionTranslator, request: DescribableRequest) => string;
}

/** Is the stored action still one the policy allows on this entity? It always should be. */
function stillAllowed(row: ActionRequestRow): boolean {
  if (row.entity_id === null || row.domain === null || row.service === null) return false;
  if (!ENTITY_ID.test(row.entity_id)) return false;
  if (row.entity_id.slice(0, row.entity_id.indexOf(".")) !== row.domain) return false;
  return decideHomeAction({ entityId: row.entity_id, service: row.service, data: row.data, deviceClass: null }).ok;
}

/** A Home Assistant service call (RFC-011 §4.3) — the behaviour before kinds existed. */
const homeHandler: ActionKindHandler = {
  async validate(row, familyId, deps) {
    if (row.entity_id === null) return "not_allowed";
    let entity: unknown;
    try {
      entity = await deps.catalogueEntity(familyId, row.entity_id);
    } catch {
      return "catalogue_unavailable";
    }
    if (!entity) return "not_in_catalogue";
    if (!stillAllowed(row)) return "not_allowed";
    return null;
  },
  async execute(row, familyId, deps) {
    // validate has made sure these are set.
    const { domain, service, entity_id: entityId } = row as ActionRequestRow & { domain: string; service: string; entity_id: string };
    try {
      const outcome = await deps.callHaService(familyId, domain, service, entityId, row.data);
      return { ok: outcome.ok, result: { status: outcome.status } };
    } catch (err) {
      // HomeUnavailable (not connected) or a bug: either way it did not run as far as we know.
      console.error("[assistant-actions] Home Assistant call failed:", err instanceof Error ? err.name : "error");
      return { ok: false, result: { status: 0 } };
    }
  },
  describe(t, request) {
    return describeVerb(t, {
      entity_name: request.entity_name ?? "",
      room: request.room,
      domain: request.domain ?? "",
      service: request.service ?? "",
      data: request.data,
    });
  },
};

// ── pocket money ────────────────────────────────────────────────────────────

/** What a pocket-money request stores in `data` (RFC-012 §3). `amount_cents` is always positive. */
export interface PocketMoneyBooking {
  person_id: string;
  person_name: string;
  amount_cents: number;
  currency: string;
  type: "deposit" | "withdrawal";
  note: string | null;
}

/** How much of an assistant's note a screen, a push or the assistant is shown. */
export const BOOKING_NOTE_MAX = 100;

/** A stored booking, or null when `data` is not one — which then never runs. */
export function pocketMoneyBookingFrom(data: Record<string, unknown> | null | undefined): PocketMoneyBooking | null {
  if (!data || typeof data !== "object") return null;
  const { person_id, person_name, amount_cents, currency, type, note } = data as Record<string, unknown>;
  if (typeof person_id !== "string" || !UUID.test(person_id)) return null;
  if (typeof person_name !== "string" || person_name.length > MAX_NAME) return null;
  if (typeof amount_cents !== "number" || !Number.isInteger(amount_cents)) return null;
  if (amount_cents < 1 || amount_cents > MAX_ASSISTANT_BOOKING_CENTS) return null;
  if (typeof currency !== "string" || currency.length === 0 || currency.length > 8) return null;
  if (type !== "deposit" && type !== "withdrawal") return null;
  if (note !== null && note !== undefined && (typeof note !== "string" || note.length > BOOKING_NOTE_MAX)) return null;
  return { person_id, person_name, amount_cents, currency, type, note: typeof note === "string" ? note : null };
}

/** Format characters (Cf) except ZWNJ, ZWJ and the tag characters. */
const INVISIBLE_FORMAT = /(?![\u200C\u200D\u{E0020}-\u{E007F}])\p{Cf}/gu;

/**
 * Text on one line with nothing invisible in it: format characters (Unicode
 * Cf — bidi overrides and isolates such as U+202E, zero-width spaces, the
 * BOM, soft hyphens) and control characters that are not whitespace (Cc) are
 * removed, then whitespace runs become one space. Kept: the zero-width joiner
 * and non-joiner (U+200D, U+200C) and the tag characters (U+E0020–E007F),
 * which hold emoji such as 👨‍👩‍👧 and subdivision flags together and shape
 * Persian and Indic script; none of them reorders text, so what a family reads is what is there, in the order it
 * is there.
 */
export function stripInvisible(text: string): string {
  return text
    .replace(INVISIBLE_FORMAT, "")
    .replace(/(?!\s)\p{Cc}/gu, "")
    .replace(/\s+/g, " ");
}

/**
 * An assistant's note as the family is shown it: on one line, at most 100
 * characters, nothing invisible (`stripInvisible`), and without quotation
 * marks of its own — the sentence puts it
 * in quotes, and a note must not be able to close them and carry on as if
 * Kinboard were speaking. Empty → null.
 */
export function bookingNoteLabel(note: string | null): string | null {
  if (note === null) return null;
  const flat = stripInvisible(note).replace(/["\u201C\u201D\u201E\u201F\u00AB\u00BB\u2039\u203A]/g, "'").trim();
  if (flat.length === 0) return null;
  return flat.length > BOOKING_NOTE_MAX ? `${flat.slice(0, BOOKING_NOTE_MAX - 1).trimEnd()}…` : flat;
}

/**
 * "add €5.00 to Enno's pocket money (note: “mowing the lawn”)", in `t`'s
 * language, the amount in its locale and the account's currency.
 */
function describePocketMoney(t: ActionTranslator, data: Record<string, unknown>): string {
  const booking = pocketMoneyBookingFrom(data);
  if (!booking) return t("kinds.pocket_money");
  // An ISO 4217 code is shown as money in the locale's way; anything else
  // (the column is free text) as a plain amount rather than throwing.
  const money: Intl.NumberFormatOptions = /^[A-Z]{3}$/.test(booking.currency)
    ? { style: "currency", currency: booking.currency }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  const sentence = t(
    `kinds.pocket_money_${booking.type}`,
    { amount: booking.amount_cents / 100, name: clientLabel(booking.person_name) },
    { number: { money } },
  );
  const note = bookingNoteLabel(booking.note);
  return note ? t("kinds.pocket_money_note", { booking: sentence, note }) : sentence;
}

/**
 * A pocket-money booking (RFC-012 §3), run only once a family member allowed
 * it with the PIN. Before it runs, the child and their account are looked up
 * again — gone, or no longer a child: `no_account`. It books as stored:
 * a deposit as `manual_deposit`, a withdrawal as `withdrawal`, through the
 * atomic booking, so a withdrawal larger than the balance by then ends
 * `failed` / `insufficient_funds` and nothing is written.
 */
const pocketMoneyHandler: ActionKindHandler = {
  async validate(row, familyId, deps) {
    const booking = pocketMoneyBookingFrom(row.data);
    if (!booking) return "not_allowed";
    if (!deps.pocketMoneyAccount || !deps.bookPocketMoney) return "not_available";
    try {
      const account = await deps.pocketMoneyAccount(familyId, booking.person_id);
      if (!account) return "no_account";
      // The family allowed an amount in this currency; an account that has
      // since changed currency is not what they said yes to.
      return account.currency === booking.currency ? null : "not_allowed";
    } catch {
      return "booking_failed";
    }
  },
  async execute(row, familyId, deps) {
    const failed = (reason: ActionFailureReason) => ({ ok: false, result: { status: 0, reason } });
    const booking = pocketMoneyBookingFrom(row.data);
    if (!booking || !deps.pocketMoneyAccount || !deps.bookPocketMoney) return failed("not_available");
    try {
      const account = await deps.pocketMoneyAccount(familyId, booking.person_id);
      if (!account) return failed("no_account");
      if (account.currency !== booking.currency) return failed("not_allowed");
      const deposit = booking.type === "deposit";
      const booked = await deps.bookPocketMoney({
        familyId,
        accountId: account.accountId,
        amountCents: deposit ? booking.amount_cents : -booking.amount_cents,
        type: deposit ? "manual_deposit" : "withdrawal",
        note: booking.note ?? clientLabel(row.client_name),
      });
      if (booked.ok) return { ok: true, result: { status: 0 } };
      if (booked.error === "insufficient_funds") return failed("insufficient_funds");
      if (booked.error === "not_found") return failed("no_account");
      console.error("[assistant-actions] booking failed:", booked.message);
      return failed("booking_failed");
    } catch (err) {
      console.error("[assistant-actions] booking failed:", err instanceof Error ? err.name : "error");
      return failed("booking_failed");
    }
  },
  describe(t, request) {
    return describePocketMoney(t, request.data);
  },
};

export const ACTION_KIND_HANDLERS: Readonly<Record<ActionKind, ActionKindHandler>> = {
  home: homeHandler,
  pocket_money: pocketMoneyHandler,
};

/** The handler for a row's kind, or null for a kind this server does not know. */
function handlerFor(kind: string, deps: DecideDeps): ActionKindHandler | null {
  if (!(ACTION_KINDS as readonly string[]).includes(kind)) return null;
  return deps.kinds?.[kind as ActionKind] ?? ACTION_KIND_HANDLERS[kind as ActionKind];
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

  // 6. Its kind may still run it — for home: still in the catalogue, and
  //    still allowed — or it ends here, unrun. A kind this server does not
  //    know never runs.
  const handler = handlerFor(approved.kind, deps);
  let blocked: ActionFailureReason | null;
  try {
    blocked = handler ? await handler.validate(approved, familyId, deps) : "not_available";
  } catch (err) {
    console.error("[assistant-actions] could not check:", approved.kind, err instanceof Error ? err.name : "error");
    blocked = "not_available";
  }
  if (blocked || !handler) {
    console.error("[assistant-actions] not run:", blocked, approved.id);
    return finish(id, familyId, approved, false, { status: 0, reason: blocked ?? "not_available" }, deps);
  }

  // 7. Exactly what was stored — from the row the UPDATE returned, never the request.
  let outcome: { ok: boolean; result: ActionResult };
  try {
    outcome = await handler.execute(approved, familyId, deps);
  } catch (err) {
    console.error("[assistant-actions] run failed:", approved.kind, err instanceof Error ? err.name : "error");
    outcome = { ok: false, result: { status: 0 } };
  }
  return finish(id, familyId, approved, outcome.ok, outcome.result, deps);
}

/**
 * Record what Home Assistant answered. Normally the row is still `approved`.
 * If it is not, a reader decided meanwhile that this call would never
 * finish and wrote `failed` / `unknown_outcome` (settleStaleApproved) — but
 * here is the real answer, which replaces that guess. Any other state is left
 * as it is. Either way the row returned is the one stored, re-read.
 */
async function finish(
  id: string, familyId: string, approved: ActionRequestRow, ok: boolean, result: ActionResult, deps: DecideDeps,
): Promise<DecideResult> {
  const status: ActionStatus = ok ? "done" : "failed";
  const finished = await deps.store.transition(id, familyId, "approved", { status, result });
  if (finished) return { status: 200, request: finished };

  const current = await deps.store.get(id, familyId);
  if (current?.status === "failed" && (current.result as { reason?: unknown } | null)?.reason === "unknown_outcome") {
    const corrected = await deps.store.transition(id, familyId, "failed", { status, result });
    if (corrected) return { status: 200, request: corrected };
  }
  const reread = (await deps.store.get(id, familyId)) ?? current;
  return { status: 200, request: reread ?? { ...approved, status, result } };
}
