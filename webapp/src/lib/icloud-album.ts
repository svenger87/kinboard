/**
 * iCloud Shared Albums as a photo source.
 *
 * Apple publishes no photo API. What it does publish is the endpoint its own
 * shared-album web player uses, and that is enough: create a Shared Album on
 * an iPhone, turn on "Public Website", and the link it gives you is readable
 * by anything that can speak JSON. No Apple ID, no password, no 2FA, no
 * developer account — and it follows the album, so a photo added on a phone
 * appears on the wall.
 *
 * This is an unofficial interface. It is stable enough that a small industry
 * of photo frames depends on it, but Apple owes us nothing, so every failure
 * path here degrades to "no photos" rather than to an exception.
 *
 * THE THREE THINGS THAT MAKE IT AWKWARD
 *
 * 1. The album lives on one of many shards (p23-, p64-, …). The right one is
 *    encoded in the token, but the server also tells you: ask the wrong shard
 *    and it answers 330 with the correct host. Following the redirect is
 *    simpler and more durable than reimplementing Apple's base62 scheme.
 * 2. Metadata and image URLs are two different calls. `webstream` lists the
 *    photos and their derivatives; `webasseturls` turns checksums into signed
 *    URLs.
 * 3. Those URLs expire, in about an hour. Nothing here caches them, and
 *    callers must not store them — the photo list is re-fetched instead.
 */

const ICLOUD_TIMEOUT_MS = 15_000;
const DEFAULT_PARTITION = "p01";

export interface IcloudDerivative {
  checksum: string;
  fileSize: number;
  width: number;
  height: number;
}

export interface IcloudPhoto {
  guid: string;
  caption: string | null;
  /** ISO-ish string as Apple returns it. */
  dateCreated: string | null;
  derivatives: IcloudDerivative[];
}

export interface IcloudAlbum {
  streamName: string;
  photos: IcloudPhoto[];
  /** The host that answered — reuse it for the asset-url call. */
  host: string;
}

export interface IcloudResolvedPhoto {
  id: string;
  caption: string | null;
  dateCreated: string | null;
  url: string;
  width: number;
  height: number;
}

/**
 * Pull the album token out of whatever the owner pasted.
 *
 * Apple hands out `https://www.icloud.com/sharedalbum/#B0x5CjqPFhOZ1B` and
 * `https://share.icloud.com/photos/B0x5CjqPFhOZ1B`, and people paste both, plus
 * the bare token. Tokens start with a capital letter and are otherwise
 * alphanumeric.
 */
export function parseAlbumToken(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  // Bare token
  if (/^[A-Z][0-9A-Za-z]{9,}$/.test(raw)) return raw;

  try {
    const url = new URL(raw);
    if (!url.hostname.endsWith("icloud.com")) return null;
    // #token on the classic link, or the last path segment on the share link.
    const fromHash = url.hash.replace(/^#/, "");
    if (/^[A-Z][0-9A-Za-z]{9,}$/.test(fromHash)) return fromHash;
    const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
    if (/^[A-Z][0-9A-Za-z]{9,}$/.test(last)) return last;
    return null;
  } catch {
    return null;
  }
}

function baseUrl(host: string, token: string): string {
  return `https://${host}/${token}/sharedstreams`;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ICLOUD_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Largest derivative wins — a wall display is not the place to show the 320px one. */
export function pickBestDerivative(derivatives: IcloudDerivative[]): IcloudDerivative | null {
  if (derivatives.length === 0) return null;
  return [...derivatives].sort(
    (a, b) => b.height * b.width - a.height * a.width || b.fileSize - a.fileSize,
  )[0];
}

/** Shape Apple's `derivatives` map into a list, dropping the unusable ones. */
export function parseDerivatives(raw: unknown): IcloudDerivative[] {
  if (!raw || typeof raw !== "object") return [];
  const out: IcloudDerivative[] = [];
  for (const value of Object.values(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const d = value as Record<string, unknown>;
    const checksum = typeof d.checksum === "string" ? d.checksum : null;
    if (!checksum) continue;
    out.push({
      checksum,
      fileSize: Number(d.fileSize) || 0,
      width: Number(d.width) || 0,
      height: Number(d.height) || 0,
    });
  }
  return out;
}

/** Parse a `webstream` response body. Exported for the tests. */
export function parseWebstream(body: unknown, host: string): IcloudAlbum {
  const data = (body ?? {}) as Record<string, unknown>;
  const photos = Array.isArray(data.photos) ? data.photos : [];

  return {
    streamName: typeof data.streamName === "string" ? data.streamName : "iCloud album",
    host,
    photos: photos
      .map((p): IcloudPhoto | null => {
        const photo = p as Record<string, unknown>;
        const guid = typeof photo.photoGuid === "string" ? photo.photoGuid : null;
        if (!guid) return null;
        const derivatives = parseDerivatives(photo.derivatives);
        if (derivatives.length === 0) return null;
        return {
          guid,
          caption: typeof photo.caption === "string" && photo.caption ? photo.caption : null,
          dateCreated:
            typeof photo.dateCreated === "string" ? photo.dateCreated : null,
          derivatives,
        };
      })
      .filter((p): p is IcloudPhoto => p !== null),
  };
}

/**
 * Fetch the album metadata, following the shard redirect once.
 *
 * A 330 carries the correct host in the body; asking that host is the entire
 * handshake. One hop only — a server that keeps redirecting is broken, and a
 * loop here would hang a screensaver.
 */
export async function fetchAlbum(token: string): Promise<IcloudAlbum> {
  let host = `${DEFAULT_PARTITION}-sharedstreams.icloud.com`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await postJson(`${baseUrl(host, token)}/webstream`, { streamCtag: null });

    if (res.status === 330) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const next = body["X-Apple-MMe-Host"];
      if (typeof next === "string" && next && attempt === 0) {
        host = next;
        continue;
      }
      throw new Error("icloud: redirected without a usable host");
    }

    if (res.status === 404) {
      throw new Error("icloud: album not found — is the public website still on?");
    }
    if (!res.ok) {
      throw new Error(`icloud: webstream returned ${res.status}`);
    }

    return parseWebstream(await res.json(), host);
  }

  throw new Error("icloud: too many redirects");
}

/** Turn `webasseturls` output into checksum → URL. Exported for the tests. */
export function parseAssetUrls(body: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const items = (body as Record<string, unknown> | null)?.items;
  if (!items || typeof items !== "object") return out;

  for (const [checksum, value] of Object.entries(items as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    const location = typeof item.url_location === "string" ? item.url_location : null;
    const path = typeof item.url_path === "string" ? item.url_path : null;
    if (!location || !path) continue;
    out.set(checksum, `https://${location}${path}`);
  }
  return out;
}

/**
 * The whole read, end to end: metadata, then signed URLs, then a flat list.
 *
 * One function because the two calls are not independently useful — a caller
 * that has metadata without URLs has nothing to show.
 */
export async function getSharedAlbumPhotos(
  token: string,
  limit = 100,
): Promise<{ streamName: string; photos: IcloudResolvedPhoto[] }> {
  const album = await fetchAlbum(token);

  // Newest first: a shared album is chronological and the recent end is the
  // interesting one.
  const ordered = [...album.photos].sort((a, b) =>
    (b.dateCreated ?? "").localeCompare(a.dateCreated ?? ""),
  );
  const wanted = ordered.slice(0, limit);

  const chosen = wanted
    .map((photo) => ({ photo, derivative: pickBestDerivative(photo.derivatives) }))
    .filter((x): x is { photo: IcloudPhoto; derivative: IcloudDerivative } => x.derivative !== null);

  const photos: IcloudResolvedPhoto[] = [];
  const CHUNK = 100;

  for (let i = 0; i < chosen.length; i += CHUNK) {
    const slice = chosen.slice(i, i + CHUNK);
    const res = await postJson(`${baseUrl(album.host, token)}/webasseturls`, {
      photoGuids: slice.map((s) => s.photo.guid),
    });
    if (!res.ok) continue;
    const urls = parseAssetUrls(await res.json());

    for (const { photo, derivative } of slice) {
      const url = urls.get(derivative.checksum);
      if (!url) continue;
      photos.push({
        id: photo.guid,
        caption: photo.caption,
        dateCreated: photo.dateCreated,
        url,
        width: derivative.width,
        height: derivative.height,
      });
    }
  }

  return { streamName: album.streamName, photos };
}
