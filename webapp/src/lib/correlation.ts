/**
 * Correlation ID primitives.
 *
 * Deliberately free of `next/headers`, `next/server` and anything Node-only:
 * the proxy runs on the edge runtime and importing server-only code there
 * drags it into that bundle. Keeping the pure parts here means the proxy and
 * the API error helper share one implementation instead of two that have to be
 * kept in step by hand.
 */

/** Header carrying the ID, inbound and outbound. */
export const CORRELATION_HEADER = "x-correlation-id";

/**
 * Short, time-ordered, unlikely to collide.
 *
 * Deliberately not a UUID. This value is printed in log lines and, when
 * something has gone wrong, read off a screen and typed into a search box by a
 * person. Fourteen hex characters is enough to isolate one request in a
 * household's logs and short enough to transcribe without a mistake.
 *
 * The leading 8 characters are the low bytes of the timestamp, so IDs from the
 * same period sort together — useful when scanning a log by eye.
 *
 * **Why 6 random characters and not 4.** The timestamp only separates requests
 * that land in different milliseconds; within one millisecond the random tail
 * is all there is. With 4 hex characters that tail is 65,536 wide, and by the
 * birthday bound a burst of 2,000 requests in the same millisecond would
 * collide about 30 times — which is not theoretical, it made the burst test
 * flaky. Two requests sharing an ID is precisely the failure this whole
 * mechanism exists to prevent: you grep the log and get someone else's lines
 * mixed into yours. At 6 characters the same burst expects ~0.1 collisions.
 */
export function newCorrelationId(): string {
  const time = Date.now().toString(16).slice(-8).padStart(8, "0");
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, "0");
  return `${time}${rand}`;
}

/**
 * Accept an inbound ID only if it is plausible, otherwise return null and let
 * the caller mint a fresh one.
 *
 * This value is echoed into log lines and into a response header, so an
 * unbounded attacker-controlled string is a log-injection and header-splitting
 * vector. Conservative charset and bounded length. A malformed header is not
 * worth failing a request over — it just doesn't get honoured.
 */
export function sanitiseCorrelationId(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  const trimmed = candidate.trim();
  if (trimmed.length < 4 || trimmed.length > 64) return null;
  return /^[A-Za-z0-9._-]+$/.test(trimmed) ? trimmed : null;
}
