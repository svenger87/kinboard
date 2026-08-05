import { NextRequest } from "next/server";

/**
 * A small in-memory rate limiter.
 *
 * Best-effort and process-local: it resets on deploy and does not coordinate
 * across replicas. Kinboard runs a single webapp container (see
 * docker-compose.yml), so that is enough to blunt brute force and stop cheap
 * resource exhaustion — it is deliberately not a distributed limiter, which
 * would need Redis and a topology this project does not have.
 *
 * The PIN endpoint had its own copy of this pattern; the join and create
 * endpoints needed the same thing, so it lives here now.
 */

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

/**
 * Register a hit against `key` and report whether it is now over `limit`
 * within the trailing `windowMs`. Old hits are pruned as they are counted, so
 * the map does not grow without bound for a key that goes quiet — but see
 * sweepIdle() for keys that never come back.
 */
export function hitLimit(key: string, limit: number, windowMs: number): { limited: boolean; retryAfterMs: number } {
  const now = nowMs();
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket);
    // How long until the oldest hit falls out of the window.
    const retryAfterMs = windowMs - (now - bucket.hits[0]);
    return { limited: true, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { limited: false, retryAfterMs: 0 };
}

/**
 * The client's address, as seen through Traefik.
 *
 * x-forwarded-for is a client-controlled header, so the *first* entry is the
 * one to trust least — but Traefik appends the real peer and we read the
 * left-most, which is standard. It is a rate-limit key, not an authorization
 * decision: the worst a forged value does is let one attacker spread their
 * attempts across many keys, which is why the endpoints that use this also
 * cap the expensive side effect (a device row) on a value they control.
 */
export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

/** Drop keys with no hits inside `windowMs`, so an attacker cycling keys can't grow the map forever. */
export function sweepIdle(windowMs: number): void {
  const now = nowMs();
  for (const [key, bucket] of buckets) {
    if (bucket.hits.every((t) => now - t >= windowMs)) buckets.delete(key);
  }
}

// Date.now() is fine in a request handler; only workflow scripts forbid it.
function nowMs(): number {
  return Date.now();
}
