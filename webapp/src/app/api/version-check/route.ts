import { NextResponse } from "next/server";
import { readCurrentVersion } from "@/lib/app-version";

// Module-level cache: every container instance hits the GitHub API at
// most once per 6h. Self-hoster's running stack does ~4 calls/day total,
// well under the unauthenticated rate limit (60/hr).
let cache: { data: VersionCheckResult; expiresAt: number } | null = null;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const REPO = "svenger87/kinboard";

interface VersionCheckResult {
  current: string;
  latest: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  updateAvailable: boolean;
  // null = couldn't reach GitHub (rate limited, offline, etc.)
  // The frontend treats this as "show current only, no badge"
  fetchedAt: string;
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  published_at: string;
}

async function fetchLatestRelease(): Promise<GithubRelease | null> {
  try {
    const r = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "kinboard-version-check",
        },
        // Edge cache hint; module cache above is the real cache
        next: { revalidate: 6 * 3600 },
      },
    );
    if (!r.ok) return null;
    return (await r.json()) as GithubRelease;
  } catch {
    return null;
  }
}

// SemVer compare: returns true if `latest` is strictly newer than `current`.
// Tolerates "v" prefix and prerelease suffixes (treats them as equal-or-older).
function isNewer(latest: string, current: string): boolean {
  const parse = (s: string): [number, number, number] => {
    const [core] = s.replace(/^v/i, "").split("-");
    const parts = core.split(".").map((n) => Number.parseInt(n, 10) || 0);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const [la, lb, lc] = parse(latest);
  const [ca, cb, cc] = parse(current);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
}

export async function GET() {
  if (cache && cache.expiresAt > Date.now()) {
    return NextResponse.json(cache.data);
  }
  const current = await readCurrentVersion();
  const latest = await fetchLatestRelease();
  const data: VersionCheckResult = {
    current,
    latest: latest?.tag_name ?? null,
    releaseUrl: latest?.html_url ?? null,
    publishedAt: latest?.published_at ?? null,
    updateAvailable: latest ? isNewer(latest.tag_name, current) : false,
    fetchedAt: new Date().toISOString(),
  };
  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return NextResponse.json(data);
}
