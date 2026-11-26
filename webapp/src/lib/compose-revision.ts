/**
 * Which version of the one-file `compose.yml` an install runs, and whether
 * this image needs a newer one (RFC-023 §4.6, §4.11.3).
 *
 * The file declares itself with KINBOARD_COMPOSE_REVISION on the webapp
 * service. The revision goes up only when the file itself must change: an
 * image pin for the database, PostgREST or go2rtc, a new service, port,
 * volume or health check. Everything else ships in the image, so most
 * releases leave it alone.
 *
 * The legacy webapp/docker/docker-compose.yml does not set the variable, so a
 * git install never sees the notice.
 *
 * To raise the revision:
 *   1. change compose.yml and its KINBOARD_COMPOSE_REVISION;
 *   2. add an entry below with every line a household has to change, exactly
 *      as it appears in the file, and a message for each change under
 *      settings.composeRevision.changes.<id> in all four languages;
 *   3. raise REQUIRED_COMPOSE_REVISION only when this image no longer works
 *      properly with the older file. An old file keeps its old pins, which a
 *      new webapp supports for at least one release (§4.11.3).
 * e2e/compose-file.spec.ts holds compose.yml, this list and the messages to
 * one another.
 */

export interface ComposeChange {
  /** Message key under settings.composeRevision.changes: what this change is for, in one line. */
  id: string;
  /** The service in compose.yml the lines belong to. */
  service: string;
  /** The line as an older file has it; omitted when the line is new. */
  from?: string;
  /** The line as it must read now; omitted when the line goes away. */
  to?: string;
}

export interface ComposeRevision {
  revision: number;
  /** The first release whose compose.yml has this revision, e.g. "1.18.0". */
  release: string;
  /** What changed from the revision before; empty for the first. */
  changes: ComposeChange[];
}

/** Every revision of compose.yml, oldest first. */
export const COMPOSE_REVISIONS: readonly ComposeRevision[] = [
  // The first one-file compose.yml (RFC-023 PR 4).
  { revision: 1, release: "1.18.0", changes: [] },
];

/** The newest revision this image knows of: the one the repository's compose.yml declares. */
export const LATEST_COMPOSE_REVISION = COMPOSE_REVISIONS[COMPOSE_REVISIONS.length - 1].revision;

/** The oldest file this image runs properly with. Below it, Settings shows the notice. */
export const REQUIRED_COMPOSE_REVISION = 1;

/** The current file: every release carries it as an asset. */
export const COMPOSE_FILE_URL = "https://github.com/svenger87/kinboard/releases/latest/download/compose.yml";

/** The release notes of the release that brought a revision, which say what changed in the file. */
export function composeReleaseUrl(release: string): string {
  return `https://github.com/svenger87/kinboard/releases/tag/v${release}`;
}

export interface ComposeRevisionStatus {
  /** The revision the running file declares. */
  declared: number;
  /** The lowest revision this image needs. */
  required: number;
  /** The newest revision this image knows of. */
  latest: number;
  /** True when the file is older than this image needs. */
  outdated: boolean;
  /** Every change between the declared revision and the newest, oldest first, with the release that brought it. */
  changes: (ComposeChange & { revision: number; release: string })[];
}

/**
 * The variable's value as a revision: a whole number of 1 or more, nothing
 * else. Unset, empty or anything else is null, which shows nothing: a git
 * install (no variable) must never see the notice, and a value nobody can
 * compare is no reason to tell a household its file is old.
 */
export function parseComposeRevision(raw: string | undefined | null): number | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!/^[1-9][0-9]{0,5}$/.test(v)) return null;
  return Number(v);
}

/**
 * What Settings needs to know, or null when there is nothing to say (no
 * one-file install, or a value that is not a revision).
 */
export function composeRevisionStatus(
  raw: string | undefined | null,
  revisions: readonly ComposeRevision[] = COMPOSE_REVISIONS,
  required: number = REQUIRED_COMPOSE_REVISION,
): ComposeRevisionStatus | null {
  const declared = parseComposeRevision(raw);
  if (declared === null) return null;
  const latest = revisions.length > 0 ? revisions[revisions.length - 1].revision : 0;
  const changes = revisions
    .filter((r) => r.revision > declared)
    .flatMap((r) => r.changes.map((c) => ({ ...c, revision: r.revision, release: r.release })));
  return { declared, required, latest, outdated: declared < required, changes };
}
