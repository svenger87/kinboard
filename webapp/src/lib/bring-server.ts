/**
 * Server-side calls to the Bring! API, shared by the session routes under
 * /api/bring and by the Integration API, which adds to a family's Bring!
 * list when an assistant adds to Kinboard's.
 */

export const BRING_API_URL = "https://api.getbring.com/rest/v2";
export const BRING_API_KEY = "cof4Nc6D8saplXjE3h3HXqHH8m7VU2i1Gs0g85Sp";

/**
 * `bring_settings` as a server route reads it through `getMergedSetting`:
 * the stored, non-secret settings with the access token merged back in from
 * integration_secrets. Never sent to a browser in this shape.
 */
export interface ServerBringSettings {
  credentials: { accessToken?: string } | null;
  selectedListId?: string | null;
  twoWaySync?: boolean;
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
  const response = await fetch(`${BRING_API_URL}/bringlists/${listId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-BRING-API-KEY": BRING_API_KEY,
      "X-BRING-CLIENT": "webApp",
      "X-BRING-CLIENT-SOURCE": "webApp",
      "X-BRING-COUNTRY": "DE",
    },
    body: new URLSearchParams({
      uuid: listId,
      purchase: itemName,
      specification: specification || "",
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to add item: ${response.status}`);
  }
}
