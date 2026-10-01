import { safeFetch } from "@/lib/safe-fetch";
import { isAcceptableRedirectUri } from "@/lib/oauth/redirect";
import { findDcrClient } from "@/lib/oauth/store";
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

async function fetchClientMetadataDocument(url: string): Promise<unknown> {
  const response = await safeFetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`client metadata returned ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_DOCUMENT_BYTES) throw new Error("client metadata too large");
  return JSON.parse(text);
}

const defaultDeps: ClientDeps = { fetchDocument: fetchClientMetadataDocument, findRegistered: findDcrClient };

export async function resolveClient(clientId: string, deps: ClientDeps = defaultDeps, now: number = Date.now()): Promise<OAuthClient | null> {
  if (!isCimdClientId(clientId)) return deps.findRegistered(clientId);
  const hit = cache.get(clientId);
  if (hit && hit.until > now) return hit.client;
  try {
    const client = parseClientMetadataDocument(clientId, await deps.fetchDocument(clientId));
    if (client) cache.set(clientId, { client, until: now + CACHE_MS });
    return client;
  } catch {
    return null;
  }
}
