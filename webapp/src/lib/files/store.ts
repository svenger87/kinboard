import { createReadStream, type Stats } from "node:fs";
import { link, mkdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";

/**
 * Uploaded files, kept as plain files on the install's own disk.
 *
 * `<FILES_DIR>/<bucket>/<key>` — the bucket and key are the same ones the
 * stored URLs carry (`/storage/v1/object/public/<bucket>/<key>`), so every URL
 * already in the database keeps resolving. FILES_DIR is `/var/lib/storage/files`
 * in the stack: inside the storage volume the old storage-api container used,
 * so the backup that archives that directory covers both, and the entrypoint
 * can hard-link the old objects across without copying them
 * (webapp-entrypoint.sh, "files from storage-api").
 *
 * This replaced supabase/storage-api plus imgproxy: two containers serving
 * five buckets of images that only ever reached them through this app.
 */

/** Buckets anyone may read by URL — what storage-api's public buckets were. */
export const PUBLIC_BUCKETS = ["recipe-images", "vehicle-images", "goal-images", "device-images"] as const;
/** Buckets read only through a signed URL (lib/files/signed.ts). */
export const PRIVATE_BUCKETS = ["family-photos"] as const;

export type PublicBucket = (typeof PUBLIC_BUCKETS)[number];
export type Bucket = PublicBucket | (typeof PRIVATE_BUCKETS)[number];

export function isPublicBucket(bucket: string): bucket is PublicBucket {
  return (PUBLIC_BUCKETS as readonly string[]).includes(bucket);
}

export function isBucket(bucket: string): bucket is Bucket {
  return isPublicBucket(bucket) || (PRIVATE_BUCKETS as readonly string[]).includes(bucket);
}

/**
 * Where the files live, or null when this install has not been given a place.
 *
 * Null means a compose file from before 1.15: the webapp image moved on (a
 * Watchtower update, a failed `git pull`) but the storage volume is not
 * mounted into it yet, and anything written here would vanish with the
 * container. Uploads refuse rather than lose a photo; reads fall back to the
 * old storage container (app/storage/v1/object/public).
 */
export function filesRoot(env: Record<string, string | undefined> = process.env): string | null {
  const dir = env.FILES_DIR?.trim();
  return dir ? path.resolve(dir) : null;
}

export class FilesNotConfiguredError extends Error {
  constructor() {
    super(
      "FILES_DIR is not set: this webapp image needs the storage volume mounted. " +
        "Update docker-compose.yml (git pull) and recreate the stack — see UPGRADING.md.",
    );
    this.name = "FilesNotConfiguredError";
  }
}

/**
 * The file for a bucket and key, or null for anything that is not one.
 *
 * Keys come from URLs and from database rows, so they are checked here and not
 * trusted: no empty, `.` or `..` segment, no backslash or NUL, and the result
 * must still be inside the bucket after resolution.
 */
export function objectFile(bucket: string, key: string, root: string): string | null {
  if (!isBucket(bucket)) return null;
  if (!key || key.length > 1024 || /[\\\0]/.test(key)) return null;
  const segments = key.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  const bucketDir = path.join(root, bucket);
  const file = path.resolve(bucketDir, ...segments);
  return file.startsWith(bucketDir + path.sep) ? file : null;
}

function requireFile(bucket: Bucket, key: string): string {
  const root = filesRoot();
  if (!root) throw new FilesNotConfiguredError();
  const file = objectFile(bucket, key, root);
  if (!file) throw new Error(`invalid object key: ${bucket}/${key}`);
  return file;
}

/**
 * Store a new object. Never overwrites: every key the app writes is unique (a
 * timestamp and a random suffix), so an existing file means a bug, and the
 * write fails rather than replace somebody's photo.
 *
 * Written to a temporary name and hard-linked into place, so a reader never
 * sees half a file and a crash leaves at most a stray temp file.
 */
export async function putObject(bucket: Bucket, key: string, data: Uint8Array): Promise<void> {
  const file = requireFile(bucket, key);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, data, { flag: "wx" });
  try {
    await link(tmp, file);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

/** Remove objects. A key that is already gone is not an error. */
export async function removeObjects(bucket: Bucket, keys: string[]): Promise<void> {
  for (const key of keys) {
    await rm(requireFile(bucket, key), { force: true });
  }
}

// The types the upload routes accept, by the extension they write. Anything
// else is served as bytes: nothing here should be rendered as a document.
const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
};

export function contentTypeFor(key: string): string {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export interface StoredObject {
  stats: Stats;
  contentType: string;
  body: () => ReadableStream<Uint8Array>;
}

/** An object's metadata and a way to stream it, or null when there is none. */
export async function openObject(bucket: Bucket, key: string, root: string): Promise<StoredObject | null> {
  const file = objectFile(bucket, key, root);
  if (!file) return null;
  let stats: Stats;
  try {
    stats = await stat(file);
  } catch {
    return null;
  }
  if (!stats.isFile()) return null;
  return {
    stats,
    contentType: contentTypeFor(key),
    body: () => Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>,
  };
}
