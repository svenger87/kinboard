/**
 * Timing constants shared by the server that mints family tokens and the
 * client that refreshes them.
 *
 * Separate from lib/family-jwt.ts on purpose: that module imports node:crypto,
 * and a client module importing a constant from it drags the whole thing into
 * the browser bundle. Nothing secret leaked — the secret is read from the
 * environment at call time, never inlined — but server code has no business
 * being shipped to a browser, and the coupling would be easy to make worse
 * later without noticing.
 */

/**
 * How long a minted family token is valid. Short, because it is a bearer
 * credential that travels to PostgREST on every query; the durable credential
 * is the HttpOnly session cookie.
 */
export const FAMILY_TOKEN_TTL_SECONDS = 60 * 60;

/** Refresh this far ahead of expiry, so a slow network can't strand a client. */
export const FAMILY_TOKEN_REFRESH_MARGIN_SECONDS = 5 * 60;
