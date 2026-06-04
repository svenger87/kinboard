# Kinboard E2E

Two Playwright suites share `playwright.config.ts`, with different jobs:

| File | Purpose | Needs FAMILY_CODE? |
|---|---|---|
| `smoke.spec.ts` | Behavior assertions — pages return 200, key APIs respond, no console errors | Optional (anonymous suite runs without; authenticated suite requires it) |
| `visual-audit.spec.ts` | Screenshots every route into `e2e/screenshots/` for the wiki | Yes |

The smoke suite is the regression net — it's what catches things like the meal-plan UNIQUE-constraint bug (where `on_conflict=` upserts started returning HTTP 400 after a schema migration). Run it before cutting a release.

## Running

### Against an already-running stack (typical local dev)

If you have `npm run dev` going on port 3000, just point Playwright at it:

```bash
# Anonymous smoke only (no family needed)
npx playwright test e2e/smoke.spec.ts

# Full smoke with authenticated routes
FAMILY_CODE=ABC123 npx playwright test e2e/smoke.spec.ts
```

If you have the full Docker stack up (`./docker/start.sh up`) the webapp container also serves on `localhost:3000` — same command works.

### Against a remote stack (demo, smoke-test box)

```bash
PLAYWRIGHT_BASE_URL=https://demo.kinboard.app \
  FAMILY_CODE=ABC123 \
  npx playwright test e2e/smoke.spec.ts
```

### From a fresh checkout (auto-spawn dev server)

```bash
PLAYWRIGHT_AUTOSTART_DEV=1 npx playwright test e2e/smoke.spec.ts
```

This makes Playwright run `npm run dev` itself and wait for port 3000 before testing. Off by default so it doesn't fight an already-running dev server.

## What "no console errors" means

The smoke suite fails the test if any `console.error` or `pageerror` event fires while a route loads. Known-noisy patterns (HMR chatter, React DevTools install hint) are filtered in `IGNORED_CONSOLE_PATTERNS` at the top of `smoke.spec.ts`. Keep that list short — every entry is a thing we've explicitly chosen to tolerate. If a real error is being silenced, add a comment explaining why.

A failed smoke test on `/meals` with a 400-shaped error in the console almost certainly means a PostgREST `on_conflict=` write is hitting a missing UNIQUE constraint — same root cause as the bug fixed by `migration_unique_constraints.sql`.

## CI

The smoke suite runs in CI on every push to `main` and every PR via [`.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml): the workflow runs `setup.sh --non-interactive`, brings up the full Docker stack with the demo overlay (mock Home Assistant / Tesla / weather / cameras), seeds the `DEMO01` family, runs `npm run test:e2e:smoke` against it, and tears the stack down. The maintainer can still run it locally before a release cut.

## Producing wiki screenshots

That's the visual-audit script, not this one:

```bash
FAMILY_CODE=ABC123 npm run visual-audit
```

See `docs/wiki/screenshots/` for the higher-level capture toolchain that wraps it (theme + viewport matrix).
