# Plugin development

Kinboard's plugin system is build-time and single-maintainer-friendly, and
ships one plugin type: a **surface plugin**, which adds a page to the app with
its own nav entry, settings flow, and optional dashboard widget. Provider
plugins (alternative backends for an existing surface) are deferred until a
second concrete provider exists to design against.

**Vehicles** is the reference implementation for a multi-vendor surface;
**Photos** is the smallest complete one. Everything here can be cross-checked
against `webapp/src/plugins/`.

> **Build-time, in-repo, not sandboxed.** Plugins are registered at build time
> and run in the same Next.js bundle with full access to every hook and
> component — the trust model is the same as any other contributor PR. There is
> no runtime loading, no marketplace, no npm-install path, no dynamic
> `import()`. You ship a plugin by forking, adding files under `webapp/src/`,
> and opening a PR.

---

## Read this first: the manifest is not the registration

The `SurfacePlugin` manifest describes your plugin. It does **not**, by itself,
put anything on screen. Kinboard has several hand-kept lists, and a plugin that
is missing from one of them fails in a way nothing catches at build time:

| To get… | Add to | If you skip it |
| --- | --- | --- |
| the plugin to exist at all | `webapp/src/plugins/registry.ts` | Nothing happens anywhere |
| a **nav entry** | `NAV_ITEMS` in `webapp/src/lib/constants.ts` | The entry never appears. `useVisibleNavItems` *filters* `NAV_ITEMS` — it never appends plugin entries — so an href that isn't there can't be shown, whatever your predicate returns |
| a **name on `/settings/plugins`** | `settings.plugins.label.<id>` + `.description.<id>` in `webapp/messages/{en,de,fr}.json` | The switch is labelled **`label.<id>`** — next-intl renders a missing key as the key |
| a **settings entry** | the list in `webapp/src/app/settings/page.tsx` | Your settings page exists but nothing links to it |
| a **dashboard widget** | a key in `webapp/src/types/widgets.ts`, a row in `WIDGET_CONFIGS` (`webapp/src/app/settings/widgets/page.tsx`) with its copy, and a render line in `webapp/src/app/page.tsx` | A widget nobody can switch on |

`webapp/e2e/plugin-registry-i18n.spec.ts` checks the nav, the plugins-page copy
and the widget switch for every registered plugin, in all three languages. It
reads the same registry the app does, so your plugin is covered without
touching the test. Every one of those rows was a real defect in the Photos
plugin before that test existed.

### Manifest fields that nothing reads yet

Three fields on `SurfacePlugin` are declared but consumed by nothing today:

- **`settingsItem`** — *required* by the interface, so you must write it and it
  must type-check, but no component reads it. The settings landing page keeps
  its own hand-written list (row four of the table above).
- **`i18nNamespace`** — also required, also unread. Your namespace works
  because your own components call `useTranslations("<namespace>")`, not
  because the manifest declares it.
- **`dashboardWidget`** — optional. Its only reader,
  `webapp/src/plugins/render-dashboard-widgets.tsx`, is itself never called
  (`// Wired up in Task 10` on the type is the honest state of it); the
  dashboard renders widgets by hand in `app/page.tsx`.

Write them to match the shipped plugins — the type demands two of them and
consistency is worth something if they are ever wired up — but do not expect
them to connect anything. The rows in the table above are what actually work.
This is worth knowing before you spend an afternoon wondering why a
correct-looking manifest produced no settings link.

---

## Files you will touch

| File | Purpose | Required |
| --- | --- | --- |
| `webapp/src/plugins/<id>/index.ts` | The `SurfacePlugin` manifest | Yes |
| `webapp/src/plugins/registry.ts` | One import + one array entry | Yes |
| `webapp/src/app/<id>/page.tsx` | The feature page (`/<id>`) | Yes |
| `webapp/src/lib/constants.ts` | `NAV_ITEMS` entry + the icon import | Yes, for a nav entry |
| `webapp/messages/{en,de,fr}.json` | `nav.<id>`, `settings.plugins.label.<id>`, `settings.plugins.description.<id>`, plus your own namespace | Yes |
| `webapp/src/app/settings/<id>/page.tsx` | The settings flow | If it needs configuring |
| `webapp/src/app/settings/page.tsx` | The link to that settings page | If it needs configuring |
| `webapp/src/components/widgets/<id>-widget.tsx` + the widget trio above | Dashboard widget | Optional |
| `webapp/src/plugins/<id>/drivers/` | Multi-vendor surfaces only | Optional |
| `webapp/docker/migration_<id>.sql` | Only if you need your own tables | Rare |

Per-family config lives in the `settings` table under a key your plugin owns —
no migration, no `families` column, no `/api/plugins/*`.

---

## Building one

### 1. The manifest — `webapp/src/plugins/<id>/index.ts`

```ts
import { Images } from "lucide-react";
import type { SurfacePlugin } from "../types";
import { usePhotoLibraryCount } from "@/hooks/use-photo-library-count";
import { PhotosWidget } from "@/components/widgets/photos-widget";

export const photosPlugin: SurfacePlugin = {
  id: "photos",
  navItem: { href: "/photos", icon: Images, labelKey: "photos" },

  // Required by the interface — see "Manifest fields that nothing reads yet".
  settingsItem: {
    href: "/settings/photos",
    icon: Images,
    titleKey: "title",
    descriptionKey: "description",
  },
  i18nNamespace: "photosViewer",

  dashboardWidget: PhotosWidget,   // optional

  isNavVisible: (ctx) => {
    if (ctx.ownDataLoading) return "loading";
    return (ctx.ownDataCount ?? 0) > 0;
  },
  useOwnDataCount: usePhotoLibraryCount,
};
```

`labelKey` resolves under the `nav` namespace, so `labelKey: "photos"` needs
`nav.photos` in every message bundle.

`useOwnDataCount` must return `{ count: number | undefined; loading: boolean }`.
If your nav entry doesn't gate on your own row count — always visible, or gated
on `ctx.haConnected` — return `{ count: undefined, loading: false }`.

### 2. Register — `webapp/src/plugins/registry.ts`

```ts
export const PLUGINS: readonly SurfacePlugin[] = [
  vehiclesPlugin,
  myPlugin,   // ← add here
];
```

Array order is the order plugins appear on `/settings/plugins`.

### 3. The nav entry — `webapp/src/lib/constants.ts`

```ts
{ href: "/photos", icon: Images, labelKey: "photos" },
```

The href must match your manifest exactly. This is the step that is easiest to
miss and hardest to notice, because everything else works without it.

### 4. The page — `webapp/src/app/<id>/page.tsx`

`"use client"`, call `useKeyboardShortcuts()` and `useSwipeNavigation()` for
consistency with the rest of the app, render a `<PageHeader>`, and — important
— a graceful empty/unconfigured state. A page that renders blank when nothing
is set up reads as broken.

### 5. Settings, if it needs any

A page under `webapp/src/app/settings/<id>/`, and a link to it from the list in
`webapp/src/app/settings/page.tsx`. Read and write config with the shared
`useSetting` / `useUpdateSetting` hooks
(`webapp/src/hooks/use-supabase-queries.ts`) — don't invent a second
persistence path, and don't give a setting its own query cache. Both are the
same mistake: `useUpdateSetting` invalidates `["settings", familyId, key]`, so
a private cache entry for the same row silently goes stale, and your feature
honours a change once and then ignores it.

### 6. Enable/disable

Handled for you: `/settings/plugins` writes a per-family `enabled_plugins`
blob. Gate your page, widget and any cron-driven work on
`useIsPluginEnabled("<id>")` (`webapp/src/hooks/use-enabled-plugins.ts`).
Plugins are **enabled by default** — a missing key means on — so a new plugin
appears for existing families without a migration.

### 7. i18n

Your own namespace for the feature's copy, plus the three shared keys:
`nav.<id>`, `settings.plugins.label.<id>`, `settings.plugins.description.<id>`.

What CI enforces, exactly: `en` is the source of truth and `de` must be in full
parity with it — a key you add to `en` and forget in `de` fails the build. `fr`
may be partial; missing French keys fall back to English at runtime, so they are
reported as coverage rather than failing. A key present in any locale but
absent from `en` is always an error, and an empty string is an error anywhere.
Add all three anyway — `fr` falling back is a safety net, not a plan.

### 8. Dashboard widget (optional)

A component in `webapp/src/components/widgets/<id>-widget.tsx` that takes no
props and fetches its own data. Keep it compact and have it gate itself:
`useIsPluginEnabled("<id>")`, rendering a "discover" card that links to
`/settings/plugins` when disabled — see `plugin-discover-card.tsx` and how
`vehicles-widget.tsx`, `stonks-widget.tsx` and `photos-widget.tsx` use it.

Then the trio from the table above: the `WidgetVisibility` key, the
`WIDGET_CONFIGS` row with its label, description and preview copy, and the
render line in `app/page.tsx`. New widgets default to **off** if they need
setup before they can show anything.

---

## Nav gating

`useVisibleNavItems` (`webapp/src/hooks/use-visible-nav-items.ts`) evaluates
each plugin's predicate on every render, passing a `NavGatingContext`:

```ts
type NavGatingContext = {
  haConnected: boolean;              // HA URL + token saved
  haLoading: boolean;                // HA status query in flight
  ownDataCount: number | undefined;  // from useOwnDataCount
  ownDataLoading: boolean;
};

type NavGatingResult = boolean | "loading";
```

Return `true` to show, `false` to hide, `"loading"` to hide while data is still
in flight — that last one stops the nav flashing items in and out as React
Query resolves.

### The Rules-of-Hooks invariant

`useVisibleNavItems` calls every plugin's `useOwnDataCount` in fixed order on
every render. `PLUGINS` is a module-level, fixed-length `readonly` array, so
that is safe. **Never** make registration conditional at runtime — a feature
flag that adds or removes entries between renders changes the hook-call count
and breaks React. Build-time branching (module-eval `process.env`) is fine.

---

## Drivers within a plugin

Some surfaces support multiple vendors with the same data model but different
entity IDs or API shapes — Vehicles supports `tesla` and `generic-ev`. Each
vendor is a **driver**: a self-contained implementation of
`VehicleDriver<TConfig>` (`webapp/src/plugins/vehicles/drivers/types.ts`)
providing a `Card`, a `ConfigForm`, a `defaultConfig`, an `isConfigured`
predicate and a `displayNameKey`. Drivers live under
`webapp/src/plugins/<id>/drivers/` and register in that plugin's own
`drivers/registry.ts` — adding a vendor touches no other file.

Add a **new plugin**, not a driver, when the surface concept itself differs: a
Robot-Vacuums plugin is not a Vehicles driver.

---

## Registered plugins

`registry.ts` registers six surface plugins: **Vehicles**, **Energy**,
**Cameras**, **Stonks**, **Pocket Money** and **Photos**. Energy and Cameras
predated the plugin system and were migrated onto the contract once it
stabilised; Photos was the first written against it from scratch — the
abstraction is validated across six concrete surfaces. See
[Plugin-Directory](Plugin-Directory) for what each one does.

---

## Before you open the PR

- `npx tsc --noEmit` passes (lint alone won't catch type errors).
- `npm run lint` is clean — the CI gate.
- `npx playwright test e2e/plugin-registry-i18n.spec.ts` passes: your plugin
  has a nav entry, a name, a description and — if it ships a widget — a switch.
- EN ↔ DE key parity holds, no empty strings anywhere, and nothing exists in a locale that `en` doesn't have.
- The page and widget have graceful empty, unconfigured and disabled states.
- A `CHANGELOG.md` `[Unreleased]` entry describes the new surface.
- If you added tables, the migration is `webapp/docker/migration_<id>.sql`,
  idempotent (`IF NOT EXISTS`), and sorts after anything it depends on.

## Related

- [Plugin-Directory](Plugin-Directory) — the shipped plugins
- [Architecture](Architecture) — where plugins sit in the stack
