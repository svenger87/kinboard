import { NextResponse } from "next/server";
import {
  readCurrentVersion,
  isPrereleaseVersion,
  compareVersionsDesc,
} from "@/lib/app-version";

// Module-level cache: every container instance hits the GitHub API at
// most once per 6h, same posture as /api/version-check.
let cache: { data: ChangelogResult; expiresAt: number } | null = null;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const REPO = "svenger87/kinboard";

export interface ChangelogEntry {
  tag: string;
  name: string;
  publishedAt: string | null;
  body: string;
  /** Lets the UI badge an RC when a tester is shown one. */
  prerelease: boolean;
}

interface ChangelogResult {
  releases: ChangelogEntry[];
}

interface GithubRelease {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  body: string | null;
  prerelease: boolean;
}

async function fetchReleases(): Promise<GithubRelease[] | null> {
  try {
    const r = await fetch(
      `https://api.github.com/repos/${REPO}/releases?per_page=10`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "kinboard-changelog",
        },
        // Edge cache hint; module cache above is the real cache
        next: { revalidate: 6 * 3600 },
      },
    );
    if (!r.ok) return null;
    return (await r.json()) as GithubRelease[];
  } catch {
    return null;
  }
}

export async function GET() {
  if (cache && cache.expiresAt > Date.now()) {
    return NextResponse.json(cache.data);
  }

  // Which channel is this instance on? `/releases` returns pre-releases
  // too — unlike `/releases/latest`, which filters them out and is why
  // /api/version-check never had this problem. Without the filter below,
  // a household on stable opened "What's new" and read release notes for
  // release candidates it isn't running and can't get, described in the
  // same words as shipped features.
  //
  // Testers keep seeing them: someone running an RC is exactly who the
  // notes are written for, and hiding them there would leave them with
  // no in-app record of what they're testing.
  const onPrereleaseChannel = isPrereleaseVersion(await readCurrentVersion());

  const releases = await fetchReleases();
  const visible = (releases ?? [])
    .filter((r) => onPrereleaseChannel || !r.prerelease)
    // GitHub's order is not version order — it answered with v1.9.0-rc.9 above
    // v1.9.0-rc.13 — so "What's new" opened on a release candidate four builds
    // out of date. Sorted here rather than in the dialog so every consumer of
    // the endpoint gets the same answer, and so the cached payload is already
    // in the order it will be shown in.
    .sort((a, b) => {
      const byVersion = compareVersionsDesc(a.tag_name, b.tag_name);
      if (byVersion !== 0) return byVersion;
      // Identical versions should not happen; if they do, newest published
      // wins so the order is still deterministic rather than input-dependent.
      return (b.published_at ?? "").localeCompare(a.published_at ?? "");
    });
  const data: ChangelogResult = {
    releases: visible.map((r) => ({
      tag: r.tag_name,
      name: r.name ?? r.tag_name,
      publishedAt: r.published_at,
      body: r.body ?? "",
      prerelease: r.prerelease,
    })),
  };
  // Only cache a successful upstream fetch — caching a failure (releases ===
  // null) would poison the cache for CACHE_TTL_MS and force every request in
  // that window to see an empty changelog even after GitHub recovers.
  if (releases !== null) {
    cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  }
  return NextResponse.json(data);
}
