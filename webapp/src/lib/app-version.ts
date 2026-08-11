import { promises as fs } from "fs";
import path from "path";

/**
 * The running build's version, read from `webapp/package.json`.
 *
 * Shared by `/api/version-check` (which compares it against the latest
 * GitHub release) and `/api/changelog` (which uses it to decide whether
 * this instance is on the pre-release channel). They previously each had
 * their own copy of the read; one source matters here because the two
 * endpoints answering differently is precisely the bug that let release
 * candidates leak into a stable instance's "What's new".
 *
 * The version is baked into the image at build time and cannot change
 * while the container runs, so the read is cached for the process.
 */

let cached: string | null = null;

export async function readCurrentVersion(): Promise<string> {
  if (cached !== null) return cached;

  let version: string;
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
    version = typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    // Falling back to 0.0.0 rather than throwing keeps both endpoints
    // answering; the cost is an unhelpful version string, not an error
    // page in Settings.
    version = "0.0.0";
  }

  cached = version;
  return version;
}

/**
 * Is this version a pre-release (`1.6.0-rc.3`, `1.7.0-beta.1`)?
 *
 * SemVer says anything after the first `-` is a prerelease identifier.
 * A build-metadata suffix (`+sha`) is not, so it's stripped first —
 * `1.6.0+abc` is a stable release and must not be read as one.
 */
export function isPrereleaseVersion(version: string): boolean {
  const withoutBuildMetadata = version.replace(/^v/i, "").split("+")[0];
  return withoutBuildMetadata.includes("-");
}

interface ParsedVersion {
  /** major, minor, patch — always three entries. */
  main: number[];
  /** Prerelease identifiers, numeric ones kept as numbers. Empty for a release. */
  pre: Array<string | number>;
}

function parseVersion(raw: string): ParsedVersion {
  const cleaned = raw.trim().replace(/^v/i, "").split("+")[0];
  const firstDash = cleaned.indexOf("-");
  const core = firstDash === -1 ? cleaned : cleaned.slice(0, firstDash);
  const preRaw = firstDash === -1 ? "" : cleaned.slice(firstDash + 1);

  const main = core.split(".").map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isNaN(n) ? 0 : n;
  });
  while (main.length < 3) main.push(0);

  const pre = preRaw
    .split(".")
    .filter(Boolean)
    .map((id) => (/^\d+$/.test(id) ? Number.parseInt(id, 10) : id));

  return { main: main.slice(0, 3), pre };
}

/** SemVer §11 precedence. Negative when `x` is the older version. */
function comparePrecedence(x: ParsedVersion, y: ParsedVersion): number {
  for (let i = 0; i < 3; i++) {
    if (x.main[i] !== y.main[i]) return x.main[i] - y.main[i];
  }

  // A release outranks any prerelease of the same numbers: 1.9.0 > 1.9.0-rc.13.
  if (x.pre.length === 0 && y.pre.length === 0) return 0;
  if (x.pre.length === 0) return 1;
  if (y.pre.length === 0) return -1;

  const len = Math.max(x.pre.length, y.pre.length);
  for (let i = 0; i < len; i++) {
    const a = x.pre[i];
    const b = y.pre[i];
    // A shorter set of identifiers loses, all else equal: rc.1 < rc.1.1.
    if (a === undefined) return -1;
    if (b === undefined) return 1;

    const aNumeric = typeof a === "number";
    const bNumeric = typeof b === "number";
    if (aNumeric && bNumeric) {
      if (a !== b) return (a as number) - (b as number);
      continue;
    }
    // Numeric identifiers always rank below alphanumeric ones.
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    if (a !== b) return (a as string) < (b as string) ? -1 : 1;
  }
  return 0;
}

/**
 * Newest version first — for sorting release lists.
 *
 * Needed because neither of the orderings already to hand is right. GitHub's
 * `/releases` answered with v1.9.0-rc.9 ahead of v1.9.0-rc.13, which was
 * published sixteen hours later; and plain string comparison is worse, since
 * "rc.13" sorts below "rc.9" on the first character after the dot. Both put an
 * older release candidate at the top of "What's new".
 *
 * Compares by precedence, not by date, so re-publishing or back-dating an old
 * release cannot reorder the list either.
 */
export function compareVersionsDesc(a: string, b: string): number {
  return comparePrecedence(parseVersion(b), parseVersion(a));
}
