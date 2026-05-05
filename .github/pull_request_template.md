<!-- Thanks for the contribution. Keep PRs focused — one concern per PR. -->

## Summary

<!-- One paragraph: what changes and why. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor (no user-facing change)
- [ ] Documentation
- [ ] Translation
- [ ] Plugin / integration

## Test plan

<!-- Bullet list of what you actually exercised — manual steps, browsers, scenarios. -->

- [ ]
- [ ]

## Screenshots

<!-- For UI changes, include before/after screenshots or a short clip. -->

## Checklist

- [ ] `npm run lint` passes
- [ ] New strings added to **both** `messages/en.json` and `messages/de.json`
- [ ] Schema changes ship as a new `webapp/docker/migration*.sql` file (idempotent — `IF NOT EXISTS`)
- [ ] No secrets, real API keys, or personal hostnames in the diff
- [ ] **`CHANGELOG.md` updated** under `[Unreleased]` if the change is user-visible (Added / Changed / Fixed / Security / Removed). See [CONTRIBUTING.md → Changelog](../CONTRIBUTING.md#changelog).
- [ ] Commit follows [Conventional Commits](https://www.conventionalcommits.org/): `feat(scope): …` / `fix(scope): …` / `docs(scope): …` / `ci(scope): …` / `refactor(scope): …` / `test(scope): …` / `chore(scope): …`
