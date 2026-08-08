import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every API route that reaches past Row-Level Security must check the session.
 *
 * `createAdminClient()` returns the service_role client. It is BYPASSRLS: no
 * policy applies to it, so whatever the route filters on is the entire access
 * control. Most of these routes filtered on a `family_id` the caller supplied
 * — an id that lives in localStorage, in request URLs and in server logs, and
 * that the codebase's own comments describe as not secret. So they were, in
 * practice, open: `GET /api/export?family_id=…` returned a family's whole
 * database, and `DELETE /api/family` destroyed one, with no credential at all.
 *
 * That is what this scans for. It is a source scan rather than a live probe
 * because it has to hold for routes nobody thought to test, including ones
 * added next year — the failure mode being guarded against is *forgetting*,
 * and a test suite listing endpoints by hand forgets the same way a developer
 * does.
 *
 * Its sibling e2e/family-scope.spec.ts checks the next question down — that a
 * route filters rows by family — but only over dynamic routes (its walk keeps
 * `full.includes("[")`), which is why none of /api/export, /api/family,
 * /api/settings or /api/pin were ever in its scope.
 *
 * Two signals, because "uses the admin client" is necessary but not
 * sufficient: several routes never touch Postgres directly and instead read a
 * family's stored integration credentials through lib/integration-secrets,
 * which uses the service-role client on their behalf. /api/homeassistant is
 * the sharp example — it proxies calls to a household's Home Assistant with
 * that household's access token, so an unauthenticated one is a door opener.
 */
const PRIVILEGED = [
  "createAdminClient",
  // These reach the service-role client indirectly, to read or write the
  // secrets a family has stored (API keys, CalDAV passwords, access tokens).
  "getMergedSetting",
  "getStoredSecrets",
  "upsertSecrets",
  "deleteSecrets",
  "getCaldavCredentials",
];

/**
 * Routes that are privileged AND deliberately reachable without a session.
 *
 * Each entry is a decision, not an exemption to be granted for convenience —
 * adding one means arguing that an anonymous caller from the internet may do
 * this. The reason is written next to it so the next person can disagree with
 * the argument rather than guess at it.
 */
const PUBLIC_BY_DESIGN: Record<string, string> = {
  // Docker's healthcheck, which has no cookie jar. Returns {status, version,
  // db} and nothing family-shaped; the DB touch is a bounded count(*).
  "health/route.ts": "container healthcheck, no family data in the response",

  // The two routes that mint sessions. Requiring one would be circular.
  // Both are rate-limited (lib/rate-limit) because they write rows.
  "session/join/route.ts": "issues the session; validates the join code itself",
  "session/create/route.ts": "issues the first session for a new family",

  // Restore-from-backup on a fresh install: the browser has no session yet and
  // cannot get one, because the family it would belong to is what this route
  // creates. It reads nothing and writes only into a brand-new family with
  // freshly generated ids, so it grants no more than session/create does.
  // Rate-limited for the same reason.
  "import/route.ts": "creates a new family; a fresh install has no session yet",

  // A single boolean — "does any family exist here?" — asked by /join to tell
  // a fresh install from one with families, before any session can exist.
  "setup/status/route.ts": "one boolean, needed before a session can exist",
};

/**
 * `/api/cron/*` is privileged and sessionless by nature — Ofelia calls it from
 * outside any browser. It is not on the allowlist above because it is checked
 * harder, below: every one of them must present CRON_SECRET.
 */
const CRON_PREFIX = "cron/";

/**
 * The auth boundaries a privileged route may sit behind.
 *
 * `requireSession` is the browser one — a person at a screen. `withIntegrationAuth`
 * is the machine one added for the Integration API (RFC-001 §4): a token with
 * explicit scopes, not a family member. They are different boundaries with
 * different credentials, and a route must be behind exactly one of them.
 *
 * Adding to this list is how you widen what counts as authenticated, so it
 * should stay short and each entry should be a function that *cannot* be
 * called without actually authorising — `withIntegrationAuth` takes the
 * handler as a callback for that reason, so a route cannot call it and then
 * ignore the result.
 */
const AUTH_BOUNDARIES = ["requireSession", "withIntegrationAuth"];

function routeFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      // Deliberately NOT filtered on "[" — the routes this exists for are the
      // static ones.
      else if (entry === "route.ts") found.push(full);
    }
  };
  walk(root);
  return found;
}

const ROOT = join(__dirname, "..", "src", "app", "api");

test("every privileged API route requires a session", () => {
  const files = routeFiles(ROOT);

  // If this ever finds nothing, the walk is broken, not the codebase.
  expect(files.length).toBeGreaterThan(50);

  const unguarded: string[] = [];

  for (const file of files) {
    const rel = file.slice(ROOT.length + 1);
    if (rel.startsWith(CRON_PREFIX)) continue;
    if (rel in PUBLIC_BY_DESIGN) continue;

    const source = readFileSync(file, "utf8");
    if (!PRIVILEGED.some((needle) => source.includes(needle))) continue;
    if (!AUTH_BOUNDARIES.some((needle) => source.includes(needle))) unguarded.push(rel);
  }

  expect(unguarded).toEqual([]);
});

test("a route that still takes family_id checks it against the session", () => {
  // Requiring a session is half the job. A session for family A must not be
  // able to export family B, so any route that reads a family id out of the
  // request has to compare the two — familyMatchesSession is that comparison.
  const takesFamilyId =
    /family_id|familyId|familyIdFrom/;

  // Routes that call requireSession but legitimately never read a family id
  // from the request: they either use the session's own family, or act on
  // nothing family-scoped at all.
  const NO_FAMILY_ID_IN_REQUEST = new Set([
    // Answers "do I have a session, and for whom" — the family is the reply.
    "session/token/route.ts",
    // Deletes the caller's own push subscription, scoped to session.familyId.
    "notifications/unsubscribe/route.ts",
    // Fetches a URL the user typed and reports what came back. No family.
    "calendar/test-ics/route.ts",
    // Searches the shared catalog and the web. No family-owned rows.
    "pocket-money/goal-image-search/route.ts",
  ]);

  const missing: string[] = [];

  for (const file of routeFiles(ROOT)) {
    const rel = file.slice(ROOT.length + 1);
    if (NO_FAMILY_ID_IN_REQUEST.has(rel)) continue;

    const source = readFileSync(file, "utf8");
    if (!source.includes("requireSession")) continue;
    if (!takesFamilyId.test(source)) continue;
    if (!source.includes("familyMatchesSession")) missing.push(rel);
  }

  expect(missing).toEqual([]);
});

test("every cron route presents CRON_SECRET", () => {
  const crons = routeFiles(ROOT).filter((f) =>
    f.slice(ROOT.length + 1).startsWith(CRON_PREFIX),
  );

  expect(crons.length).toBeGreaterThan(5);

  const unguarded = crons
    .filter((f) => !readFileSync(f, "utf8").includes("CRON_SECRET"))
    .map((f) => f.slice(ROOT.length + 1));

  expect(unguarded).toEqual([]);
});

test("the public allowlist names routes that exist", () => {
  // An allowlist entry for a route that has been renamed or deleted is worse
  // than useless: it reads as a considered decision while protecting nothing,
  // and hides the fact that the real route is no longer covered by it.
  const present = new Set(routeFiles(ROOT).map((f) => f.slice(ROOT.length + 1)));
  const stale = Object.keys(PUBLIC_BY_DESIGN).filter((rel) => !present.has(rel));

  expect(stale).toEqual([]);
});

test("the allowlist is the only thing keeping those routes out of the scan", () => {
  // Guards against the scan quietly going vacuous — if PRIVILEGED stopped
  // matching, or the walk stopped finding files, the first test would pass
  // with an empty list and nothing would say so. Run the same scan with the
  // allowlist emptied: the routes that are public on purpose must be exactly
  // what comes back.
  const flagged = routeFiles(ROOT)
    .map((f) => f.slice(ROOT.length + 1))
    .filter((rel) => !rel.startsWith(CRON_PREFIX))
    .filter((rel) => {
      const source = readFileSync(join(ROOT, rel), "utf8");
      return (
        PRIVILEGED.some((needle) => source.includes(needle)) &&
        !AUTH_BOUNDARIES.some((needle) => source.includes(needle))
      );
    });

  expect(flagged.sort()).toEqual(Object.keys(PUBLIC_BY_DESIGN).sort());
});
