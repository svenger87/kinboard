/**
 * A recipe's picture, kept on this server instead of on someone else's.
 *
 * A picture chosen from the web search, or one that came with an imported
 * recipe, was saved as the address of the original: recipes.image_url held
 * "https://upload.wikimedia.org/…/4000px-….jpg". Every screen that showed
 * the recipe then fetched the full-size original from that site, every
 * time its own cache had forgotten it. A page of recipes was dozens of
 * multi-megabyte downloads from sites that throttle or refuse exactly that
 * kind of traffic: pictures missing each morning, minutes to come back,
 * some never.
 *
 * This fetches the picture once, scales it to what a screen needs, stores
 * it in the recipe-images bucket beside the uploaded ones, and gives back
 * the local address.
 */

/** A picture this server does not hold. Uploaded ones are relative paths. */
export function isRemoteImage(url: string | null | undefined): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim());
}

/** Longest edge kept. The largest place a recipe picture is shown is the detail page's header. */
export const KEPT_IMAGE_EDGE = 1600;
/** Refuse to read more than this from the other side. */
export const MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024;
export const REMOTE_IMAGE_TIMEOUT_MS = 20_000;

export type KeepImageFailure = "blocked" | "unreachable" | "not_an_image" | "too_large" | "undecodable" | "storage";

export class KeepImageError extends Error {
  constructor(readonly reason: KeepImageFailure, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
  }
}

export interface KeepImageDeps {
  /** Fetches a user-supplied address; throws for one that may not be fetched. */
  fetchRemote: (url: string, signal: AbortSignal) => Promise<Response>;
  isBlocked: (error: unknown) => boolean;
  /** Decodes, turns upright, scales down to `edge`, encodes as WebP. Throws if it is not a picture. */
  scale: (data: Uint8Array, edge: number) => Promise<Uint8Array>;
  store: (key: string, data: Uint8Array) => Promise<void>;
  urlFor: (key: string) => string;
  /** A name that has not been used: time and something random. */
  stamp: () => string;
}

/**
 * How this server names itself to the sites it fetches pictures from, the
 * way the news reader already does. Wikimedia, where most pictures from the
 * search live, answers a client with no name or a generic one with
 * "429 Too many requests"; it asks for a name with a way to reach whoever
 * runs it (https://meta.wikimedia.org/wiki/User-Agent_policy).
 */
export const KEEP_IMAGE_USER_AGENT = "Kinboard/1.0 (+https://kinboard.app)";

/** The widths Wikimedia serves thumbnails in (https://w.wiki/GHai). */
const WIKIMEDIA_WIDTHS = [330, 500, 960, 1280, 1920, 3840];

/**
 * The addresses to try for a picture, best first.
 *
 * A picture on Wikimedia is saved as the address of the ORIGINAL, often a
 * 10 to 50 megapixel file. Wikimedia refuses to hand those out to embedding
 * pages ("429 … use thumbnail images in sizes listed on https://w.wiki/GHai"),
 * which is why such pictures were missing on recipe pages. Its thumbnail of
 * the next standard width at or above what is kept is tried first: a few
 * hundred kilobytes instead of fifteen megabytes. The original stays as the
 * second try, for a file smaller than that width, which has no such thumbnail.
 */
export function remoteCandidates(url: string, edge: number): string[] {
  const original = url.trim();
  try {
    const parsed = new URL(original);
    const match = /^\/wikipedia\/([a-z0-9-]+)\/([0-9a-f])\/([0-9a-f]{2})\/([^/]+\.(?:jpe?g|png|gif|webp))$/i.exec(parsed.pathname);
    if (parsed.hostname === "upload.wikimedia.org" && match && match[3].startsWith(match[2])) {
      const [, project, a, ab, file] = match;
      const width = WIKIMEDIA_WIDTHS.find((w) => w >= edge) ?? WIKIMEDIA_WIDTHS[WIKIMEDIA_WIDTHS.length - 1];
      return [`https://upload.wikimedia.org/wikipedia/${project}/thumb/${a}/${ab}/${file}/${width}px-${file}`, original];
    }
  } catch {
    // Not an address at all: the fetch will say so.
  }
  return [original];
}

/** Reads a body up to a limit, and gives up past it rather than buffering whatever is sent. */
async function readUpTo(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) throw new KeepImageError("too_large");
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new KeepImageError("too_large");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return all;
}

/** One address: its bytes, or a KeepImageError saying why not. */
async function fetchPicture(url: string, deps: KeepImageDeps): Promise<Uint8Array> {
  try {
    const response = await deps.fetchRemote(url, AbortSignal.timeout(REMOTE_IMAGE_TIMEOUT_MS));
    if (!response.ok) throw new KeepImageError("unreachable", `status ${response.status}`);
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    // Some hosts send no type or a generic one for a picture; the decoder is the judge of those.
    if (type && !type.startsWith("image/") && !type.startsWith("application/octet-stream") && !type.startsWith("binary/")) {
      throw new KeepImageError("not_an_image", type.slice(0, 60));
    }
    return await readUpTo(response, MAX_REMOTE_IMAGE_BYTES);
  } catch (error) {
    if (error instanceof KeepImageError) throw error;
    if (deps.isBlocked(error)) throw new KeepImageError("blocked");
    throw new KeepImageError("unreachable", error instanceof Error ? error.message : String(error));
  }
}

/** Fetch `remoteUrl`, scale it, store it for `familyId`; the local address. Throws KeepImageError. */
export async function keepRemoteImage(
  remoteUrl: string,
  familyId: string,
  deps: KeepImageDeps,
  edge: number = KEPT_IMAGE_EDGE,
): Promise<string> {
  let data: Uint8Array | null = null;
  let last: KeepImageError | null = null;
  for (const candidate of remoteCandidates(remoteUrl, edge)) {
    try {
      data = await fetchPicture(candidate, deps);
      break;
    } catch (error) {
      last = error as KeepImageError;
      // An address that may not be fetched is not retried under another spelling.
      if (last.reason === "blocked") break;
    }
  }
  if (!data) throw last ?? new KeepImageError("unreachable");

  let scaled: Uint8Array;
  try {
    scaled = await deps.scale(data, edge);
  } catch (error) {
    throw new KeepImageError("undecodable", error instanceof Error ? error.message : String(error));
  }

  const key = `${familyId}/${deps.stamp()}.webp`;
  try {
    await deps.store(key, scaled);
  } catch (error) {
    throw new KeepImageError("storage", error instanceof Error ? error.message : String(error));
  }
  return deps.urlFor(key);
}

/**
 * For a backup: rows as they were before their pictures were kept.
 *
 * `sources` maps a kept copy's address to the address it was made from
 * (migration 093). A JSON export carries no files, so a row pointing at a
 * kept copy would be a broken picture wherever the backup is restored
 * without the storage volume; with the original address it loads from the
 * web there, and is kept again the first time it is shown.
 */
export function withSourceAddresses<T extends Record<string, unknown>>(
  rows: readonly T[] | null | undefined,
  sources: ReadonlyMap<string, string>,
): T[] {
  return (rows ?? []).map((row) => {
    let changed: Record<string, unknown> | null = null;
    for (const column of ["image_url", "thumbnail_url"]) {
      const value = row[column];
      const source = typeof value === "string" ? sources.get(value) : undefined;
      if (source) (changed ??= { ...row })[column] = source;
    }
    return (changed as T | null) ?? row;
  });
}

