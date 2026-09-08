/**
 * How far this browser's clock is from the server's.
 *
 * A timer's `started_at` is written by the server; the countdown subtracts the
 * browser's `now` from it. A wall panel two minutes fast therefore ends its
 * timer two minutes early, and one correcting itself by NTP mid-count visibly
 * jumps.
 *
 * No endpoint is needed: every HTTP response carries a `Date` header, so the
 * offset comes from a request the app already makes. RFC-004 §3.1.
 */

/**
 * Milliseconds to ADD to this browser's clock to get the server's.
 *
 * `null` means "not measured" and is deliberately distinct from `0`, which
 * means "measured, and the clocks agree" — a caller must be able to tell the
 * difference before deciding whether to trust a countdown.
 */
export function offsetFromDateHeader(
  header: string | null,
  receivedAt: Date,
): number | null {
  if (!header) return null;
  const serverMs = Date.parse(header);
  if (!Number.isFinite(serverMs)) return null;
  return serverMs - receivedAt.getTime();
}

/** The server's idea of now, given this browser's. */
export function applyOffset(now: Date, offsetMs: number): Date {
  return new Date(now.getTime() + offsetMs);
}
