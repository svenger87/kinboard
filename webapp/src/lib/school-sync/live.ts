import { safeFetch } from "@/lib/safe-fetch";
import { readCurrentVersion } from "@/lib/app-version";
import type { SyncFetch } from "./openholidays";
import { liveSchoolSyncStore } from "./store";
import { installEnabled, type SchoolSyncDeps } from "./sync";

/** How the sync introduces itself to OpenHolidays (RFC-014 §13). */
export function schoolSyncUserAgent(version: string): string {
  return `Kinboard/${version} (+https://github.com/svenger87/kinboard)`;
}

/**
 * `deps.userAgent`: the same version next.config.mjs inlines from
 * package.json at build time. It only reaches the wire through an injected
 * fake fetch (the specs); on the live path liveSchoolSyncFetch replaces the
 * header with one built from readCurrentVersion, the read /api/version-check
 * and the Integration API use, so the three agree.
 */
export const SCHOOL_SYNC_USER_AGENT = schoolSyncUserAgent(process.env.NEXT_PUBLIC_APP_VERSION ?? "dev");

/**
 * Every OpenHolidays request: safeFetch (public addresses only, each redirect
 * checked), with the running version in the User-Agent. The timeout signal,
 * the application/json check, the 1 MB cap and the zod validation are
 * getOpenHolidaysJson's, around this call.
 */
export const liveSchoolSyncFetch: SyncFetch = async (url, options) => {
  const init = { ...options, headers: { ...options.headers, "User-Agent": schoolSyncUserAgent(await readCurrentVersion()) } };
  return safeFetch(url, init);
};

/** The real fetch, store and clock. */
export function liveSchoolSyncDeps(): SchoolSyncDeps {
  return {
    fetch: liveSchoolSyncFetch,
    store: liveSchoolSyncStore(),
    now: () => new Date(),
    installEnabled: installEnabled(),
    userAgent: SCHOOL_SYNC_USER_AGENT,
    log: (message) => console.error(message),
  };
}
