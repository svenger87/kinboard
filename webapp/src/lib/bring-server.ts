/**
 * Server-side calls to the Bring! API, shared by the session routes under
 * /api/bring, by the Integration API, which adds to a family's Bring!
 * list when an assistant adds to Kinboard's, and by the pull sync
 * (lib/bring-sync.ts).
 */

import { getMergedSetting, upsertSecrets } from "@/lib/integration-secrets";

export const BRING_API_URL = "https://api.getbring.com/rest/v2";
export const BRING_API_KEY = "cof4Nc6D8saplXjE3h3HXqHH8m7VU2i1Gs0g85Sp";

/** The headers every Bring! API call carries; `Authorization` is added per call. */
export const BRING_HEADERS: Record<string, string> = {
  "X-BRING-API-KEY": BRING_API_KEY,
  "X-BRING-CLIENT": "webApp",
  "X-BRING-CLIENT-SOURCE": "webApp",
  "X-BRING-COUNTRY": "DE",
};

/**
 * `bring_settings` as a server route reads it through `getMergedSetting`:
 * the stored, non-secret settings with the access token merged back in from
 * integration_secrets. Never sent to a browser in this shape.
 */
export interface ServerBringSettings {
  credentials: { accessToken?: string; refreshToken?: string; uuid?: string } | null;
  selectedListId?: string | null;
  autoSync?: boolean;
  twoWaySync?: boolean;
  syncCategories?: boolean;
}

/**
 * A Bring! list id is a UUID. The routes take it from the request, and it
 * becomes part of the URL path, so anything else is refused before a
 * request is made (`../` would otherwise walk to another endpoint).
 */
const BRING_LIST_ID = /^[A-Za-z0-9-]{1,64}$/;

/** Bring! answered 401: the access token is no longer accepted. */
export class BringAuthError extends Error {
  constructor(message = "Bring! rejected the access token") {
    super(message);
    this.name = "BringAuthError";
  }
}

/** Put one item on a Bring! list ("purchase"). Throws on a non-2xx answer. */
export async function addBringListItem({
  accessToken,
  listId,
  itemName,
  specification,
  signal,
}: {
  accessToken: string;
  listId: string;
  itemName: string;
  specification?: string;
  signal?: AbortSignal;
}): Promise<void> {
  if (!BRING_LIST_ID.test(listId)) throw new Error("Invalid Bring! list id");
  const response = await fetch(`${BRING_API_URL}/bringlists/${listId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...BRING_HEADERS,
    },
    body: new URLSearchParams({
      uuid: listId,
      purchase: itemName,
      specification: specification || "",
    }),
    signal,
  });

  if (response.status === 401) throw new BringAuthError();
  if (!response.ok) {
    throw new Error(`Failed to add item: ${response.status}`);
  }
}

/**
 * Move one item to the list's "recently" section, which is what ticking it
 * off in the Bring! app does. `itemName` is the Bring! key (a German catalogue
 * name such as "Milch" for a catalogue item), not a translation of it.
 */
export async function removeBringListItem({
  accessToken,
  listId,
  itemName,
  signal,
}: {
  accessToken: string;
  listId: string;
  itemName: string;
  signal?: AbortSignal;
}): Promise<void> {
  if (!BRING_LIST_ID.test(listId)) throw new Error("Invalid Bring! list id");
  const response = await fetch(`${BRING_API_URL}/bringlists/${listId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...BRING_HEADERS,
    },
    body: new URLSearchParams({ uuid: listId, recently: itemName }),
    signal,
  });

  if (response.status === 401) throw new BringAuthError();
  if (!response.ok) {
    throw new Error(`Failed to remove item: ${response.status}`);
  }
}

export interface BringListItem {
  /** The Bring! key: the German catalogue name for a catalogue item, or the text typed. */
  name: string;
  specification: string;
}

export interface BringListContents {
  uuid: string;
  purchase: BringListItem[];
  recently: BringListItem[];
}

/** Read a list: what is still to buy (`purchase`) and what was bought (`recently`). */
export async function getBringList({
  accessToken,
  listId,
  signal,
}: {
  accessToken: string;
  listId: string;
  signal?: AbortSignal;
}): Promise<BringListContents> {
  if (!BRING_LIST_ID.test(listId)) throw new Error("Invalid Bring! list id");
  const response = await fetch(`${BRING_API_URL}/bringlists/${listId}`, {
    headers: { Authorization: `Bearer ${accessToken}`, ...BRING_HEADERS },
    signal,
    cache: "no-store",
  });

  if (response.status === 401) throw new BringAuthError();
  if (!response.ok) {
    throw new Error(`Failed to fetch items: ${response.status}`);
  }

  const data = await response.json();
  const items = (list: unknown): BringListItem[] =>
    Array.isArray(list)
      ? list
          .filter((item) => item && typeof item.name === "string" && item.name.trim() !== "")
          .map((item) => ({ name: item.name, specification: item.specification || "" }))
      : [];
  return { uuid: data?.uuid ?? listId, purchase: items(data?.purchase), recently: items(data?.recently) };
}

/**
 * Trade the refresh token for a new access token and store it.
 *
 * The access token `/bringauth` hands out lasts about a week (`expires_in`).
 * Nothing used to renew it, so a week after signing in every push failed —
 * logged, never shown — until somebody signed in again.
 *
 * Returns the new access token, or null when there is no refresh token or
 * Bring! will not renew it (the user has to sign in again).
 */
export async function refreshBringToken(familyId: string, refreshToken: string | undefined): Promise<string | null> {
  if (!refreshToken) return null;
  const response = await fetch(`${BRING_API_URL}/bringauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...BRING_HEADERS },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    cache: "no-store",
  });
  if (!response.ok) {
    console.error(`[bring] refreshing the access token failed: ${response.status}`);
    return null;
  }
  const data = await response.json();
  const accessToken: unknown = data?.access_token;
  if (typeof accessToken !== "string" || !accessToken) return null;
  await upsertSecrets(familyId, "bring_settings", {
    credentials: {
      accessToken,
      // Bring! may or may not rotate the refresh token; keep the old one if not.
      refreshToken: typeof data?.refresh_token === "string" && data.refresh_token ? data.refresh_token : refreshToken,
    },
  });
  return accessToken;
}

/**
 * Run `call` with the family's access token, and once more with a renewed
 * one when Bring! answers 401. A refresh that fails re-reads the stored
 * token first: a concurrent request may have just renewed it, and with a
 * rotating refresh token only the first renewal succeeds.
 *
 * Throws BringAuthError when there is no token or it cannot be renewed.
 */
export async function withBringAccess<T>(
  familyId: string,
  settings: ServerBringSettings | null,
  call: (accessToken: string) => Promise<T>,
): Promise<T> {
  const tried = settings?.credentials?.accessToken;
  if (!tried) throw new BringAuthError("Bring! is not connected");
  try {
    return await call(tried);
  } catch (err) {
    if (!(err instanceof BringAuthError)) throw err;
  }

  let renewed = await refreshBringToken(familyId, settings?.credentials?.refreshToken);
  if (!renewed) {
    const latest = await getMergedSetting<ServerBringSettings>(familyId, "bring_settings");
    const stored = latest?.credentials?.accessToken;
    if (stored && stored !== tried) renewed = stored;
  }
  if (!renewed) throw new BringAuthError("Bring! rejected the access token and it could not be renewed");
  return call(renewed);
}
