# Plugin authoring

A hands-on walkthrough for building a **surface plugin** — a net-new page (like Vehicles, Stonks, or Pocket Money) that brings its own nav entry, settings flow, optional dashboard widget, and per-family enable/disable toggle.

This page is the copy-this checklist. For the *why* and the conceptual contract, read [Plugin-Architecture](Plugin-Architecture) first. The canonical reference implementation is `webapp/src/plugins/vehicles/`; when in doubt, mirror it.

> **Build-time, in-repo, not sandboxed.** Plugins are registered at build time and run in the same Next.js bundle with full access to core hooks and components. There is no runtime loading, no marketplace, no npm-install path. You ship a plugin by forking, adding files under `webapp/src/`, and opening a PR — same trust model as any other contribution.

---

## At a glance — what a plugin touches

| File / location | Purpose |
|---|---|
| `webapp/src/plugins/<id>/index.ts` | The `SurfacePlugin` manifest |
| `webapp/src/plugins/registry.ts` | One import + one array entry to register it |
| `webapp/src/app/<id>/page.tsx` | The feature page (`/<id>`) |
| `webapp/src/app/settings/<id>/` | The settings flow (`/settings/<id>`) |
| `webapp/src/components/widgets/<id>-widget.tsx` | Optional dashboard widget |
| `webapp/messages/{en,de}.json` | `nav.<id>`, `settings.<id>.*`, and your `<i18nNamespace>` block |
| `webapp/src/plugins/<id>/drivers/` | Optional — only for multi-vendor surfaces |

No migrations, no `/api/plugins/*`, no `families` column. Per-family config lives in the `settings` table under a key your plugin owns (see step 5). Add a `migration_<id>.sql` only if your plugin needs its own tables.

---

## Step 1 — Manifest (`webapp/src/plugins/<id>/index.ts`)

Implement the `SurfacePlugin` contract from `webapp/src/plugins/types.ts`. Mirrors the Vehicles manifest:

```ts
import { Sprout } from "lucide-react";
import type { SurfacePlugin } from "../types";
import { useGardenZonesCount } from "@/hooks/use-garden";
import { GardenWidget } from "@/components/widgets/garden-widget";

export const gardenPlugin: SurfacePlugin = {
  id: "garden",                       // stable, kebab-case, unique
  navItem: {
    href: "/garden",
    icon: Sprout,
    labelKey: "garden",               // → nav.garden
  },
  settingsItem: {
    href: "/settings/garden",
    icon: Sprout,
    titleKey: "title",                // → settings.garden.title
    descriptionKey: "description",    // → settings.garden.description
  },
  dashboardWidget: GardenWidget,      // optional
  isNavVisible: (ctx) => {
    if (ctx.ownDataLoading) return "loading";
    return (ctx.ownDataCount ?? 0) > 0;
  },
  useOwnDataCount: useGardenZonesCount,
  i18nNamespace: "garden",
};
```

`useOwnDataCount` must return `{ count: number | undefined; loading: boolean }`. If your nav entry doesn't gate on your own row count (e.g. it's always visible, or gates on `ctx.haConnected`), return `{ count: undefined, loading: false }`.

---

## Step 2 — Register it (`webapp/src/plugins/registry.ts`)

```ts
import { gardenPlugin } from "./garden";

export const PLUGINS: readonly SurfacePlugin[] = [
  vehiclesPlugin,
  energyPlugin,
  camerasPlugin,
  stonksPlugin,
  pocketMoneyPlugin,
  gardenPlugin,        // ← add here
];
```

Array order = order in the nav and on the `/settings/plugins` and settings-landing pages. This is the **only** registration step — `/settings/plugins` lists every entry automatically, and `useVisibleNavItems` gates each one via its predicate.

> **Rules-of-Hooks invariant.** `useVisibleNavItems` calls every plugin's `useOwnDataCount` in fixed order each render. `PLUGINS` is a module-level, fixed-length array, so that's safe. **Never** make registration conditional at runtime (a feature flag that adds/removes entries between renders) — it changes the hook-call count and breaks React. Build-time branching (module-eval `process.env`) is fine.

---

## Step 3 — The page (`webapp/src/app/<id>/page.tsx`)

`"use client"`, call `useKeyboardShortcuts()` + `useSwipeNavigation()` for consistency with other pages, render a `<PageHeader>`, and — important — a **graceful empty/unconfigured state** (no blank screen when there's no data yet). See `webapp/src/app/vehicles/page.tsx`.

---

## Step 4 — The settings flow (`webapp/src/app/settings/<id>/`)

At minimum a list/landing page. For multi-item surfaces (more than one row per family, like Vehicles), follow the Vehicles layout: a `new/` sub-route for creation and `[id]/` for per-item editing.

---

## Step 5 — Per-family config & enable state

- **Config** lives in the `settings` table under a key your plugin owns. Read/write it with the shared `useSetting`/`useUpdateSetting` hooks (`webapp/src/hooks/use-supabase-queries.ts`) — don't invent a new persistence path.
- **Enable/disable** is handled for you. `/settings/plugins` writes a per-family `enabled_plugins` blob; gate your page, widget, and any cron-driven work on `useIsPluginEnabled("<id>")` (`webapp/src/hooks/use-enabled-plugins.ts`). Plugins are **enabled by default** (a missing key means on), so a freshly-shipped plugin appears for existing families without a migration.

---

## Step 6 — i18n (`webapp/messages/{en,de}.json`)

Add, in **both** locale files (the CI `i18n bundles` job fails the PR if EN and DE key sets diverge):

- `nav.<id>` — the bottom-nav label
- `settings.<id>.title` + `settings.<id>.description` — read by the settings landing page
- a top-level `"<i18nNamespace>": { … }` block for everything your page/settings render

---

## Step 7 — Optional dashboard widget

Set `dashboardWidget` on the manifest to a `ComponentType<object>` (it receives no props — it fetches its own data). The registry renders it via `webapp/src/plugins/render-dashboard-widgets.tsx`. Keep it compact, and have it **gate itself**:

- `useIsPluginEnabled("<id>")` — render a "discover" card linking `/settings/plugins` when disabled, rather than nothing (see `webapp/src/components/widgets/plugin-discover-card.tsx` and how `vehicles-widget.tsx` / `stonks-widget.tsx` / `pocket-money-widget.tsx` use it)
- the per-device `widget_visibility` setting decides whether the user has it on the dashboard at all

---

## Drivers (multi-vendor surfaces only)

If one surface spans several vendors with the same data model but different entity IDs / API shapes (Vehicles → Tesla + Generic-EV), add **drivers** rather than separate plugins. A driver implements `VehicleDriver<TConfig>` (`webapp/src/plugins/vehicles/drivers/types.ts`): a `Card`, a `ConfigForm`, a `defaultConfig`, an `isConfigured` predicate, and a `displayNameKey`. Register it in the plugin's own `drivers/registry.ts` — adding a vendor touches no other file.

Add a **new plugin** (not a driver) when the surface concept itself is different (a Robot-Vacuums plugin is not a Vehicles driver).

---

## Before you open the PR

- `npm run lint` is clean (the CI gate).
- `npx tsc --noEmit` passes (lint alone won't catch type errors).
- EN ↔ DE key parity holds.
- The page and widget have graceful empty/unconfigured/disabled states.
- A `CHANGELOG.md` `[Unreleased]` entry describes the new surface.
- If you added tables, the migration is `webapp/docker/migration_<id>.sql`, idempotent (`IF NOT EXISTS`), and sorts after anything it depends on (the `migrations` CI job checks ALTER-before-CREATE ordering).

## Related

- [Plugin-Architecture](Plugin-Architecture) — the contract and design rationale
- [Plugin-Directory](Plugin-Directory) — the shipped plugins
- [Architecture](Architecture) — where plugins sit in the stack
