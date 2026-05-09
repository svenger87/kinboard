# Plugin Architecture

Kinboard's plugin system is build-time, single-maintainer-friendly, and ships in v1.0 with one plugin type: **surface plugins**. A surface plugin adds a net-new page (a new surface) to the dashboard — it brings its own nav entry, settings flow, optional dashboard widget, and nav-gating predicate. Provider plugins (alternative backends for an existing surface, e.g. an ICS file as a Calendar source) are deliberately deferred until a second concrete provider exists to design against; there is not enough information yet to make a good abstraction.

The Vehicles feature is the canonical reference implementation. Everything described here can be cross-checked against `webapp/src/plugins/vehicles/`.

---

## What plugins are

A surface plugin is a self-contained feature area that adds a new top-level page. The Vehicles plugin adds `/vehicles` and `/settings/vehicles`, a bottom-nav entry that appears only when at least one vehicle row exists, and a dashboard widget that rotates through configured vehicles. The plugin is responsible for:

- Its page (`webapp/src/app/vehicles/page.tsx`)
- Its settings flow (`webapp/src/app/settings/vehicles/`)
- Its nav entry + nav-gating predicate
- An optional dashboard widget
- An i18n namespace in `messages/{en,de}.json`

Plugins are registered at build time in `webapp/src/plugins/registry.ts`. There is no runtime loading, no sandboxing, and no dynamic import. Contributors ship plugins by forking and opening a PR.

---

## What plugins are NOT

- **Not runtime-loaded.** There is no plugin marketplace, no npm install path, no dynamic `import()`. Adding a plugin means editing the source and shipping a new Docker image.
- **Not sandboxed.** A plugin runs in the same Next.js bundle with full access to every hook and component. The trust model is the same as any other contributor PR.
- **Not provider plugins (yet).** Swapping out the backend for an existing feature (e.g. Todoist instead of the built-in tasks table) requires a different abstraction that doesn't exist yet.

---

## How to add a plugin

### 1. Create the plugin directory

```
webapp/src/plugins/<plugin-id>/
  index.ts          # SurfacePlugin manifest
  drivers/          # optional — for multi-vendor surfaces like Vehicles
```

Use kebab-case for the id. It must be unique across the registry.

### 2. Define a SurfacePlugin manifest in `index.ts`

The full contract lives in `webapp/src/plugins/types.ts`. The Vehicles manifest is the canonical example:

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
  dashboardWidget: VehiclesWidget,
  isNavVisible: (ctx) => {
    if (ctx.ownDataLoading) return "loading";
    return (ctx.ownDataCount ?? 0) > 0;
  },
  useOwnDataCount: useVehiclesCount,
  i18nNamespace: "vehicles",
};
```

### 3. Build the page

Create `webapp/src/app/<plugin-id>/page.tsx`. Follow the existing page conventions: `"use client"` at the top, `useKeyboardShortcuts()` + `useSwipeNavigation()` for consistency, a `<PageHeader>` or equivalent, and a graceful empty/unconfigured state.

### 4. Build the settings flow

Create `webapp/src/app/settings/<plugin-id>/` with at minimum a list page. For multi-item surfaces (like Vehicles, where users can have more than one entry), a `new/` sub-route for the creation flow and a `[id]/` sub-route for per-item editing follow the Vehicles pattern.

### 5. Add an i18n namespace

Add a top-level key in both `webapp/messages/en.json` and `webapp/messages/de.json` matching `i18nNamespace`. Also add a `nav.<plugin-id>` key and a `settings.<plugin-id>.title` + `settings.<plugin-id>.description` key (the last two are read by the settings landing page when it renders the plugin's entry).

EN and DE must have identical key sets — the CI `i18n bundles` job fails the PR if they diverge.

### 6. Register in the registry

```ts
// webapp/src/plugins/registry.ts
import { vehiclesPlugin } from "./vehicles";
import { myPlugin } from "./my-plugin";

export const PLUGINS: readonly SurfacePlugin[] = [
  vehiclesPlugin,
  myPlugin,
];
```

Order here determines the order plugins appear in the nav and on the settings landing page.

### 7. Optionally add a dashboard widget

If the plugin has something meaningful to show on the main dashboard, set `dashboardWidget` to a React component. The component receives no props (`ComponentType<object>`); it fetches its own data. Keep it compact — the dashboard grid is tight.

---

## Predicate-based nav gating

Nav gating controls whether a plugin's nav entry appears in the bottom bar. The predicate is evaluated by `useVisibleNavItems` (`webapp/src/hooks/use-visible-nav-items.ts`) on every render. It receives a `NavGatingContext`:

```ts
type NavGatingContext = {
  haConnected: boolean;    // HA URL + token saved
  haLoading: boolean;      // HA status query in flight
  ownDataCount: number | undefined;  // populated by useOwnDataCount
  ownDataLoading: boolean;
};

type NavGatingResult = boolean | "loading";
```

Return `true` to show, `false` to hide, `"loading"` to hide while data is still in flight. The loading case prevents the nav from flashing items in/out as React Query resolves.

### The useOwnDataCount hook contract

Each plugin supplies a `useOwnDataCount` hook that returns `{ count: number | undefined; loading: boolean }`. The registry calls this from `useVisibleNavItems` in fixed iteration order. This is the critical Rules-of-Hooks invariant: because `PLUGINS` is a module-level readonly array, the number of hook calls is constant across renders. Do not add conditional plugin registration or runtime feature flags that change `PLUGINS.length` between renders — that would change the hook call count and break React.

For plugins that don't gate on their own data (e.g. a plugin that is always visible if the user has HA connected), return `{ count: undefined, loading: false }`.

---

## Drivers within a plugin

Some surfaces support multiple vendors. Vehicles supports `tesla` and `generic-ev` today, with more to come. Each vendor is a **driver** — a self-contained implementation of `VehicleDriver<TConfig>` (see `webapp/src/plugins/vehicles/drivers/types.ts`) that provides:

- A `Card` component rendering on the `/vehicles` page
- A `ConfigForm` component rendering on `/settings/vehicles/[id]`
- A `defaultConfig` blob
- An `isConfigured` predicate
- A `displayNameKey` for the vendor picker

Drivers live under `webapp/src/plugins/vehicles/drivers/` and are registered in `webapp/src/plugins/vehicles/drivers/registry.ts`. Adding a new vendor means adding a file there; no other files change.

**Add a new driver (not a new plugin)** when the data model is the same but the entity IDs or API shape differs by vendor. Add a new plugin when the entire surface concept is different (e.g. a Robot Vacuums plugin is not a Vehicles driver).

---

## Migration path for existing surfaces

Energy and Cameras are not plugins yet — they predate the plugin system and are wired directly into `NAV_ITEMS` with bespoke gating in `use-visible-nav-items.ts`. The plan is to migrate them onto the plugin contract as more plugins ship and the abstraction stabilizes. For now, treat them as legacy surfaces that follow the same nav-gating intent but not the registry pattern.
