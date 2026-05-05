# Getting help with Kinboard

Kinboard is maintained on personal time by one person. To make sure your question reaches the right place — and gets a response — pick the channel that matches what you're trying to do.

## I want to ask a question, share an idea, or chat

→ **[GitHub Discussions](https://github.com/svenger87/kinboard/discussions)**

Discussions is the right place for:

- "How do I configure X for my setup?"
- "What's the recommended way to do Y?"
- "I built this neat plugin — anyone want to try it?"
- Show-and-tell: kiosk hardware photos, theme tweaks, cool integrations
- Pre-feature brainstorming before opening an issue

## I found a bug

→ **[GitHub Issues — bug report](https://github.com/svenger87/kinboard/issues/new?template=bug_report.yml)**

Open an issue if Kinboard does the wrong thing or doesn't do the thing it's supposed to do. The bug report template walks you through:

- What went wrong + what you expected
- Repro steps
- Your install method (source-build vs. ghcr.io image), browser, hardware
- Browser console + relevant container logs

A good repro on a clean install is the single biggest accelerator for getting it fixed.

## I want a new feature

→ **[GitHub Issues — feature request](https://github.com/svenger87/kinboard/issues/new?template=feature_request.yml)**

If you've thought about it and have a concrete proposal, open an issue. If you're still exploring or unsure how it'd fit, open a Discussion first — they're cheaper to start and the maintainer can react quickly.

## I want a new integration

→ **[GitHub Issues — plugin request](https://github.com/svenger87/kinboard/issues/new?template=plugin_request.yml)**

Kinboard already integrates with Google Calendar, Home Assistant, Immich, Bring!, OpenWeatherMap, and go2rtc cameras. New integrations belong in the plugin system. Use this template to propose a new one — what service, what user-visible value, what kind of API access is needed.

## I found a security issue

→ **Email security@kinboard.app** — **do NOT open a public issue.**

See [`SECURITY.md`](SECURITY.md) for the threat model and disclosure timeline.

## I want to contribute code

→ **[`CONTRIBUTING.md`](CONTRIBUTING.md)**

Includes dev setup, code conventions, the Conventional Commits format, and how the changelog discipline works. PRs are welcome — keep them focused, lint clean, and add a `CHANGELOG.md` entry under `[Unreleased]` if the change is user-visible.

## I want to support the project financially

→ **[GitHub Sponsors](https://github.com/sponsors/svenger87)** or **[Buy Me a Coffee](https://buymeacoffee.com/sven.7687)**

Sponsorships keep the lights on and let the maintainer say "yes" to longer feature work. Even small recurring tips matter; they signal that the project is worth keeping alive.

## Response expectations

Honest reality:

- **Issues and Discussions:** the maintainer reads everything within a few days. Substantive responses can take longer if life is busy.
- **Pull requests:** reviewed when bandwidth allows. If yours has been sitting more than two weeks without a comment, ping the PR — it's almost certainly forgotten, not declined.
- **Security reports:** acknowledged within 7 days. High-severity fixes target a 30-day window.
- **Sponsors:** thanked individually unless you opt out. Existing sponsors get input on roadmap priorities.

Kinboard isn't a venture-funded SaaS. There's no support contract, no SLA, no on-call. What there is: a maintainer who actually uses the project on the kitchen wall every day, and who is genuinely glad you're trying it.
