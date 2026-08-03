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
