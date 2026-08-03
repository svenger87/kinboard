# Release process

How a new Kinboard version reaches `ghcr.io` and the GitHub Releases page.

This document is the maintainer's checklist. End-users and contributors don't need to read it.

## Versioning

Kinboard follows [Semantic Versioning 2.0.0](https://semver.org/):

- **Major (`X.0.0`)** — breaking change for self-hosters: schema migration that requires manual action, removed integration, env-var rename, dropped Node/Postgres/Docker version, etc.
- **Minor (`x.Y.0`)** — new feature, new integration, new locale, new settings page; everything is backwards-compatible.
- **Patch (`x.y.Z`)** — bug fix, security patch, doc fix, dep bump.

Breaking changes are documented in `CHANGELOG.md` under a `### Removed` or prominently flagged in `### Changed`. Avoid them when reasonable — self-hosters update on their own schedule and a noisy upgrade story erodes trust.

## Pre-releases (the `next` channel)

Community testers offered to try changes before they ship — issue #19's
reporter among them. Release candidates are how that happens, and the
publishing pipeline already handles them.

**Cutting one:**

```bash
git tag v1.6.0-rc.1
git push origin v1.6.0-rc.1
```

Any tag with a prerelease identifier (`-rc.1`, `-beta.2`, `-alpha.1`)
publishes two image tags: the exact version (`1.6.0-rc.1`) and a moving
`next` tag pointing at the newest pre-release.

Then create the GitHub Release from that tag and **tick "Set as a
pre-release"**, so it doesn't display as the latest release and doesn't
notify everyone watching releases.

**What a pre-release cannot break.** `latest` is gated on a push to the
default branch, and a tag push is never that — so a release candidate can
never become `latest`. `docker/metadata-action` also omits the
`{{major}}` and `{{major}}.{{minor}}` aliases for prerelease versions, so
`v1.6.0-rc.1` cannot claim `1` or `1.6` either. Stable self-hosters see
nothing.

**Telling a tester how to opt in** — they set one line in
`webapp/docker/.env`:

```bash
KINBOARD_TAG=next
```

then `cd webapp/docker && ./start.sh up`. If they run the Diun
auto-update overlay they keep receiving each new RC automatically. To go
back to stable, remove the line (or set `KINBOARD_TAG=latest`) and bring
the stack up again.

Point testers at [Self-hosting → Pre-release channel](https://github.com/svenger87/kinboard/wiki/Self-hosting#pre-release-channel)
rather than repeating the instructions in the issue thread.

**Ask testers to report against the exact version**, not "next" — `next`
moves, so "broken on next" is unactionable a week later. The version is
shown in Settings.

## Cadence

There's no fixed release cadence. Cut a release when:

- A meaningful chunk of `[Unreleased]` has accumulated (5+ entries, or one big feature), **or**
- A security fix needs to ship, **or**
- It's been ~6 weeks since the last release and there are queued items

Don't cut a release for a single typo fix unless it's user-visible enough to matter.

## Pre-release checklist

Before tagging:

- [ ] `[Unreleased]` section in `CHANGELOG.md` is accurate (compare against `git log` since the last release tag)
- [ ] No uncommitted local changes; `git status` is clean
- [ ] `npm run lint` passes locally
- [ ] CI is green on `kinboard/main`
- [ ] If schema changed: a `migration*.sql` file landed and is idempotent
- [ ] No new env vars without `.env.example` entries
- [ ] If a breaking change: it's flagged prominently in CHANGELOG and a migration note exists in the wiki

## Cutting the release

Pick the new version `X.Y.Z` based on what's in `[Unreleased]`.

### 1. Promote `[Unreleased]` to a dated section

Edit `CHANGELOG.md`:

```diff
 ## [Unreleased]
 
+## [X.Y.Z] - YYYY-MM-DD
+
+...the entries that were under [Unreleased]...
```

Leave `[Unreleased]` empty at the top. At the bottom, update the link references:

```diff
 [Unreleased]: https://github.com/svenger87/kinboard/compare/vX.Y.Z...HEAD
+[X.Y.Z]: https://github.com/svenger87/kinboard/releases/tag/vX.Y.Z
```

### 2. Bump `webapp/package.json`

```diff
-  "version": "x.y.z-old",
+  "version": "X.Y.Z",
```

Only the webapp's `package.json` (root has no version of its own).

### 3. Commit on local `main`

```bash
git add CHANGELOG.md webapp/package.json
git commit -m "release: cut vX.Y.Z — promote [Unreleased] entries to dated section"
```

### 4. Cherry-pick onto `kinboard` remote

`kinboard/main` is squashed-history; commits land via cherry-pick. From local main:

```bash
SHA=$(git rev-parse HEAD)
git fetch kinboard main
git checkout -b release-vX.Y.Z kinboard/main
git cherry-pick "$SHA"
```

### 5. Tag the release

On the cherry-picked branch:

```bash
git tag -a vX.Y.Z -m "<one-sentence release summary>"
```

Annotated tag, not lightweight. The message becomes the default body when GitHub auto-generates the release.

### 6. Push commit + tag

```bash
git push kinboard release-vX.Y.Z:main
git push kinboard vX.Y.Z
```

The tag push triggers `.github/workflows/docker.yml`, which builds amd64 + arm64 images on the Unraid runner and publishes to:

- `ghcr.io/svenger87/kinboard:X.Y.Z`
- `ghcr.io/svenger87/kinboard:X.Y`
- `ghcr.io/svenger87/kinboard:X`
- `ghcr.io/svenger87/kinboard:latest`

### 7. Clean up local

```bash
git checkout main
git branch -D release-vX.Y.Z
```

Local `main` keeps full history; `origin` (gitlab) gets the regular push later.

### 8. Create the GitHub Release

Once the Docker workflow finishes:

```bash
gh release create vX.Y.Z \
  --repo svenger87/kinboard \
  --title "Kinboard vX.Y.Z" \
  --notes-file <(awk "/^## \\[X\\.Y\\.Z\\]/{f=1;next} /^## \\[/{f=0} f" CHANGELOG.md)
```

Or via the web UI: **Releases → Draft new release → choose tag `vX.Y.Z` → paste the changelog excerpt → Publish**.

### 9. Verify the published image

```bash
docker pull ghcr.io/svenger87/kinboard:X.Y.Z
docker manifest inspect ghcr.io/svenger87/kinboard:X.Y.Z | grep architecture
```

Should show both `amd64` and `arm64`. If only one arch is present, the merge job failed; investigate before announcing.

## Post-release

- [ ] Test the published image on a fresh box (`docker compose -f docker-compose.yml -f docker-compose.image.yml pull && up -d`)
- [ ] Tweet / Mastodon post / Discussions announcement (link to the GitHub Release page, mention 1–2 highlights)
- [ ] If breaking change: write a wiki migration note linked from the release notes
- [ ] If security fix: ensure CVE/advisory is published on GitHub Security tab

## Hotfix workflow (urgent patch)

If `X.Y.Z` ships with a critical bug and you need to ship `X.Y.Z+1` immediately:

1. Branch from the `vX.Y.Z` tag (not from current main): `git checkout -b hotfix/X.Y.Z+1 vX.Y.Z`
2. Cherry-pick the fix commit(s) from main onto the hotfix branch
3. Bump `webapp/package.json` to `X.Y.Z+1`, update CHANGELOG (add a new dated section before `[X.Y.Z]`)
4. Cherry-pick onto `kinboard/main`, tag `vX.Y.Z+1`, push tag
5. Merge the hotfix back into local `main` so the fix isn't lost (`git checkout main && git cherry-pick <fix-shas>`)

## Yanking a release (last resort)

If a release ships with a regression bad enough to warrant pulling:

1. **Don't delete the git tag.** That breaks anyone who already pulled.
2. Edit the GitHub Release: mark as "pre-release" + prepend a `⚠️ Yanked: <reason> — please use vX.Y.Z+1` banner to the release notes.
3. Optionally, delete the `:latest` and `:X` Docker tags (but keep `:X.Y.Z` so existing pinned deployments don't break): use `gh api -X DELETE /user/packages/container/kinboard/versions/<id>`.
4. Cut the next patch as a hotfix (above) ASAP.
5. Note the yank in the CHANGELOG of the replacement version.

This has never been needed yet. Keep it that way by following the pre-release checklist.
