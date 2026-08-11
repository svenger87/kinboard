# Contributing to Kinboard

Thanks for your interest. Kinboard is a small project maintained on personal time, so the contribution process is deliberately lightweight — but a few conventions help keep things tidy.

## Quick links

- Bugs and feature requests: [GitHub Issues](https://github.com/svenger87/kinboard/issues)
- Security issues: see [`SECURITY.md`](SECURITY.md) — please don't open public issues for vulnerabilities
- Code of conduct: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)

## Dev environment

You'll need:

- **Node.js 20.9+** and **npm 11** — the lockfile is npm 11 shaped and `npm ci` fails on npm 10,
  which is what Node 20 bundles. `cd webapp && corepack enable npm` activates the pinned version
  from `packageManager` in `package.json` (the explicit `npm` argument is required; plain
  `corepack enable` only shims yarn and pnpm).
- **Docker** (for the bundled Supabase stack)
- A POSIX shell — the helper scripts assume `bash`. On Windows, use WSL2 or Git Bash

```bash
# Clone + bootstrap
git clone https://github.com/svenger87/kinboard.git
cd kinboard
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

- **Translations.** All user-facing strings live in `webapp/messages/{en,de,fr}.json`. New strings need entries in all locales. Use `useTranslations("namespace")` rather than hardcoding text.
- **Date formatting.** Use `date-fns` with `de | enUS` locales rather than hardcoded month/day names.
- **Server vs. client state.** Server state goes through TanStack Query (`webapp/src/hooks/`). UI state goes through Zustand (`webapp/src/stores/`).
- **Database changes.** Schema changes ship as new `webapp/docker/migration*.sql` files (idempotent — guarded with `IF NOT EXISTS` / type checks). `init.sql` is reserved for fresh installs and runs once. `start.sh up` applies migrations on every boot.
- **Settings pages share one frame.** A page under `webapp/src/app/settings/<name>/page.tsx` opens with the shell every other one uses:

  ```tsx
  <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
    <div className="relative z-10 max-w-2xl mx-auto">
      <PageHeader icon={Icon} title={t("title")} subtitle={t("subtitle")} className="mb-8" />
  ```

  The `pt-16` is not decoration: `settings/layout.tsx` renders a *floating* back button over the top-left corner of every sub-page, and a page without that padding puts its own heading underneath it. Widen `max-w-2xl` if the content needs it; keep the rest.

- **Never pass `backHref="/settings"` to `PageHeader` on a settings sub-page.** The layout already renders that control for you, so passing it again gives the page two back buttons pointing at the same place. (A `backHref` to a *different* parent, as `settings/caldav` does, is a separate case and fine.)

- **A new table the browser reads needs an explicit `GRANT`.** `ALTER DEFAULT PRIVILEGES` in this database grants new tables to `service_role`, `authenticator` and the supabase admin roles — and to nobody else. Without `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.<table> TO anon, authenticated;` in the same migration, the table is invisible to the app however correct its RLS policy is, and the symptom is a form that silently does nothing. This has now been hit twice; see the header of `migration_zy_schema_hardening.sql`.

- **Conventional Commits.** Commit messages follow the [Conventional Commits](https://www.conventionalcommits.org/) format: `feat(scope): …`, `fix(scope): …`, `docs(scope): …`, `ci(scope): …`, `refactor(scope): …`, `test(scope): …`, `chore(scope): …`. The scope (`weather`, `realtime`, `settings`, …) is optional but encouraged. This keeps the commit log scannable and unblocks future automation (`release-please` etc.).

## Changelog

Kinboard follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/). **Every PR with user-visible behavior must update `CHANGELOG.md`** under `[Unreleased]` in the matching section (`Added` / `Changed` / `Fixed` / `Security` / `Removed`).

You do not need to worry about conflicting with other branches there. `CHANGELOG.md` is marked `merge=union` in `.gitattributes`, so git keeps both sides when two branches add entries to the same section instead of raising a conflict. Add your line and leave it alone — just skim the merged section when cutting a release, since union can order two same-section entries oddly.

The reader is a self-hoster deciding whether to update — write for them, not for the maintainer. Lead with the user-visible effect; reference the implementation only when the cause matters (e.g. a security fix).

Skip the changelog entry for: CI/lockfile-only changes, pure internal refactors with no behavioral effect, doc-only edits.

## Pull request workflow

1. Fork and create a branch off `main`.
2. Keep PRs focused — one concern per PR. Smaller diffs get reviewed faster.
3. Include a brief description of the change and the user-facing impact. Screenshots help for UI changes.
4. Make sure `npm run lint` passes.
5. New strings: add `en`, `de`, and `fr` translations.
6. Update `CHANGELOG.md` if the change is user-visible.
7. Commit message follows Conventional Commits (see above).

## Plugins

Niche integrations (Tesla, Zendure SolarFlow, etc.) are designed to live as opt-in plugins under `webapp/src/plugins/`. The plugin API is still being shaped — if you want to write one, open a discussion first so we can align on the contract.

## Translations

EN, DE, and FR ship in the box. Adding another locale is two steps:

1. Add one entry to the `LOCALES` array in `webapp/src/i18n/locales.ts`
   (`{ code, label, native, bcp47 }`) and a matching `case` to
   `getDateFnsLocale()` in `webapp/src/lib/date-fns-locale.ts`. That one entry
   drives locale negotiation, both language switchers, and date/number
   formatting — you don't touch anything else.
2. Add `webapp/messages/<code>.json` with your translations.

**Partial coverage is fine.** Any key you haven't translated falls back to
English automatically — so you can open a PR at 30% and fill in over time. The
easiest start is to copy `en.json` and translate top-down; untranslated keys can
stay in English (or be omitted). Only `en` and `de` are held to full parity in
CI; additional locales just report their coverage.

## Reviewer expectations

Reviews are best-effort. If your PR has been sitting for more than two weeks, ping the issue or PR — it's almost certainly just life, not disinterest.
