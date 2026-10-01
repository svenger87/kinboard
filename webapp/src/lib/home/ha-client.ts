/**
 * The only way the Integration API's home routes talk to Home Assistant.
 *
 * Deliberately not `/api/homeassistant/services`, the session route the
 * screens use: that one forwards whatever domain, service and data it is
 * given. Here the domain and service have already passed `decideHomeAction`
 * (`lib/home/policy.ts`), and this module only adds what every request to
 * Home Assistant must have:
 *
 * - the base from `homeAssistantBase()` — http(s) only, no credentials, query
 *   or fragment in the configured URL — or no request at all;
 * - every path segment `encodeURIComponent`-ed;
 * - `redirect: "error"`, so a redirect cannot carry the bearer token
 *   somewhere else, and a 10 s timeout;
 * - the token in a header only, and never in an error message.
 *
 * `io` exists for the specs (a stub `fetch` and settings loader); the routes
 * never pass it.
 */

import { getMergedSetting } from "@/lib/integration-secrets";
import { homeAssistantBase } from "@/lib/integration-energy";
import type { HomeAssistantSettings } from "@/types/home-assistant";
import { HomeUnavailable, HomeUpstreamError } from "@/lib/home/errors";

export interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  /** When the state or an attribute last changed, as Home Assistant reports it. */
  last_updated?: string;
}

export interface HaIo {
  fetch?: typeof fetch;
  loadSettings?: (familyId: string) => Promise<HomeAssistantSettings | null>;
}

export const HA_TIMEOUT_MS = 10_000;
/**
 * The most of `GET /api/states` read — by the home catalogue, the vehicles
 * and the energy read alike, all of which fetch the whole list to pick out
 * a few entities. A large install's list passes 2 MiB (every entity with
 * its attributes, and energy dashboards come with many), so 2 MiB refused
 * real households. Still a cap: the answer is buffered in memory.
 */
export const HA_STATES_MAX_BYTES = 16 * 1024 * 1024;
/** The most of one entity's `GET /api/states/{id}` read. */
export const HA_STATE_MAX_BYTES = 256 * 1024;

function under(base: URL, path: string): URL {
  return new URL(`${base.pathname.replace(/\/$/, "")}${path}`, base);
}

export function haStatesUrl(base: URL): URL {
  return under(base, "/api/states");
}

/** One entity's state; the id is one percent-encoded path segment. */
export function haStateUrl(base: URL, entityId: string): URL {
  return under(base, `/api/states/${encodeURIComponent(entityId)}`);
}

export function haServiceUrl(base: URL, domain: string, service: string): URL {
  return under(base, `/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`);
}

async function connection(familyId: string, io: HaIo): Promise<{ base: URL; token: string }> {
  const load = io.loadSettings
    ?? ((id: string) => getMergedSetting<HomeAssistantSettings>(id, "home_assistant"));
  let settings: HomeAssistantSettings | null;
  try {
    settings = await load(familyId);
  } catch {
    // Settings or secrets unreadable: refused, never "assumed connected".
    throw new HomeUnavailable("The Home Assistant settings could not be read");
  }
  const token = settings?.access_token;
  if (!settings || typeof settings.url !== "string" || typeof token !== "string" || token === "") {
    throw new HomeUnavailable();
  }
  const base = homeAssistantBase(settings.url);
  if (!base) throw new HomeUnavailable("The Home Assistant address is not usable");
  return { base, token };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The body as JSON, refusing more than `maxBytes` — announced or actually sent. */
async function readJsonAtMost(response: Response, maxBytes: number): Promise<unknown> {
  const announced = Number(response.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new HomeUpstreamError("Home Assistant's answer was too large");
  }
  if (!response.body) throw new HomeUpstreamError("Home Assistant returned an empty answer");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HomeUpstreamError("Home Assistant's answer was too large");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function toState(item: unknown): HaState | null {
  if (!isPlainObject(item)) return null;
  const { entity_id: id, state, attributes, last_updated: lastUpdated } = item;
  if (typeof id !== "string" || typeof state !== "string") return null;
  const out: HaState = { entity_id: id, state, attributes: isPlainObject(attributes) ? attributes : {} };
  if (typeof lastUpdated === "string") out.last_updated = lastUpdated;
  return out;
}

async function haGet(familyId: string, url: (base: URL) => URL, io: HaIo): Promise<Response> {
  const { base, token } = await connection(familyId, io);
  const doFetch = io.fetch ?? fetch;
  try {
    return await doFetch(url(base), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(HA_TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new HomeUpstreamError("Home Assistant could not be reached");
  }
}

/**
 * One entity's current state, from `GET /api/states/{entity_id}` — for
 * reading or acting on one device, without fetching every state in the
 * house. Undefined when Home Assistant does not know the entity (404).
 *
 * Throws `HomeUnavailable` (not connected) or `HomeUpstreamError` (asked and
 * no usable answer, including an answer about a different entity).
 */
export async function getHaState(familyId: string, entityId: string, io: HaIo = {}): Promise<HaState | undefined> {
  const response = await haGet(familyId, (base) => haStateUrl(base, entityId), io);
  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new HomeUpstreamError(`Home Assistant returned ${response.status}`);
  }
  let body: unknown;
  try {
    body = await readJsonAtMost(response, HA_STATE_MAX_BYTES);
  } catch (err) {
    if (err instanceof HomeUpstreamError) throw err;
    throw new HomeUpstreamError("Home Assistant returned an unexpected answer");
  }
  const state = toState(body);
  if (!state || state.entity_id !== entityId) throw new HomeUpstreamError("Home Assistant returned an unexpected answer");
  return state;
}

/**
 * The current state of the given entities, from one `GET /api/states` —
 * the same request the screens make, filtered here so nothing outside
 * `entityIds` leaves this function. An entity Home Assistant does not report
 * is simply absent from the map. For listing the catalogue; one device is
 * read with `getHaState`. The answer is read up to HA_STATES_MAX_BYTES.
 *
 * Throws `HomeUnavailable` (not connected) or `HomeUpstreamError` (asked and
 * no usable answer).
 */
export async function getHaStates(familyId: string, entityIds: readonly string[], io: HaIo = {}): Promise<Map<string, HaState>> {
  const response = await haGet(familyId, haStatesUrl, io);
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new HomeUpstreamError(`Home Assistant returned ${response.status}`);
  }
  let body: unknown;
  try {
    body = await readJsonAtMost(response, HA_STATES_MAX_BYTES);
  } catch (err) {
    if (err instanceof HomeUpstreamError) throw err;
    throw new HomeUpstreamError("Home Assistant returned an unexpected answer");
  }
  if (!Array.isArray(body)) throw new HomeUpstreamError("Home Assistant returned an unexpected answer");

  const wanted = new Set(entityIds);
  const found = new Map<string, HaState>();
  for (const item of body) {
    const state = toState(item);
    if (state && wanted.has(state.entity_id)) found.set(state.entity_id, state);
  }
  // In the order asked for, not Home Assistant's.
  return new Map(entityIds.filter((id) => found.has(id)).map((id) => [id, found.get(id)!]));
}

/**
 * Call one service on one entity. The body is exactly `data` plus the
 * entity id, which is written last so no key in `data` can retarget the call
 * (the policy refuses `entity_id` in data anyway).
 *
 * Throws `HomeUnavailable` before any request when Home Assistant is not
 * connected. A network failure or timeout is `{ ok: false, status: 0 }`: the
 * action may or may not have happened, which the caller has to say.
 */
export async function callHaService(
  familyId: string,
  domain: string,
  service: string,
  entityId: string,
  data: Record<string, unknown>,
  io: HaIo = {},
): Promise<{ ok: boolean; status: number }> {
  const { base, token } = await connection(familyId, io);
  const doFetch = io.fetch ?? fetch;
  try {
    const response = await doFetch(haServiceUrl(base, domain, service), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, entity_id: entityId }),
      signal: AbortSignal.timeout(HA_TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });
    // The answer (the changed states) is not needed and not passed on.
    await response.body?.cancel().catch(() => undefined);
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
