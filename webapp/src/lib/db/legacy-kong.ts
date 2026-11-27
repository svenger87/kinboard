/**
 * The settings a compose file from before 1.15 still gives the webapp, read
 * here and nowhere else (RFC-024 §4.6, phase 7 step 3).
 *
 * Such a file runs Kong and sets no POSTGREST_URL. Kong routes `/rest/v1`
 * and `/storage/v1` to the services behind it and refuses a request without
 * the anon key in an `apikey` header. So, for those installs only:
 *
 * - `SUPABASE_URL` is Kong's address inside the stack (lib/db/api-base.ts
 *   `serverSupabaseUrl`, app/rest/v1, app/storage/v1);
 * - `NEXT_PUBLIC_SUPABASE_ANON_KEY` is the key app/rest/v1 adds on the way to
 *   Kong;
 * - and, because with KINBOARD_ENTRY=kong it is Kong, not the webapp, that
 *   answers the browser's `/rest/v1`, the page gets that key in
 *   `window.__ENV` as it did before 1.18, and the browser sends it as
 *   `apikey` only. Without a family token there is still no `Authorization`,
 *   so PostgREST still runs such a request as `anon`.
 *
 * Every other install gets no `window.__ENV`, and its browser sends no key.
 * Nothing else in webapp/src reads these names (e2e/anon-key-retired.spec.ts).
 * They go with the Kong path itself, one release later (§4.6 step 7).
 *
 * Read through a parameter, never as `process.env.NEXT_PUBLIC_…`: Next
 * replaces that expression at build time with whatever the build machine
 * had, in server code too, and a baked key would win over the container's.
 * No server-only import here: the browser half below is in the bundle.
 */
type EnvLike = Record<string, string | undefined>;

/** Kong's address from a pre-1.15 compose file, without a trailing slash, or null. */
export function legacyKongUrl(env: EnvLike = process.env): string | null {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  return url ? url : null;
}

/** The anon key Kong wants as `apikey`, as that compose file passes it; "" when it doesn't. */
export function legacyKongAnonKey(env: EnvLike = process.env): string {
  return env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
}

/** Whether this server runs behind a pre-1.15 compose file's Kong (no POSTGREST_URL, a SUPABASE_URL). */
export function behindLegacyKong(env: EnvLike = process.env): boolean {
  return !env.POSTGREST_URL?.trim() && legacyKongUrl(env) !== null;
}

/** What the root layout hands the browser in `window.__ENV`: the key for Kong, or nothing at all. */
export function legacyKongPageEnv(env: EnvLike = process.env): { NEXT_PUBLIC_SUPABASE_ANON_KEY: string } | null {
  const key = legacyKongAnonKey(env);
  return behindLegacyKong(env) && key ? { NEXT_PUBLIC_SUPABASE_ANON_KEY: key } : null;
}

/**
 * The inline script that sets it, or null. `<` is escaped so no value can
 * close the script element early.
 */
export function legacyKongPageScript(env: EnvLike = process.env): string | null {
  const pageEnv = legacyKongPageEnv(env);
  return pageEnv ? `window.__ENV=${JSON.stringify(pageEnv).replace(/</g, "\\u003c")};` : null;
}

declare global {
  interface Window {
    /** Set only behind a pre-1.15 Kong (legacyKongPageEnv), or by a page rendered before 1.18. */
    __ENV?: { NEXT_PUBLIC_SUPABASE_ANON_KEY?: string; NEXT_PUBLIC_SUPABASE_URL?: string };
  }
}

/**
 * In the browser: the `apikey` Kong wants, when the page carries one, else
 * null. A page rendered before 1.18 carries it too (a service worker can
 * serve one); sending it there is harmless, since the webapp's /rest/v1 drops
 * an incoming `apikey` (lib/rest-proxy.ts). Its old NEXT_PUBLIC_SUPABASE_URL
 * is never read: the API is the page's own origin.
 */
export function legacyKongBrowserApikey(): string | null {
  if (typeof window === "undefined") return null;
  const key = window.__ENV?.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return typeof key === "string" && key !== "" ? key : null;
}
