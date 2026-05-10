# Plugin directory

Community-maintained list of third-party Kinboard plugins. Plugins extend Kinboard with new pages, settings flows, and dashboard widgets without modifying the core. The plugin model is build-time — installing a third-party plugin means cloning its files into your fork and rebuilding the Docker image.

For the technical contract and step-by-step "how to build a plugin" guide, see [Plugin Architecture](Plugin-Architecture.md).

For end-users wondering whether a specific feature is available: search this page first, then check [open issues](https://github.com/svenger87/kinboard/issues) and [discussions](https://github.com/svenger87/kinboard/discussions).

---

## Bundled plugins (ship with core)

These plugins are part of the official Kinboard build. No installation needed; toggle on or off per family at `/settings/plugins`.

| Plugin | What it does | Drivers / vendors | Since |
|---|---|---|---|
| **Vehicles** | Track multiple cars per household via Home Assistant entities. Per-vehicle dashboard, charging history, range and battery, climate, locks. | Tesla (native, via HA Fleet integration); Generic-EV (any car HA exposes — VW We Connect, BMW Connected Drive, Polestar, Hyundai BlueLink, OBD2 dongles, etc.) | v1.0.12 |
| **Energy** | Solar, battery, and grid energy dashboard. Reads any Home Assistant energy entities — production, consumption, battery state-of-charge, grid import/export — and renders them as the `/energy` page. | Generic HA energy (any entities you wire up) | v1.0.18 |
| **Cameras** | Live WebRTC streams from your security cameras on the `/cameras` page. Multi-camera grid layout, optional snapshot fallback. | go2rtc (handles RTSP, MJPEG, HomeKit, ONVIF, USB, etc. as upstream) | v1.0.18 |
| **Stonks** | Watchlist of stocks, ETFs, crypto, indices, and forex pairs with a per-ticker detail page (TradingView candle charts, 1d→max timeframes) and a rotating dashboard widget. Server-side TTL cache (30s quotes, 5min charts) keeps requests off the rate-limit. | Yahoo Finance (no API key required, covers every asset class) | v1.0.19 |
| **Pocket Money** | Per-kid virtual pocket-money accounts. Parent-configurable APR (daily accrual + weekly commit), scheduled allowance (weekly / biweekly / every 4 weeks), multi-goal saving queue, kid-proposed withdrawals with parent-approval inbox, and an evolving avatar (5 species × 8 stages) driven by lifetime saved. | None (purely local — no fintech, no external API) | v1.0.20 |

All five bundled plugins ship in core. They can be enabled or disabled per family at `/settings/plugins` — disabled plugins disappear from the navigation, the dashboard widget grid, and the integrations list, but their data is preserved (no rows are deleted; toggling back on restores the plugin exactly).

---

## Third-party plugins

Nothing here yet. Kinboard's plugin contract was introduced in v1.0.12 alongside the Vehicles plugin. As community plugins land, they'll be listed here.

### Want to ship a plugin?

1. Read [Plugin Architecture](Plugin-Architecture.md) to understand the `SurfacePlugin` interface, the predicate-based nav-gating, and the build-time registration model.
2. Build your plugin in your own fork or a separate repo. Drop the `webapp/src/plugins/<your-plugin-id>/` directory into the layout described in the architecture doc.
3. Open a PR to **this file** (`docs/wiki/Plugin-Directory.md`) adding your plugin to the table below. Include:
   - Plugin name
   - One-sentence description (what it does, who it's for)
   - Link to the source repo
   - Link to install/setup docs (your repo's README is fine)
   - Maintainer GitHub handle
4. The PR review focuses on:
   - Plugin doesn't break the core build (verified by CI on the maintainer's fork before listing)
   - The link description is honest about what the plugin requires (e.g. "needs HA + a specific integration", "needs a paid third-party API key")
   - The plugin is MIT or another permissive license that lets users self-host it

### Listing template (copy-paste)

```markdown
| **Plugin Name** | One-sentence description. Notes about external dependencies. | [github.com/<user>/<repo>](https://github.com/<user>/<repo>) | <maintainer-handle> |
```

| Plugin | Description | Source | Maintainer |
|---|---|---|---|
| _(empty — be the first)_ | | | |

---

## What lives here vs in the bundled list

A plugin moves from "third-party" to "bundled" only when it meets all of these:

- The author and the Kinboard maintainer agree the plugin solves a need broad enough to ship in core
- The plugin has been stable across at least one Kinboard release on the author's deployment
- The plugin's dependencies (HA integrations, external APIs) are widely available — not single-vendor or paywalled
- The author commits to maintaining it alongside Kinboard releases (or hands maintenance to a co-maintainer)

The bar is high on purpose. Core plugins absorb maintenance cost on every Kinboard release; we only take that on for things that pay for themselves in user value.

---

## Removing or archiving a plugin from this list

If a third-party plugin stops being maintained, open a PR moving it to a new "Archived" section at the bottom with a note about the last-known-working Kinboard version. Don't silently delete entries — self-hosters running older versions may still be using them.

---

## Security note

Third-party plugins run with full app privileges. They have access to your family's data via Supabase, can call any Home Assistant entity, and can read/write any setting. Before installing a third-party plugin:

- Read the plugin's source code, especially anywhere it talks to the network
- Verify the maintainer's identity (check the GitHub profile, see what else they maintain)
- Pin to a specific commit/tag rather than `main`

Kinboard's plugin contract has no sandboxing because runtime plugin loading was deliberately out of scope for v1. The expectation is that you treat installing a plugin like applying a fork patch — review it the same way.
