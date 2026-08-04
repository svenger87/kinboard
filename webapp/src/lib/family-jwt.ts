import { createHmac } from "node:crypto";
import { FAMILY_TOKEN_TTL_SECONDS } from "@/lib/family-token-timing";

/**
 * Family-scoped tokens for the browser's direct connection to PostgREST.
 *
 * The browser talks to Supabase directly (src/lib/supabase/client.ts), so the
 * Next.js API is not in that request path and cannot police it. Row-level
 * security is what polices it, and every policy resolves the caller's family
 * from a `family_id` claim on the request's JWT — see
 * docker/migration_enable_rls.sql.
 *
 * The anon key that ships in the browser bundle carries no such claim, which
 * is deliberate: with RLS enabled it can read nothing. A device that has
 * joined with the family code gets one of these instead.
 *
 * WHY THIS IS HAND-ROLLED
 *
 * Signing a JWT is an HMAC over two base64url segments. The dangerous half of
 * JWT handling is *verification* — algorithm confusion, unverified `alg: none`,
 * signature checks that don't actually check. None of that happens here,
 * because this module never reads a token. PostgREST verifies, with the same
 * secret, and it is the thing that has to get verification right.
 *
 * The secret is PGRST_JWT_SECRET / JWT_SECRET from the stack's .env. If it
 * isn't set, minting fails loudly rather than issuing tokens nothing will
 * accept.
 */

/**
 * Short-lived on purpose. The durable credential is the device session cookie
 * (src/lib/session.ts); this is a bearer token that travels to PostgREST on
 * every query, so it should age out quickly. The client refreshes it well
 * before expiry — a kiosk must never need attention.
 */
export { FAMILY_TOKEN_TTL_SECONDS, FAMILY_TOKEN_REFRESH_MARGIN_SECONDS } from "@/lib/family-token-timing";

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET || process.env.PGRST_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET is not set — cannot mint family tokens. It must match the " +
        "secret PostgREST verifies with (PGRST_JWT_SECRET).",
    );
  }
  return secret;
}

export interface FamilyToken {
  token: string;
  /** Unix seconds. The client refreshes before this. */
  expiresAt: number;
}

/**
 * Mint a token scoped to one family.
 *
 * `role` is `authenticated` rather than `anon` so a real session is
 * distinguishable from the public key at the database level — which leaves
 * open the option of revoking anon's table grants entirely later, as defence
 * in depth behind the policies.
 */
export function mintFamilyToken(familyId: string): FamilyToken {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + FAMILY_TOKEN_TTL_SECONDS;

  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    role: "authenticated",
    // What current_family_id() reads in every policy.
    family_id: familyId,
    iss: "kinboard",
    iat: issuedAt,
    exp: expiresAt,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(payload),
  )}`;
  const signature = createHmac("sha256", jwtSecret()).update(signingInput).digest("base64url");

  return { token: `${signingInput}.${signature}`, expiresAt };
}
