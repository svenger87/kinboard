/**
 * The home routes' decisions — RFC-011 §3 and §4, without I/O.
 *
 * `GET /home/devices`, `GET /home/devices/{entity}` and
 * `POST /home/devices/{entity}/actions` are thin wrappers around the three
 * functions here. The catalogue and Home Assistant come in as `HomeDeps`, so
 * every branch — and every "Home Assistant was never called" — is tested
 * against counting stubs in `e2e/home-routes.spec.ts`.
 *
 * The rules, in the order they apply to an action:
 *
 * 1. The entity in the path must be an entity id (`ENTITY_ID`) and in this
 *    family's catalogue. Otherwise 404, the same answer for "malformed",
 *    "not in your catalogue" and "does not exist", and no state is read.
 * 2. The policy is asked first without a device class. Whether an action is
 *    *allowed* never depends on the device class, only whether it is
 *    *sensitive* — so a refused request is answered 400 before Home Assistant
 *    hears anything.
 * 3. The entity's state is read live. If it cannot be — Home Assistant not
 *    connected, unreachable, or not reporting this entity — the action is
 *    refused with 503. Never "assume harmless": a garage door whose device
 *    class could not be read is a garage door.
 * 4. The policy decides again with the live `device_class`, which is the
 *    decision that counts. A `device_class` in the request body is ignored.
 * 5. Non-sensitive → Home Assistant is called once with the policy's rebuilt
 *    data, and the call is recorded (`recordAction`) so every action is
 *    attributable to the assistant that asked (RFC-011 §7). Sensitive →
 *    `requestConfirmation` stores it (`lib/home/action-requests.ts`), and
 *    nothing runs until a family member approves it with the settings PIN.
 */

import { allowedActionsFor, decideHomeAction, ENTITY_ID } from "@/lib/home/policy";
import { CatalogueUnavailable, HomeUnavailable, HomeUpstreamError } from "@/lib/home/errors";
import type { CatalogueEntity } from "@/lib/home/catalogue";
import type { HaState } from "@/lib/home/ha-client";
import { retryAfterSeconds, type Budget } from "@/lib/integration-limits";

export interface ConfirmationRequest {
  familyId: string;
  /** The assistant asking, so a revoked token can end its pending requests. */
  tokenId: string;
  tokenName: string;
  entityId: string;
  /** The household's name for the device, and its room — for the screens and the push. */
  entityName: string;
  room: string | null;
  domain: string;
  service: string;
  /** Already validated and rebuilt by the policy; stored and run exactly as is. */
  data: Record<string, unknown>;
}

/** An action that ran without confirmation, and what Home Assistant answered. */
export interface ActionRecord extends Omit<ConfirmationRequest, "room"> {
  ok: boolean;
  status: number;
}

export interface HomeDeps {
  catalogueEntities: (familyId: string) => Promise<CatalogueEntity[]>;
  catalogueEntity: (familyId: string, entityId: string) => Promise<CatalogueEntity | null>;
  getHaStates: (familyId: string, entityIds: readonly string[]) => Promise<Map<string, HaState>>;
  /** One entity's state (`GET /api/states/{id}`); undefined when Home Assistant does not know it. */
  getHaState: (familyId: string, entityId: string) => Promise<HaState | undefined>;
  callHaService: (
    familyId: string, domain: string, service: string, entityId: string, data: Record<string, unknown>,
  ) => Promise<{ ok: boolean; status: number }>;
  /** Store a sensitive action until a family member decides it (RFC-011 §4.3). */
  requestConfirmation: (request: ConfirmationRequest) => Promise<{ requestId: string; expiresAt: string }>;
  /** Attribute an action that ran (RFC-011 §7). A failure is logged, never the action's. */
  recordAction: (record: ActionRecord) => Promise<void>;
  /** Whether the family has a settings PIN — without one, nobody could approve. Throws when unreadable. */
  familyHasPin: (familyId: string) => Promise<boolean>;
  /**
   * May this assistant ask for one more confirmation (ruling 9: 2 waiting, 5
   * per 10 minutes — `lib/integration-limits.ts`)? Spends the budget when it
   * says yes. Throws when the pending requests cannot be read.
   */
  confirmationBudget: (familyId: string, tokenId: string) => Promise<Budget>;
}

export interface HomeResult {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

const MAX_ENTITY_ID = 255;

const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): HomeResult =>
  ({ status, body: { error, code, ...extra } });

const NOT_FOUND = (): HomeResult => fail(404, "not_found", "No such device in this family's catalogue");

/**
 * The `{entity}` path segment as an entity id, or null.
 *
 * Not decoded again: Next already decodes a dynamic segment once before the
 * route sees it (`getRouteMatcher` in next/dist/shared/lib/router/utils/
 * route-matcher.js), so `light%2Ekitchen` arrives as `light.kitchen`. A
 * second decode would accept a double-encoded `light%252Ekitchen` too —
 * harmless only because `ENTITY_ID` is checked after it.
 */
export function parseEntityParam(raw: string): string | null {
  return raw.length <= MAX_ENTITY_ID && ENTITY_ID.test(raw) ? raw : null;
}

// ── attributes ──────────────────────────────────────────────────────────────

/**
 * The attributes an assistant sees. A whitelist, because Home Assistant's
 * attributes carry things that must not leave the house: `entity_picture`
 * holds camera proxy URLs with access tokens, locks report `code_format` and
 * `changed_by`, trackers report coordinates.
 *
 * The RFC-011 Task 8 brief's nine, plus four that the allowed actions need
 * to be used sensibly: `hvac_modes` (the values `set_hvac_mode` accepts),
 * `current_position` (where a cover is, for `set_cover_position`),
 * `percentage` (a fan's speed, for `set_percentage`) and `humidity` (a
 * humidifier's target, for `set_humidity`).
 */
export const ATTRIBUTE_WHITELIST: ReadonlySet<string> = new Set([
  "friendly_name",
  "unit_of_measurement",
  "device_class",
  "brightness",
  "current_temperature",
  "temperature",
  "hvac_mode",
  "hvac_modes",
  "media_title",
  "volume_level",
  "current_position",
  "percentage",
  "humidity",
]);

const MAX_TEXT = 200;
const MAX_MODES = 10;
const MAX_MODE = 32;

/** Numbers: finite or null. Everything else under these keys is dropped. */
const NUMERIC_ATTRIBUTES: ReadonlySet<string> = new Set([
  "brightness", "current_temperature", "temperature", "volume_level",
  "current_position", "percentage", "humidity",
]);
/** Text: at most 200 characters, or null. */
const TEXT_ATTRIBUTES: ReadonlySet<string> = new Set([
  "friendly_name", "unit_of_measurement", "device_class", "hvac_mode", "media_title",
]);

function typedAttribute(key: string, raw: unknown): unknown {
  if (raw === null) return key === "hvac_modes" ? undefined : null;
  if (NUMERIC_ATTRIBUTES.has(key)) return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
  if (TEXT_ATTRIBUTES.has(key)) return typeof raw === "string" ? raw.slice(0, MAX_TEXT) : undefined;
  if (key === "hvac_modes") {
    if (!Array.isArray(raw)) return undefined;
    return raw.filter((m): m is string => typeof m === "string").slice(0, MAX_MODES).map((m) => m.slice(0, MAX_MODE));
  }
  return undefined;
}

/**
 * Whitelisted keys only, each with its own type: the numeric ones finite
 * numbers or null, the text ones strings of at most 200 characters or null,
 * `hvac_modes` at most 10 strings of at most 32. A value of any other type is
 * dropped rather than coerced — a "brightness" that is a string is not a
 * brightness.
 */
export function whitelistAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ATTRIBUTE_WHITELIST) {
    if (!Object.prototype.hasOwnProperty.call(attributes, key)) continue;
    const value = typedAttribute(key, attributes[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function liveDeviceClass(state: HaState | undefined): string | null {
  const value = state?.attributes.device_class;
  return typeof value === "string" ? value : null;
}

function toDevice(entity: CatalogueEntity, state: HaState | undefined) {
  return {
    entity_id: entity.entityId,
    name: entity.name,
    room: entity.room,
    state: state ? state.state.slice(0, 255) : null,
    attributes: state ? whitelistAttributes(state.attributes) : {},
    allowed_actions: allowedActionsFor(entity.entityId, liveDeviceClass(state)),
  };
}

/** Known failures to read → a response; anything else is a bug and propagates (500). */
function readFailure(err: unknown): HomeResult {
  if (err instanceof CatalogueUnavailable) return fail(503, "unavailable", "The device catalogue could not be read");
  if (err instanceof HomeUnavailable) return fail(503, "unavailable", "Home Assistant is not connected to Kinboard");
  if (err instanceof HomeUpstreamError) return fail(502, "upstream_unavailable", "Home Assistant could not be reached");
  throw err;
}

// ── reading ─────────────────────────────────────────────────────────────────

export async function listHomeDevices(familyId: string, deps: HomeDeps): Promise<HomeResult> {
  try {
    const entities = await deps.catalogueEntities(familyId);
    if (entities.length === 0) return { status: 200, body: { devices: [] } };
    const states = await deps.getHaStates(familyId, entities.map((e) => e.entityId));
    return { status: 200, body: { devices: entities.map((e) => toDevice(e, states.get(e.entityId))) } };
  } catch (err) {
    return readFailure(err);
  }
}

export async function getHomeDevice(familyId: string, rawEntity: string, deps: HomeDeps): Promise<HomeResult> {
  const entityId = parseEntityParam(rawEntity);
  if (!entityId) return NOT_FOUND();
  try {
    const entity = await deps.catalogueEntity(familyId, entityId);
    if (!entity) return NOT_FOUND();
    const state = await deps.getHaState(familyId, entity.entityId);
    return { status: 200, body: { device: toDevice(entity, state) } };
  } catch (err) {
    return readFailure(err);
  }
}

// ── acting ──────────────────────────────────────────────────────────────────

function refused(reason: "not_allowed" | "invalid_data", entityId: string, service: string): HomeResult {
  const allowed = allowedActionsFor(entityId, null).map((a) => a.service).join(", ") || "none";
  // Echoed back, so bounded; the policy already refused anything outside [a-z_].
  service = service.slice(0, 64);
  const error = reason === "not_allowed"
    ? `\`${service}\` is not an action an assistant may run on this device. Allowed: ${allowed}`
    : `The data for \`${service}\` is not acceptable for this device`;
  return fail(400, "invalid_request", error, { reason });
}

export async function runHomeAction(
  input: { familyId: string; tokenId: string; tokenName: string; rawEntity: string; body: unknown },
  deps: HomeDeps,
): Promise<HomeResult> {
  const { familyId } = input;
  const entityId = parseEntityParam(input.rawEntity);
  if (!entityId) return NOT_FOUND();

  const body = input.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail(400, "invalid_request", "The body must be an object with a `service`");
  }
  const { service, data } = body as { service?: unknown; data?: unknown };
  if (typeof service !== "string") {
    return fail(400, "invalid_request", "`service` is required");
  }

  // 1. Catalogue only.
  let entity: CatalogueEntity | null;
  try {
    entity = await deps.catalogueEntity(familyId, entityId);
  } catch (err) {
    return readFailure(err);
  }
  if (!entity) return NOT_FOUND();

  // 2. Allowed at all? Independent of the device class, so no read is needed to refuse.
  const allowed = decideHomeAction({ entityId, service, data, deviceClass: null });
  if (!allowed.ok) return refused(allowed.reason, entityId, service);

  // 3. The live state, or nothing happens.
  let state: HaState | undefined;
  try {
    state = await deps.getHaState(familyId, entityId);
  } catch (err) {
    if (err instanceof HomeUnavailable || err instanceof HomeUpstreamError) state = undefined;
    else throw err;
  }
  if (!state) {
    return fail(503, "unavailable", "The device's current state could not be read from Home Assistant, so nothing was done");
  }

  // 4. The decision that counts, with the device class Home Assistant reports now.
  const decision = decideHomeAction({ entityId, service, data, deviceClass: liveDeviceClass(state) });
  if (!decision.ok) return refused(decision.reason, entityId, service);
  const domain = entityId.slice(0, entityId.indexOf("."));

  // 5a. Sensitive: a person confirms on a Kinboard screen, or nothing runs.
  if (decision.sensitive) {
    // No PIN, nobody can approve: say so now rather than leave a request
    // on every screen that no one can allow. Unreadable → refused.
    let hasPin: boolean;
    try {
      hasPin = await deps.familyHasPin(familyId);
    } catch {
      return fail(503, "unavailable", "Kinboard could not check whether this action can be confirmed, so nothing was done");
    }
    if (!hasPin) {
      return fail(
        403,
        "forbidden",
        "This action needs a family member to allow it with the settings PIN, and this family has none. Set a settings PIN in Kinboard to allow this. Nothing was done.",
        { reason: "pin_required" },
      );
    }
    // Before anything is stored or pushed: every request lights up every
    // screen and phone in the house, so one assistant gets a small budget.
    let budget: Budget;
    try {
      budget = await deps.confirmationBudget(familyId, input.tokenId);
    } catch {
      return fail(503, "unavailable", "Kinboard could not check this assistant's pending requests, so nothing was done");
    }
    if (!budget.ok) {
      return {
        ...fail(
          429,
          "rate_limited",
          "This assistant already has requests waiting for confirmation, or has asked too often. Wait for a family member to answer, then try again. Nothing was done.",
        ),
        headers: { "retry-after": String(retryAfterSeconds(budget.retryAfterMs)) },
      };
    }
    const pending = await deps.requestConfirmation({
      familyId, tokenId: input.tokenId, tokenName: input.tokenName,
      entityId, entityName: entity.name, room: entity.room, domain, service, data: decision.data,
    });
    return {
      status: 202,
      body: { status: "pending_confirmation", request_id: pending.requestId, expires_at: pending.expiresAt },
    };
  }

  // 5b. Not sensitive: run it, once.
  let result: { ok: boolean; status: number };
  try {
    result = await deps.callHaService(familyId, domain, service, entityId, decision.data);
  } catch (err) {
    // Not connected: nothing was sent, so there is nothing to attribute.
    if (err instanceof HomeUnavailable) return fail(503, "unavailable", "Home Assistant is not connected to Kinboard");
    throw err;
  }
  // The action has happened (or may have); a failure to record it must not turn that into an error.
  try {
    await deps.recordAction({
      familyId, tokenId: input.tokenId, tokenName: input.tokenName,
      entityId, entityName: entity.name, domain, service, data: decision.data,
      ok: result.ok, status: result.status,
    });
  } catch (err) {
    console.error("[home] could not record the action:", err instanceof Error ? err.message : "error");
  }
  if (!result.ok) {
    return fail(
      502,
      "upstream_unavailable",
      "Home Assistant did not confirm the action. It may or may not have happened — check the device before trying again.",
    );
  }
  return { status: 200, body: { status: "done" } };
}
