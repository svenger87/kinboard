import { NextResponse } from "next/server";

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
}

interface ChangelogResult {
  releases: ChangelogEntry[];
}

interface GithubRelease {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  body: string | null;
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
  const releases = await fetchReleases();
  const data: ChangelogResult = {
    releases: (releases ?? []).map((r) => ({
      tag: r.tag_name,
      name: r.name ?? r.tag_name,
      publishedAt: r.published_at,
      body: r.body ?? "",
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
