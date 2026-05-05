# Contributing to Familyboard

Thanks for your interest. Familyboard is a small project maintained on personal time, so the contribution process is deliberately lightweight — but a few conventions help keep things tidy.

## Quick links

- Bugs and feature requests: [GitHub Issues](https://github.com/svenger87/familyboard/issues)
- Security issues: see [`SECURITY.md`](SECURITY.md) — please don't open public issues for vulnerabilities
- Code of conduct: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)

## Dev environment

You'll need:

- **Node.js 20+** and **npm 10+**
- **Docker** (for the bundled Supabase stack)
- A POSIX shell — the helper scripts assume `bash`. On Windows, use WSL2 or Git Bash

```bash
# Clone + bootstrap
git clone https://github.com/svenger87/familyboard.git
cd familyboard
./setup.sh   # generates .env files and random secrets

# Bring up the Supabase stack
cd webapp/docker
./start.sh up

# In a second terminal, run the Next.js dev server
cd webapp
npm install
npm run dev
```

Open `http://localhost:3000` and follow the in-app onboarding to create your first family.

## Code style

The project enforces only ESLint — there is **no `next build` step in CI**. Run lint locally before sending a PR:

```bash
cd webapp
npm run lint
```

A handful of `<img>` warnings are pre-existing and acceptable. Treat anything else as a blocker.

The repo follows a few conventions worth knowing about:

- **Translations.** All user-facing strings live in `webapp/messages/{en,de}.json`. New strings need entries in both locales. Use `useTranslations("namespace")` rather than hardcoding text.
- **Date formatting.** Use `date-fns` with `de | enUS` locales rather than hardcoded month/day names.
- **Server vs. client state.** Server state goes through TanStack Query (`webapp/src/hooks/`). UI state goes through Zustand (`webapp/src/stores/`).
- **Database changes.** Schema changes ship as new `webapp/docker/migration*.sql` files (idempotent — guarded with `IF NOT EXISTS` / type checks). `init.sql` is reserved for fresh installs and runs once. `start.sh up` applies migrations on every boot.
- **Conventional Commits.** Commit messages follow the [Conventional Commits](https://www.conventionalcommits.org/) format: `feat(scope): …`, `fix(scope): …`, `docs(scope): …`, `ci(scope): …`, `refactor(scope): …`, `test(scope): …`, `chore(scope): …`. The scope (`weather`, `realtime`, `settings`, …) is optional but encouraged. This keeps the commit log scannable and unblocks future automation (`release-please` etc.).

## Changelog

Familyboard follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/). **Every PR with user-visible behavior must update `CHANGELOG.md`** under `[Unreleased]` in the matching section (`Added` / `Changed` / `Fixed` / `Security` / `Removed`).

The reader is a self-hoster deciding whether to update — write for them, not for the maintainer. Lead with the user-visible effect; reference the implementation only when the cause matters (e.g. a security fix).

Skip the changelog entry for: CI/lockfile-only changes, pure internal refactors with no behavioral effect, doc-only edits.

## Pull request workflow

1. Fork and create a branch off `main`.
2. Keep PRs focused — one concern per PR. Smaller diffs get reviewed faster.
3. Include a brief description of the change and the user-facing impact. Screenshots help for UI changes.
4. Make sure `npm run lint` passes.
5. New strings: add both `en` and `de` translations.
6. Update `CHANGELOG.md` if the change is user-visible.
7. Commit message follows Conventional Commits (see above).

## Plugins

Niche integrations (Tesla, Zendure SolarFlow, etc.) are designed to live as opt-in plugins under `webapp/src/plugins/`. The plugin API is still being shaped — if you want to write one, open a discussion first so we can align on the contract.

## Translations

EN and DE ship in the box. To add another locale:

1. Copy `webapp/messages/en.json` to `webapp/messages/<locale>.json`.
2. Update `webapp/src/i18n/` to register the new locale.
3. Submit a PR — partial coverage is fine; we'll mark fallbacks where needed.

## Reviewer expectations

Reviews are best-effort. If your PR has been sitting for more than two weeks, ping the issue or PR — it's almost certainly just life, not disinterest.
