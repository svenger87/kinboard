import { safeFetch } from "@/lib/safe-fetch";
import { isAcceptableRedirectUri } from "@/lib/oauth/redirect";
import { countDcrClientsSince, findDcrClient, sweepUnusedDcrClients } from "@/lib/oauth/store";
import { logApiError } from "@/lib/api-error";
import type { OAuthClient } from "@/lib/oauth/types";

/**
 * Who is asking (RFC-010 §3.2). CIMD first — the client_id is a URL whose
 * document describes the client — then DCR rows. Every client is treated as a
 * public client: PKCE is what protects the code, and we advertise only
 * `token_endpoint_auth_method: none`, so a document's own auth method is not
 * a reason to refuse it.
 */
const MAX_DOCUMENT_BYTES = 16 * 1024;
const CACHE_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 100;
const cache = new Map<string, { client: OAuthClient; until: number }>();

export interface ClientDeps {
  fetchDocument(url: string): Promise<unknown>;
  findRegistered(clientId: string): Promise<OAuthClient | null>;
}

export function isCimdClientId(id: string): boolean {
  if (id.length > 512) return false;
  try {
    const u = new URL(id);
    return u.protocol === "https:" && u.pathname !== "/" && !u.hash && !u.username && !u.password;
  } catch {
    return false;
  }
}

function acceptableRedirects(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return null;
  if (!value.every((u) => typeof u === "string" && isAcceptableRedirectUri(u))) return null;
  return value as string[];
}

export function parseClientMetadataDocument(url: string, doc: unknown): OAuthClient | null {
  if (!doc || typeof doc !== "object") return null;
  const d = doc as Record<string, unknown>;
  if (d.client_id !== url) return null;
  const redirectUris = acceptableRedirects(d.redirect_uris);
  if (!redirectUris) return null;
  const name = typeof d.client_name === "string" && d.client_name.trim() ? d.client_name.trim() : new URL(url).hostname;
  return { clientId: url, clientName: name.slice(0, 100), redirectUris, kind: "cimd" };
}

export function parseRegistrationRequest(body: unknown):
  | { ok: true; clientName: string; redirectUris: string[] }
  | { ok: false; error: "invalid_redirect_uri" | "invalid_client_metadata"; description: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_client_metadata", description: "expected a JSON object" };
  const b = body as Record<string, unknown>;
  const redirectUris = acceptableRedirects(b.redirect_uris);
  if (!redirectUris) {
    return { ok: false, error: "invalid_redirect_uri", description: "redirect_uris must list 1-20 https or http-loopback URIs" };
  }
  const clientName = typeof b.client_name === "string" && b.client_name.trim() ? b.client_name.trim().slice(0, 100) : "Assistant";
  return { ok: true, clientName, redirectUris };
}

/**
 * The per-address limit on /api/oauth/register (10 an hour) does nothing
 * against many addresses. This is the install-wide ceiling: past 50 new
 * clients in an hour, registration answers 429 until the hour rolls over. A
 * household connects a handful of assistants, ever; 50 an hour is an attack
 * or a broken client, and either way the table should stop growing.
 */
export const DCR_HOURLY_CAP = 50;
/** A registered client that never got a connection is deleted after this. */
export const DCR_UNUSED_TTL_MS = 7 * 24 * 60 * 60_000;

export interface RegistrationDeps {
  countSince(sinceIso: string): Promise<number>;
  sweepUnused(beforeIso: string): Promise<void>;
}

const defaultRegistrationDeps: RegistrationDeps = { countSince: countDcrClientsSince, sweepUnused: sweepUnusedDcrClients };

/**
 * Whether one more DCR registration may be written now. Sweeps week-old
 * clients that never got a connection on the way — opportunistically, like
 * the authorization-request sweep: its failure is logged and does not block
 * a registration. A failed count does block it (throws): an unknown total
 * must not read as "under the cap".
 */
export async function admitDcrRegistration(deps: RegistrationDeps = defaultRegistrationDeps, now: number = Date.now()): Promise<boolean> {
  try {
    await deps.sweepUnused(new Date(now - DCR_UNUSED_TTL_MS).toISOString());
  } catch (err) {
    console.error("[oauth] sweep of unused registered clients failed", err);
  }
  return (await deps.countSince(new Date(now - 60 * 60_000).toISOString())) < DCR_HOURLY_CAP;
}

export async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  // Check content-length header first to avoid reading a too-large body
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const bytes = parseInt(contentLength, 10);
    if (bytes > maxBytes) throw new Error("client metadata too large");
  }

  if (!response.body) throw new Error("no response body");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.length;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error("client metadata too large");
      }
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel();
    throw err;
  }

  const concatenated = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    concatenated.set(chunk, offset);
    offset += chunk.length;
  }

  const text = new TextDecoder().decode(concatenated);
  return JSON.parse(text);
}

async function fetchClientMetadataDocument(url: string): Promise<unknown> {
  const response = await safeFetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`client metadata returned ${response.status}`);
  return readBoundedJson(response, MAX_DOCUMENT_BYTES);
}

const defaultDeps: ClientDeps = { fetchDocument: fetchClientMetadataDocument, findRegistered: findDcrClient };

// Test-only helper to inspect cache size
export function clientCacheSize(): number {
  return cache.size;
}

export async function resolveClient(clientId: string, deps: ClientDeps = defaultDeps, now: number = Date.now()): Promise<OAuthClient | null> {
  if (!isCimdClientId(clientId)) return deps.findRegistered(clientId);
  const hit = cache.get(clientId);
  if (hit && hit.until > now) return hit.client;
  try {
    const client = parseClientMetadataDocument(clientId, await deps.fetchDocument(clientId));
    if (client) {
      // Delete expired entries before writing new ones
      for (const [key, value] of cache) {
        if (value.until <= now) {
          cache.delete(key);
        }
      }
      // Evict oldest entries if cache is at capacity
      while (cache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey) cache.delete(oldestKey);
      }
      cache.set(clientId, { client, until: now + CACHE_MS });
    }
    return client;
  } catch (err) {
    // A bad or unreachable CIMD document is routine — most of the internet
    // is not a Kinboard client — but logging it means a *persistent* failure
    // (our own egress broken, a client's document newly malformed) is still
    // visible instead of silently turning into "unknown client" for every
    // caller. The outer .catch() in oauth/authorize/route.ts cannot see this
    // error: it is swallowed right here, before it would ever reach there.
    await logApiError("oauth/authorize/client", err);
    return null;
  }
}
