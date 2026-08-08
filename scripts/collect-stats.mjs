#!/usr/bin/env node
//
// Snapshots repository usage signals into stats/traffic.json.
//
// Why this exists: GitHub's traffic API only ever returns the last 14
// days and keeps no history, so every day that passes without a snapshot
// is data gone for good. Running this daily turns a rolling 14-day
// window into a permanent series.
//
// Deliberately NOT telemetry. Everything here is measured by GitHub
// about its own site and read back by the repo owner. Kinboard installs
// phone home to nothing, no personal data is processed by us, and the
// "no telemetry" promise in README/Architecture/the landing page stays
// literally true.
//
// What it can and cannot tell you:
//   can    — is interest growing, did a release move the needle, how
//            many distinct people cloned or looked this week
//   cannot — how many installs are actually running. Nothing short of a
//            phone-home can answer that, which is the trade being made.
//
// Usage: GITHUB_TOKEN=... REPO=owner/name node scripts/collect-stats.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const REPO = process.env.REPO ?? "svenger87/kinboard";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = process.env.OUT ?? "stats/traffic.json";

if (!TOKEN) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}

// GitHub having a bad minute, or us hitting the rate limit. Worth skipping:
// the API still holds 14 days of backlog, so tomorrow's run refills the gap.
const TRANSIENT = new Set([429, 500, 502, 503, 504]);

async function gh(path, { tolerateTransient = false } = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "kinboard-stats",
    },
  });
  if (!res.ok) {
    if (tolerateTransient && TRANSIENT.has(res.status)) {
      console.warn(`  ${path} -> HTTP ${res.status} (transient, skipped)`);
      return null;
    }
    // A permission failure is not worth tolerating. Traffic endpoints
    // require push access, and a token that lacks it today will lack it
    // tomorrow — so the run would go green every morning, commit a star
    // count, and let the only data with an expiry date keep evaporating.
    // That is precisely the failure this file exists to prevent, so it
    // has to be loud.
    const hint =
      path.startsWith("/traffic") &&
      (res.status === 401 || res.status === 403 || res.status === 404)
        ? " Traffic endpoints require push access. If the Actions token cannot" +
          " read them, add a TRAFFIC_TOKEN secret (a PAT with repo scope) —" +
          " see .github/workflows/stats.yml."
        : "";
    throw new Error(`${path || "/"} -> HTTP ${res.status}.${hint}`);
  }
  return res.json();
}

function load(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { repo: REPO, days: {}, snapshots: [] };
  }
}

const data = load(OUT);
data.repo = REPO;
data.days ??= {};
data.snapshots ??= [];

const [repo, clones, views] = await Promise.all([
  gh(""),
  gh("/traffic/clones", { tolerateTransient: true }),
  gh("/traffic/views", { tolerateTransient: true }),
]);

// Merge per-day traffic. Overwriting an existing date is intentional:
// the most recent day is always partial when first seen, and a later run
// carries the day's final figure.
const upsert = (entries, keyCount, keyUniques) => {
  for (const entry of entries ?? []) {
    const day = entry.timestamp.slice(0, 10);
    data.days[day] ??= {};
    data.days[day][keyCount] = entry.count;
    data.days[day][keyUniques] = entry.uniques;
  }
};
upsert(clones?.clones, "clones", "clone_uniques");
upsert(views?.views, "views", "view_uniques");

const today = new Date().toISOString().slice(0, 10);
const snapshot = {
  date: today,
  stars: repo.stargazers_count,
  forks: repo.forks_count,
  watchers: repo.subscribers_count,
  open_issues: repo.open_issues_count,
};
// One snapshot per day; a re-run replaces the day rather than appending.
data.snapshots = data.snapshots.filter((s) => s.date !== today).concat(snapshot);
data.snapshots.sort((a, b) => a.date.localeCompare(b.date));
data.updated = new Date().toISOString();

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(data, null, 2) + "\n");

const dayCount = Object.keys(data.days).length;
console.log(`stars=${snapshot.stars} forks=${snapshot.forks} days_tracked=${dayCount}`);
