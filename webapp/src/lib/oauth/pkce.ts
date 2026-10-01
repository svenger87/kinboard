import { createHash, timingSafeEqual } from "node:crypto";

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function isValidCodeChallenge(challenge: string): boolean {
  return CHALLENGE.test(challenge);
}

/** S256 only: `plain` would let a stolen code be redeemed by whoever saw the request. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!VERIFIER.test(verifier) || !CHALLENGE.test(challenge)) return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return timingSafeEqual(Buffer.from(computed), Buffer.from(challenge));
}
