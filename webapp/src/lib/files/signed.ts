import { createHmac, timingSafeEqual } from "node:crypto";
import type { Bucket } from "@/lib/files/store";

/**
 * Signed URLs for the private bucket (family photos, RFC-009 §3.1).
 *
 * `/storage/v1/object/sign/<bucket>/<key>?exp=<unix seconds>&sig=<hex>`, where
 * the signature is an HMAC-SHA256 over `<bucket>/<key>:<exp>` with the stack's
 * JWT_SECRET. Same path shape storage-api used, relative like every other
 * stored URL, so it resolves against whatever address the page came from.
 *
 * Whoever holds the URL holds the photo until it expires — that is what a
 * signed URL is, and the reason the lifetime is short.
 */

function secret(env: Record<string, string | undefined>): string {
  const value = env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET is not set; cannot sign storage URLs");
  return value;
}

function signature(bucket: string, key: string, exp: number, env: Record<string, string | undefined>): string {
  return createHmac("sha256", secret(env)).update(`${bucket}/${key}:${exp}`).digest("hex");
}

export function signedObjectUrl(
  bucket: Bucket,
  key: string,
  ttlSeconds: number,
  now: number = Date.now(),
  env: Record<string, string | undefined> = process.env,
): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const sig = signature(bucket, key, exp, env);
  return `/storage/v1/object/sign/${bucket}/${encodeURI(key)}?exp=${exp}&sig=${sig}`;
}

/** Whether `sig` signs this object until `exp`, and `exp` has not passed. */
export function verifySignedObject(
  bucket: string,
  key: string,
  exp: string | null,
  sig: string | null,
  now: number = Date.now(),
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const expires = Number(exp);
  if (expires * 1000 < now) return false;
  const expected = Buffer.from(signature(bucket, key, expires, env), "hex");
  return timingSafeEqual(expected, Buffer.from(sig, "hex"));
}
