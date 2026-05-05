# Plugin authoring

> ⚠ **v1.1 workstream — not stable in v1.0.** This page captures the design direction so contributors can give early feedback. Don't ship plugins against the v1.0 internals; they'll break.

The goal: niche integrations like Tesla Fleet, Zendure SolarFlow, specific waste-collection-API providers, etc. should live in the repo as **opt-in plugins**, not as core code that ships to every user. Plugins should be:

- Installable via a settings toggle, not by editing source
- Layered cleanly on top of the core stack (no random hooks scattered through `src/`)
- Author-able by someone who knows React + TypeScript without needing to understand the entire codebase

## Why plugins, not just optional integrations

Kinboard already has six "integrations" (Google, HA, Immich, Bring, OpenWeatherMap, Cameras). Those are core because almost everyone wants them and they generalize.

A **plugin** is for the long tail:

- Tesla Fleet API — relevant to ~3% of users
- Zendure SolarFlow batteries — even narrower
- Country-specific waste-collection providers — n different APIs per country
- Niche lighting / HVAC / weather services

If we accepted those as core, the codebase would balloon and the "first impression" page list would scare new self-hosters. As plugins, they ship dormant and you turn on what you need.

## Proposed plugin shape

A plugin is a directory under `webapp/src/plugins/<name>/` containing:

```
webapp/src/plugins/<name>/
├── plugin.ts             # Manifest + entry points
├── settings/             # Settings page contributions
│   └── index.tsx
├── widgets/              # Dashboard widgets contributions
│   └── status-card.tsx
├── api/                  # Server-side API routes mounted under /api/plugins/<name>/
│   └── poll.ts
├── locales/
│   ├── en.json
│   └── de.json
└── plugin.config.ts      # Per-plugin config schema (zod)
```

The `plugin.ts` manifest registers what the plugin contributes:

```ts
export const plugin: Plugin = {
  id: "tesla-fleet",
  name: "Tesla Fleet",
  description: "Live battery, range, and charging status from your Tesla via the Fleet API",
  icon: Car,                                    // lucide icon
  enabledByDefault: false,
  settings: {
    href: "/settings/plugins/tesla-fleet",
    component: () => import("./settings"),
  },
  widgets: [
    {
      key: "tesla-status",
      defaultVisible: false,
      component: () => import("./widgets/status-card"),
      previewKey: "preview",
    },
  ],
  api: {
    "/poll": () => import("./api/poll"),
  },
  cron: [
    { schedule: "@every 5m", endpoint: "/poll" },
  ],
  realtime: {
    settingsKey: "tesla_fleet",                 // lives in settings table
  },
};
```

## Lifecycle hooks

Each plugin can opt in to:

1. **Settings page** — a dedicated `/settings/plugins/<id>` route. Auto-listed in the settings hub when the plugin is enabled.
2. **Widgets** — appear in `/settings/widgets` and on the dashboard when toggled.
3. **API routes** — mounted under `/api/plugins/<id>/*`. Same Next.js handler signature as core API routes.
4. **Cron jobs** — added to the Ofelia container's job list when the plugin is enabled.
5. **Database access** — read/write `settings` rows under a plugin-specific key prefix (`plugin:<id>:*`). RLS policies allow this if the family_id matches.
6. **Realtime subscriptions** — if the plugin watches a settings key, the webapp subscribes to that row and the plugin's components re-render on change.

## Enabling / disabling

In **Settings → Plugins** (a new sub-page in v1.1), each registered plugin shows up with:

- Description
- Toggle switch (off by default unless the manifest sets `enabledByDefault: true`)
- "Configure" link (jumps to the plugin's settings page)

Enabling a plugin per-family inserts a row into `families.enabled_plugins` (a new column added in the v1.1 migration). API routes and cron jobs only fire for families that have the plugin enabled.

## Package layout requirements

- Plugins live **inside** the main `webapp/src/plugins/` tree, not as separate npm packages. Kinboard is a single-deploy app; per-plugin deployment isn't a goal.
- Each plugin can `import` from core utilities (`@/lib/supabase`, `@/components/ui/*`, etc.) but not from other plugins.
- Plugin-specific deps go in the main `package.json` with a comment marking the plugin owner. We don't ship per-plugin `package.json` files.
- Plugins must add their EN + DE translations to their own `locales/` directory. The build wires them into the main bundle via `next-intl`.

## What's currently in-tree but should become plugins

In v1.0, two integrations live in core that should move to plugins in v1.1:

- **Tesla Fleet integration** — the energy chart's Tesla-specific entity mapping, the dashboard's Tesla card. Currently scattered across `webapp/src/components/tesla-*` and `webapp/src/app/settings/tesla/`. The settings page already exists; the widget code already exists.
- **Zendure SolarFlow detail** — the energy dashboard hard-codes some Zendure-specific entity name patterns (`battery_charge_power` vs `battery_discharge_power`, etc.). Could become a plugin that contributes those defaults.

The migration path will be a v1.0 → v1.1 in-place: detect existing settings under `tesla` and `energy` keys, move them to `plugin:tesla-fleet:settings` and `plugin:zendure-solarflow:settings`, mark the plugins as enabled. Backwards-compatible.

## Dev workflow (proposed)

```bash
# Scaffold a new plugin
cd webapp
npm run plugin:create my-plugin

# Edit src/plugins/my-plugin/*

# Run dev — plugin auto-loaded
npm run dev

# Lint includes plugin code
npm run lint
```

## Open questions

These are the questions to settle before v1.1:

1. **Where does plugin DB schema live?** Plugins might want their own tables, not just a settings JSONB blob. Shipping per-plugin migrations is more powerful but has a sequencing problem.
2. **Hot reloadable?** Probably not in v1.1 — enable/disable requires a webapp restart for now. Realistic for v1.2 once the plugin loader is HMR-aware.
3. **External plugins?** A `pluginUrl` field that loads from npm or a CDN at build time? Tempting but adds attack surface. Decision: no, keep plugins inside the repo for v1.1.
4. **Plugin marketplace UI?** Not in v1.1; just the in-repo list. v1.2+ if the project grows.

## Until v1.1 lands

Don't write plugins yet. Open a [discussion](https://github.com/svenger87/kinboard/discussions) describing the integration you want — it might already be on the roadmap, or might be a stronger candidate for core inclusion than for a plugin.

For really custom needs that won't ever upstream, fork the repo and add your code directly under `webapp/src/`. Maintain your fork; we won't break compatibility intentionally but the plugin contract is the long-term stable surface.

## Related

- [[Architecture]] — where plugins fit in the layout
- [[Database-Schema]] — the `families.enabled_plugins` column lands in v1.1
