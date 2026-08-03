import { test, expect } from "@playwright/test";
import { isPrereleaseVersion } from "../src/lib/app-version";

/**
 * Guards the predicate that decides whether an instance is on the
 * pre-release channel, and therefore whether "What's new" shows release
 * candidates.
 *
 * The bug this replaced: `/api/changelog` called GitHub's `/releases`,
 * which — unlike `/releases/latest` — includes pre-releases. A household
 * on stable read RC notes for features it did not have. Getting this
 * predicate wrong in the other direction is just as bad: a tester who
 * loses the notes for the build they're testing has nothing to report
 * against.
 */

test.describe("isPrereleaseVersion", () => {
  test("recognises the prerelease identifiers actually cut", () => {
    for (const v of ["1.6.0-rc.1", "1.6.0-rc.3", "1.7.0-beta.2", "2.0.0-alpha.1", "v1.6.0-rc.3"]) {
      expect(isPrereleaseVersion(v), v).toBe(true);
    }
  });

  test("treats stable versions as stable", () => {
    for (const v of ["1.5.0", "1.6.0", "v1.5.0", "0.0.0", "10.20.30"]) {
      expect(isPrereleaseVersion(v), v).toBe(false);
    }
  });

  test("build metadata is not a prerelease", () => {
    // SemVer: `+sha` is build metadata on a *stable* release. Reading the
    // `-` inside it would hide every stable release from that instance.
    expect(isPrereleaseVersion("1.6.0+build.abc-def")).toBe(false);
    expect(isPrereleaseVersion("1.6.0-rc.1+build.abc")).toBe(true);
  });
});

test.describe("changelog visibility rule", () => {
  // The rule as the route applies it: show everything on a prerelease
  // channel, stable-only otherwise.
  const visible = (current: string, releases: Array<{ tag: string; prerelease: boolean }>) =>
    releases
      .filter((r) => isPrereleaseVersion(current) || !r.prerelease)
      .map((r) => r.tag);

  const RELEASES = [
    { tag: "v1.6.0-rc.3", prerelease: true },
    { tag: "v1.6.0-rc.2", prerelease: true },
    { tag: "v1.5.0", prerelease: false },
    { tag: "v1.4.0", prerelease: false },
  ];

  test("a stable install sees only stable releases", () => {
    expect(visible("1.5.0", RELEASES)).toEqual(["v1.5.0", "v1.4.0"]);
  });

  test("a tester sees everything, newest first", () => {
    expect(visible("1.6.0-rc.3", RELEASES)).toEqual([
      "v1.6.0-rc.3",
      "v1.6.0-rc.2",
      "v1.5.0",
      "v1.4.0",
    ]);
  });

  test("a stable install is never left with an empty changelog", () => {
    // Filtering must not be able to empty the list while stable releases
    // exist — an empty list renders the "changelog unavailable" state,
    // which would look like a broken instance rather than a quiet one.
    expect(visible("1.5.0", RELEASES).length).toBeGreaterThan(0);
  });
});
