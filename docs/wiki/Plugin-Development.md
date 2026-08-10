# Plugin development

Kinboard's plugin system is build-time, single-maintainer-friendly, and ships with one plugin type: **surface plugins**. A surface plugin adds a net-new page to the dashboard — its own nav entry, settings flow, optional dashboard widget, and nav-gating predicate. Provider plugins (alternative backends for an existing surface, e.g. an ICS file as a Calendar source) are deliberately deferred until a second concrete provider exists to design against.

The Vehicles feature is the canonical reference implementation. Everything on this page can be cross-checked against `webapp/src/plugins/vehicles/`.

> **Build-time, in-repo, not sandboxed.** Plugins are registered at build time and run in the same Next.js bundle with full access to every hook and component — the trust model is the same as any other contributor PR. There is no runtime loading, no plugin marketplace, no npm-install path, no dynamic `import()`. You ship a plugin by forking, adding files under `webapp/src/`, and opening a PR.

---

## What a plugin touches

| File / location | Purpose |
|---|---|
| `webapp/src/plugins/<id>/index.ts` | The `SurfacePlugin` manifest |
| `webapp/src/plugins/registry.ts` | One import + one array entry to register it |
| `webapp/src/app/<id>/page.tsx` | The feature page (`/<id>`) |
| `webapp/src/app/settings/<id>/` | The settings flow (`/settings/<id>`) |
| `webapp/src/components/widgets/<id>-widget.tsx` | Optional dashboard widget |
| `webapp/messages/{en,de}.json` | `nav.<id>`, `settings.<id>.*`, and your `<i18nNamespace>` block |
| `webapp/src/plugins/<id>/drivers/` | Optional — only for multi-vendor surfaces |

No migrations, no `/api/plugins/*`, no `families` column. Per-family config lives in the `settings` table under a key your plugin owns. Add a `migration_<id>.sql` only if your plugin needs its own tables.

---

## Building a plugin

### 1. Manifest — `webapp/src/plugins/<id>/index.ts`

Implement the `SurfacePlugin` contract from `webapp/src/plugins/types.ts`. The Vehicles manifest is the canonical example:

```ts
import { Car } from "lucide-react";
import type { SurfacePlugin } from "../types";
import { useVehiclesCount } from "@/hooks/use-vehicles";
import { VehiclesWidget } from "@/components/widgets/vehicles-widget";

export const vehiclesPlugin: SurfacePlugin = {
  id: "vehicles",
  navItem: {
    href: "/vehicles",
    icon: Car,
    labelKey: "vehicles",   // resolves to messages/{locale}.json nav.vehicles
  },
  settingsItem: {
    href: "/settings/vehicles",
    icon: Car,
    titleKey: "title",        // resolves to settings.vehicles.title
    descriptionKey: "description",
  },
  dashboardWidget: VehiclesWidget,      // optional
  isNavVisible: (ctx) => {
    if (ctx.ownDataLoading) return "loading";
    return (ctx.ownDataCount ?? 0) > 0;
  },
  useOwnDataCount: useVehiclesCount,
  i18nNamespace: "vehicles",
};
```

`useOwnDataCount` must return `{ count: number | undefined; loading: boolean }`. If your nav entry doesn't gate on your own row count (e.g. always visible, or gated on `ctx.haConnected`), return `{ count: undefined, loading: false }`.

### 2. Register it — `webapp/src/plugins/registry.ts`

```ts
import { vehiclesPlugin } from "./vehicles";
import { myPlugin } from "./my-plugin";

export const PLUGINS: readonly SurfacePlugin[] = [
  vehiclesPlugin,
  myPlugin,   // ← add here
];
```

Array order is nav order and `/settings/plugins` order.

**This is not the only list.** `registry.ts` makes the plugin exist; three other hand-kept lists decide whether anyone can see it, and a plugin that skips them ships broken in ways nothing fails on:

| Also add | Where | What breaks without it |
| --- | --- | --- |
| `{ href, icon, labelKey }` matching your `navItem` | `webapp/src/lib/constants.ts` (`NAV_ITEMS`) | **The nav entry never appears.** `useVisibleNavItems` *filters* `NAV_ITEMS` — it does not append plugin entries — so an href that isn't in that array can never be shown, whatever your predicate returns |
| `settings.plugins.label.<id>` and `settings.plugins.description.<id>`, in `en`/`de`/`fr` | `webapp/messages/*.json` | `/settings/plugins` lists a switch **named `label.<id>`** — next-intl renders a missing key as the key |
| A `WidgetVisibility` key, a `WIDGET_CONFIGS` row with its copy, and the render line | `webapp/src/types/widgets.ts`, `webapp/src/app/settings/widgets/page.tsx`, `webapp/src/app/page.tsx` | A `dashboardWidget` nobody can switch on |

All four are checked by `webapp/e2e/plugin-registry-i18n.spec.ts`, which reads the same registry the app does — so a plugin added tomorrow is covered without touching that test. Every one of these was a real defect in the Photos plugin before the test existed.

### 3. The page — `webapp/src/app/<id>/page.tsx`

`"use client"`, call `useKeyboardShortcuts()` + `useSwipeNavigation()` for consistency with other pages, render a `<PageHeader>`, and — important — a graceful empty/unconfigured state (no blank screen when there's no data yet). See `webapp/src/app/vehicles/page.tsx`.

### 4. The settings flow — `webapp/src/app/settings/<id>/`

At minimum a list/landing page. For multi-item surfaces (more than one row per family, like Vehicles), follow the Vehicles layout: a `new/` sub-route for creation and `[id]/` for per-item editing.

### 5. Per-family config & enable state

Config lives in the `settings` table under a key your plugin owns — read/write it with the shared `useSetting` / `useUpdateSetting` hooks (`webapp/src/hooks/use-supabase-queries.ts`), don't invent a new persistence path. Enable/disable is handled for you: `/settings/plugins` writes a per-family `enabled_plugins` blob; gate your page, widget, and any cron-driven work on `useIsPluginEnabled("<id>")` (`webapp/src/hooks/use-enabled-plugins.ts`). Plugins are **enabled by default** (a missing key means on), so a freshly-shipped plugin appears for existing families without a migration.

### 6. i18n — `webapp/messages/{en,de}.json`

Add, in **both** locale files (CI's `i18n bundles` job fails the PR if EN and DE key sets diverge): `nav.<id>`, `settings.<id>.title` + `settings.<id>.description`, and a top-level `"<i18nNamespace>": { … }` block for everything your page/settings render.

### 7. Optional dashboard widget

Set `dashboardWidget` on the manifest to a `ComponentType<object>` — it receives no props, it fetches its own data. The registry renders it via `webapp/src/plugins/render-dashboard-widgets.tsx`. Keep it compact and have it gate itself: `useIsPluginEnabled("<id>")` (render a "discover" card linking `/settings/plugins` when disabled — see `plugin-discover-card.tsx` and how `vehicles-widget.tsx` / `stonks-widget.tsx` / `pocket-money-widget.tsx` use it), and respect the per-device `widget_visibility` setting.

---

## Predicate-based nav gating

`useVisibleNavItems` (`webapp/src/hooks/use-visible-nav-items.ts`) evaluates each plugin's predicate on every render, passing a `NavGatingContext`:

```ts
type NavGatingContext = {
  haConnected: boolean;    // HA URL + token saved
  haLoading: boolean;      // HA status query in flight
  ownDataCount: number | undefined;  // populated by useOwnDataCount
  ownDataLoading: boolean;
};

type NavGatingResult = boolean | "loading";
```

Return `true` to show, `false` to hide, `"loading"` to hide while data is still in flight (prevents the nav from flashing items in/out as React Query resolves).

### The Rules-of-Hooks invariant

`useVisibleNavItems` calls every plugin's `useOwnDataCount` in fixed order each render. `PLUGINS` is a module-level, fixed-length `readonly` array, so that's safe. **Never** make registration conditional at runtime — a feature flag that adds/removes entries between renders changes the hook-call count and breaks React. Build-time branching (module-eval `process.env`) is fine.

---

## Drivers within a plugin

Some surfaces support multiple vendors with the same data model but different entity IDs / API shapes — Vehicles supports `tesla` and `generic-ev` today. Each vendor is a **driver**: a self-contained implementation of `VehicleDriver<TConfig>` (`webapp/src/plugins/vehicles/drivers/types.ts`) providing a `Card` component, a `ConfigForm` component, a `defaultConfig`, an `isConfigured` predicate, and a `displayNameKey`. Drivers live under `webapp/src/plugins/vehicles/drivers/` and register in that plugin's own `drivers/registry.ts` — adding a vendor touches no other file.

Add a **new plugin** (not a driver) when the surface concept itself is different — a Robot-Vacuums plugin is not a Vehicles driver.

---

## Registered plugins

`registry.ts` currently registers six surface plugins: **Vehicles**, **Energy**, **Cameras**, **Stonks**, **Pocket Money**, and **Photos**. Energy and Cameras predated the plugin system and were migrated onto the contract once it stabilized; Photos was the first written against it from scratch — the abstraction is validated across six concrete surfaces. See [Plugin-Directory](Plugin-Directory) for what each one does.

---

## Before you open the PR

- `npm run lint` is clean (the CI gate).
- `npx tsc --noEmit` passes (lint alone won't catch type errors).
- EN ↔ DE key parity holds.
- The page and widget have graceful empty/unconfigured/disabled states.
- A `CHANGELOG.md` `[Unreleased]` entry describes the new surface.
- If you added tables, the migration is `webapp/docker/migration_<id>.sql`, idempotent (`IF NOT EXISTS`), and sorts after anything it depends on.

## Related

- [Plugin-Directory](Plugin-Directory) — the shipped plugins
- [Architecture](Architecture) — where plugins sit in the stack
