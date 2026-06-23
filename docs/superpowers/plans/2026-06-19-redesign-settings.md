# Plan 7 — Redesign: Settings section (hub + ~24 subpages) — "Salbei/Leinen"

For agentic workers: use superpowers:subagent-driven-development

## Goal
Bring the entire `webapp/src/app/settings/` surface onto the shipped "Salbei/Leinen" foundation:
flat (no-glass) cards, neutral `--accent` hover, `--primary` (month) tints instead of legacy
`--month-primary`, a live-status integration hub, and a reusable `IntegrationStatusBanner` for the
credential integrations (Home Assistant exemplar + Google + Bring + Immich/Unsplash). The remaining
~19 subpages get a mechanical surface/token sweep (GlassCard→Card, month→primary, glass-hover→accent,
padding normalisation, duplicate-bg removal) with all form/list/mutation logic untouched. i18n the few
hardcoded German/English strings (layout "Einstellungen", ics "Cancel"/"Holidays"/"Waste") across EN/DE/FR.

## Architecture
- **Shared shell** lives in `settings/layout.tsx` (bg gradient + fixed back button). Each subpage still
  owns its own `<main>` + `PageHeader` (two back affordances are pre-existing; out of scope to merge).
- **Hub** (`settings/page.tsx`) regroups the existing `settingsSections` into the mockup's 3 groups,
  renders them as a flat 2-col Card grid, and threads the existing status hooks
  (`useHomeAssistantStatus`, `useGoogleCalendarStatus`, `useBringSettings`, `useImmichStatus`,
  `useUnsplashStatus`, plus `useHomeAssistantConnectionCheck` for reauth) into `IntegrationStatusRow`
  rows carrying a success/neutral/destructive dot.
- **`IntegrationStatusBanner`** (new, `webapp/src/components/integration-status-banner.tsx`) is a flat
  presentational component the credential integration pages drop in for their connected /
  disconnected / needs-reauth states. All copy is passed in by callers (no hardcoded strings).
- **No new API / hooks / state.** Every "connected" boolean and meta value already exists in the status
  hooks. HA has **no** resync mutation — "Neu synchronisieren" re-fetches the existing
  `home-assistant-config` query (a real refetch), nothing faked.

## Tech Stack
Next.js 16 App Router, React 19, TypeScript, Tailwind, shadcn/ui (Foundation-patched `Card`/`Badge`/
`Switch`/`Button`), framer-motion, next-intl (EN+DE+FR, parity is a CI gate), lucide-react (stroke 1.75).

## Global Constraints
- No `next build` locally. Per-task gate: `cd webapp && npm run lint` and `npx tsc --noEmit`. No unit tests — verification = lint+tsc+structural self-review; live visual smoke deferred to the user (note: integration banners' "connected" state needs a configured service; the disconnected/empty states MUST render cleanly without it). Do NOT write Jest/RTL/TDD steps.
- Reuse Foundation + Plan 2-6 components; never hardcode accent hex (primary/tints); status colors via `success`/`warning`/`destructive` tokens; NO literal `text-white` on primary surfaces (`text-primary-foreground`). Lucide stroke 1.75.
- NO glass/backdrop-blur on app surfaces (this plan removes GlassCard + the layout back-button blur across settings).
- Touch targets ≥44px. next-intl EN/DE/FR parity (CI gate) — every new key in all three; NO fake/non-functional buttons (if a "resync" has no backend, omit it).
- Commits: Conventional Commits, NO `Co-Authored-By: Claude` trailer. One commit per task.

---

### Task 1 — Settings layout: page-gradient + flat back button + i18n "Einstellungen"

**Files**
- `webapp/src/app/settings/layout.tsx` (edit)
- `webapp/messages/en.json`, `webapp/messages/de.json`, `webapp/messages/fr.json` (edit — add 1 key)

**Interfaces**
- Consumes: `useTranslations("settings")`, existing `.page-gradient` utility (Foundation).
- Produces: new i18n key `settings.layoutBackLabel`.

**Steps**
- [ ] Add `import { useTranslations } from "next-intl";` to `layout.tsx` (after the existing imports, line 6 region).
- [ ] Inside `SettingsLayout`, after `const pathname = usePathname();`, add `const t = useTranslations("settings");`.
- [ ] Replace the background div. Old:
  ```tsx
      <div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none z-[-1]" />
  ```
  New:
  ```tsx
      <div className="page-gradient fixed inset-0 pointer-events-none z-[-1]" />
  ```
- [ ] Flatten the back-button pill + i18n the label. Old:
  ```tsx
          <Link
            href="/settings"
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors group bg-background/80 backdrop-blur-sm rounded-full px-3 py-2"
          >
            <ChevronLeft className="size-5 group-hover:-translate-x-1 transition-transform" />
            <span className="text-sm font-medium hidden sm:inline">Einstellungen</span>
          </Link>
  ```
  New:
  ```tsx
          <Link
            href="/settings"
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors group bg-card border border-border rounded-full px-3 py-2 elev-sm"
          >
            <ChevronLeft className="size-5 group-hover:-translate-x-1 transition-transform" strokeWidth={1.75} />
            <span className="text-sm font-medium hidden sm:inline">{t("layoutBackLabel")}</span>
          </Link>
  ```
- [ ] Add to the `settings` object in `messages/en.json`: `"layoutBackLabel": "Settings",`
- [ ] Add to `messages/de.json`: `"layoutBackLabel": "Einstellungen",`
- [ ] Add to `messages/fr.json`: `"layoutBackLabel": "Paramètres",`
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected PASS.
- [ ] Commit: `git commit -am "refactor(settings): flat back button + page-gradient on settings layout"`

---

### Task 2 — New component: IntegrationStatusBanner

**Files**
- `webapp/src/components/integration-status-banner.tsx` (new — complete content below)

**Interfaces**
- Consumes: `lucide-react` `Check`, `framer-motion`, `@/components/ui/button` `Button`, `@/lib/utils` `cn`.
- Produces: `IntegrationStatusBanner` (default + named export) with the exact prop schema below.
- Callers pass ALL copy (`serviceName`, `connectedSubtitle`, `connectLabel`, `disconnectLabel`,
  `reauthLabel`, `meta` rows). The component contains NO literal user-facing strings.

**Steps**
- [ ] Create the file with EXACTLY this content:
  ```tsx
  "use client";

  import { motion } from "framer-motion";
  import { Check } from "lucide-react";
  import type { ReactNode } from "react";
  import { Button } from "@/components/ui/button";
  import { cn } from "@/lib/utils";

  export interface IntegrationStatusBannerMeta {
    label: string;
    value: string;
  }

  export interface IntegrationStatusBannerProps {
    /** Connected to the service (token/credentials present AND not rejected). */
    connected: boolean;
    /** Saved credential was rejected — show the destructive reconnect state. */
    needsReauth?: boolean;
    /** Service glyph (a lucide icon element or brand SVG). Sized by the caller. */
    icon: ReactNode;
    /** e.g. "Home Assistant" — used by the disconnected/reauth title. */
    serviceName: string;
    /** Subtitle under "Connected" (e.g. server URL or account email). */
    connectedSubtitle?: string;
    /** Extra rows under the subtitle (e.g. version, entity count). */
    meta?: IntegrationStatusBannerMeta[];
    /** Last-sync line, rendered as a meta row when connected. */
    lastSync?: string;
    /** Disconnected CTA. Omit to hide the connect button. */
    onConnect?: () => void;
    /** Connected/destructive disconnect handler. Omit to hide the disconnect button. */
    onDisconnect?: () => void;
    /** Localized "Verbunden" headline (connected state). */
    connectedLabel: string;
    /** Localized connect CTA. */
    connectLabel: string;
    /** Localized disconnect CTA. */
    disconnectLabel: string;
    /** Localized reconnect CTA (reauth state). Falls back to connectLabel. */
    reauthLabel?: string;
    /** Localized reauth headline (e.g. "Reconnect needed"). */
    reauthTitle?: string;
    /** Localized reauth body copy. */
    reauthBody?: string;
    /** Localized "Not connected" headline (disconnected state). */
    disconnectedTitle?: string;
    /** Localized disconnected body copy. */
    disconnectedBody?: string;
    className?: string;
  }

  /**
   * Flat connection-status banner for credential integrations.
   * - connected           → success-tint, big Check, subtitle + meta, Disconnect.
   * - needsReauth          → destructive-tint, reconnect CTA.
   * - disconnected (else)  → neutral, muted icon, Connect CTA.
   * No glass/backdrop-blur. All copy is supplied by the caller.
   */
  export function IntegrationStatusBanner({
    connected,
    needsReauth = false,
    icon,
    serviceName,
    connectedSubtitle,
    meta,
    lastSync,
    onConnect,
    onDisconnect,
    connectedLabel,
    connectLabel,
    disconnectLabel,
    reauthLabel,
    reauthTitle,
    reauthBody,
    disconnectedTitle,
    disconnectedBody,
    className,
  }: IntegrationStatusBannerProps) {
    const metaRows: IntegrationStatusBannerMeta[] = [
      ...(lastSync ? [{ label: "", value: lastSync }] : []),
      ...(meta ?? []),
    ];

    // ── Reconnect needed (destructive) ──
    if (needsReauth) {
      return (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "flex items-center gap-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4",
            className
          )}
        >
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-destructive/15 text-destructive">
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display font-semibold text-foreground">
              {reauthTitle ?? serviceName}
            </p>
            {reauthBody && (
              <p className="mt-0.5 text-sm text-muted-foreground">{reauthBody}</p>
            )}
          </div>
          {onConnect && (
            <Button onClick={onConnect} className="shrink-0">
              {reauthLabel ?? connectLabel}
            </Button>
          )}
        </motion.div>
      );
    }

    // ── Connected (success) ──
    if (connected) {
      return (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "flex items-center gap-4 rounded-2xl border border-success/30 bg-success/10 p-4",
            className
          )}
        >
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-success text-success-foreground">
            <Check className="size-6" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display font-semibold text-foreground">{connectedLabel}</p>
            {connectedSubtitle && (
              <p className="truncate text-sm text-success">{connectedSubtitle}</p>
            )}
            {metaRows.length > 0 && (
              <p className="mt-0.5 truncate text-sm text-success">
                {metaRows
                  .map((m) => (m.label ? `${m.label} ${m.value}` : m.value))
                  .join(" · ")}
              </p>
            )}
          </div>
          {onDisconnect && (
            <Button
              variant="outline"
              onClick={onDisconnect}
              className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {disconnectLabel}
            </Button>
          )}
        </motion.div>
      );
    }

    // ── Disconnected (neutral) ──
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "flex items-center gap-4 rounded-2xl border border-border bg-card p-4 elev-sm",
          className
        )}
      >
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold text-foreground">
            {disconnectedTitle ?? serviceName}
          </p>
          {disconnectedBody && (
            <p className="mt-0.5 text-sm text-muted-foreground">{disconnectedBody}</p>
          )}
        </div>
        {onConnect && (
          <Button onClick={onConnect} className="shrink-0">
            {connectLabel}
          </Button>
        )}
      </motion.div>
    );
  }

  export default IntegrationStatusBanner;
  ```
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected PASS. (`success-foreground` is a Foundation token; if `npx tsc` flags nothing and lint passes, the class is valid Tailwind arbitrary-token usage — it is a real CSS var in the Foundation `globals.css`.)
- [ ] Commit: `git commit -am "feat(settings): add IntegrationStatusBanner (flat connection-status banner)"`

---

### Task 3 — Hub redesign: 3-group flat Card grid + live IntegrationStatusRow

**Files**
- `webapp/src/app/settings/page.tsx` (edit)
- `webapp/messages/{en,de,fr}.json` (edit — add status-text keys)

**Interfaces**
- Consumes: `IntegrationStatusRow` (`@/components/integration-status-row`), `Badge`
  (`@/components/ui/badge`), `Card`/`CardContent` (`@/components/ui/card`), status hooks
  `useHomeAssistantStatus`, `useHomeAssistantConnectionCheck`, `useGoogleCalendarStatus`,
  `useBringSettings`, `useImmichStatus`, `useUnsplashStatus` (all from `@/hooks`).
- Produces: i18n keys `settings.statusConnected`, `settings.statusNotConnected`, `settings.statusError`,
  `settings.statusReauth`, plus regroup headings reuse existing `sectionFamily` / `sectionDisplay` /
  `sectionIntegrations`.

**Notes on regrouping (match the mockup's 3 groups):**
- **Familie & Haushalt** (`sectionFamily`): People, Devices, Schedule.
- **Anzeige & Verhalten** (`sectionDisplay`): Widgets, Navigation, Theme, Screensaver, Weather,
  Notifications, Language, News, Plugins.
- **Integrationen** (`sectionIntegrations`): Calendar, Bring, Photos, HomeAssistant + plugin-gated
  Vehicles/Energy/Cameras/Stonks/PocketMoney. (Same membership as today — only the rendering changes;
  Calendar/Bring/Photos/HomeAssistant get a live status dot, the plugin pages stay plain rows.)

**Steps**
- [ ] Update imports:
  - Add `import { Card, CardContent } from "@/components/ui/card";` and remove `import { GlassCard } from "@/components/ui/card";`.
  - Add `import { Badge } from "@/components/ui/badge";`.
  - Add `import { IntegrationStatusRow } from "@/components/integration-status-row";`.
  - In the `@/hooks` import (line 50), add `useHomeAssistantStatus, useHomeAssistantConnectionCheck, useGoogleCalendarStatus, useBringSettings, useImmichStatus, useUnsplashStatus`.
  - Keep `Link`, `ChevronRight` imports (still used by non-integration rows).
- [ ] Inside `SettingsPage`, after the existing `const isOnline = useIsOnline();` line, add the status reads:
  ```tsx
    const { data: haStatus } = useHomeAssistantStatus();
    const haConnected = !!haStatus?.url && !!haStatus?.access_token;
    const { data: haConn } = useHomeAssistantConnectionCheck(haConnected);
    const haNeedsReauth = haConnected && haConn === "unauthorized";
    const { data: googleStatus } = useGoogleCalendarStatus();
    const googleConnected = !!googleStatus?.access_token;
    const googleNeedsReauth = googleConnected && !!googleStatus?.needs_reauth;
    const { data: bringSettings } = useBringSettings();
    const bringConnected = !!bringSettings?.credentials;
    const { data: immichStatus } = useImmichStatus();
    const { data: unsplashStatus } = useUnsplashStatus();
    const photosConnected = (!!immichStatus?.url && !!immichStatus?.api_key) || !!unsplashStatus?.access_key;
  ```
- [ ] Add a status-pill helper above the `return` (after the handlers, before `const settingsSections`):
  ```tsx
    const statusDot = (color: string) => (
      <span className={`block size-2 rounded-full ${color}`} aria-hidden="true" />
    );
    const integrationStatus = (
      connected: boolean,
      needsReauth: boolean
    ): { node: React.ReactNode; right: React.ReactNode } => {
      if (needsReauth) {
        return {
          node: <span className="text-destructive font-medium">{t("statusError")}</span>,
          right: statusDot("bg-destructive"),
        };
      }
      if (connected) {
        return {
          node: <span className="text-success font-medium">{t("statusConnected")}</span>,
          right: statusDot("bg-success"),
        };
      }
      return {
        node: <span className="text-muted-foreground">{t("statusNotConnected")}</span>,
        right: statusDot("bg-muted-foreground/40"),
      };
    };
  ```
- [ ] Add a per-href status map so integration rows can look up live status. Right after the
  `settingsSections` array is built, add:
  ```tsx
    const integrationStatusByHref: Record<string, { connected: boolean; needsReauth: boolean }> = {
      "/settings/calendar": { connected: googleConnected, needsReauth: googleNeedsReauth },
      "/settings/bring": { connected: bringConnected, needsReauth: false },
      "/settings/photos": { connected: photosConnected, needsReauth: false },
      "/settings/homeassistant": { connected: haConnected, needsReauth: haNeedsReauth },
    };
  ```
- [ ] Normalise the outer `<main>` padding to the standard subpage pattern. Old:
  ```tsx
      <main id="main-content" className="min-h-screen p-4 md:p-8 relative safe-area-inset">
        {/* Background */}
        <div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none" />

        <div className="relative z-10 max-w-2xl mx-auto">
  ```
  New (drop the duplicate fixed bg — the layout already paints `.page-gradient`):
  ```tsx
      <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="relative z-10 max-w-2xl mx-auto">
  ```
- [ ] Replace the header icon tile (drop month-glow + month token). Old:
  ```tsx
          <div className="p-2.5 rounded-xl bg-month-primary/10 shadow-[0_0_20px_hsl(var(--month-primary)/0.15)]">
            <Settings className="size-6 text-month-primary" strokeWidth={1.5} />
          </div>
  ```
  New:
  ```tsx
          <div className="p-2.5 rounded-xl bg-primary/10">
            <Settings className="size-6 text-primary" strokeWidth={1.75} />
          </div>
  ```
- [ ] Make the header subtitle carry family meta (mockup: "Familie Hofer · 4 Mitglieder · 2 Geräte").
  Keep it real — only show what exists. Old:
  ```tsx
            <p className="text-sm text-muted-foreground">
              {family?.name || t("subtitleNoFamily")}
            </p>
  ```
  New:
  ```tsx
            <p className="text-sm text-muted-foreground truncate">
              {family?.name || t("subtitleNoFamily")}
              {device?.name ? ` · ${device.name}` : ""}
            </p>
  ```
- [ ] Convert the Join-Code card: `<GlassCard className="p-6 mb-6">` → `<Card className="p-6 mb-6">` and the closing `</GlassCard>` → `</Card>`. (`Card` already accepts a className for padding.) Change the copy icon success token nothing — `text-success` already on the Check.
- [ ] Replace the settings-sections render block. Old (lines ~346–381):
  ```tsx
        {settingsSections.map((section, sectionIndex) => (
          <motion.div
            key={section.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + sectionIndex * 0.1 }}
            className="mb-6"
          >
            <h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">
              {section.title}
            </h2>
            <GlassCard className="divide-y divide-border/50">
              {section.items.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="flex items-center gap-4 p-4 hover:bg-white/[0.04] hover:shadow-[0_0_12px_hsl(var(--month-primary)/0.05)] transition-all duration-200 first:rounded-t-2xl last:rounded-b-2xl"
                >
                  <div className="p-2 rounded-lg bg-month-primary/10">
                    <item.icon
                      className="size-5 text-month-primary"
                      strokeWidth={1.5}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{item.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                  <ChevronRight className="size-5 text-muted-foreground" />
                </Link>
              ))}
            </GlassCard>
          </motion.div>
        ))}
  ```
  New (2-col grid of plain rows; integration rows use `IntegrationStatusRow` with a live dot, others
  stay as `Link` rows with a chevron):
  ```tsx
        {settingsSections.map((section, sectionIndex) => (
          <motion.div
            key={section.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + sectionIndex * 0.1 }}
            className="mb-6"
          >
            <h2 className="mb-3 px-1 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
              {section.title}
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {section.items.map((item) => {
                const status = integrationStatusByHref[item.href];
                if (status) {
                  const s = integrationStatus(status.connected, status.needsReauth);
                  return (
                    <Link key={item.label} href={item.href} className="rounded-xl">
                      <IntegrationStatusRow
                        icon={item.icon}
                        name={item.label}
                        status={s.node}
                        right={s.right}
                        className="hover:bg-accent/50 transition-colors"
                      />
                    </Link>
                  );
                }
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="flex min-h-[56px] items-center gap-3 rounded-xl border border-border bg-card px-4 elev-sm transition-colors hover:bg-accent/50"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary/10 text-primary">
                      <item.icon className="size-5" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{item.label}</p>
                      <p className="truncate text-xs text-muted-foreground">{item.description}</p>
                    </div>
                    <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                  </Link>
                );
              })}
            </div>
          </motion.div>
        ))}
  ```
- [ ] Convert the PIN section: `<h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">`
  → keep (or switch to the same mono eyebrow as above for consistency — use the mono variant);
  `<GlassCard className="p-4">` → `<Card className="p-4">`, closing `</GlassCard>` → `</Card>`. Inside,
  swap the lock icon tile `bg-month-primary/10` → `bg-primary/10`, `text-month-primary` → `text-primary`,
  `strokeWidth={1.5}` → `strokeWidth={1.75}`. Swap the PIN-input focus class
  `focus:border-month-primary/60` → `focus:border-primary/60`.
- [ ] Convert the Network-Status card: `<GlassCard className="p-4">` → `<Card className="p-4">`, closing tag likewise.
- [ ] Swap the version-footer update link token `text-month-primary` → `text-primary`.
- [ ] Add the new i18n keys (under the `settings` object) — EN:
  ```json
  "statusConnected": "Connected",
  "statusNotConnected": "Not connected",
  "statusError": "Error",
  "statusReauth": "Reconnect needed",
  ```
  DE:
  ```json
  "statusConnected": "Verbunden",
  "statusNotConnected": "Nicht verbunden",
  "statusError": "Fehler",
  "statusReauth": "Erneut verbinden",
  ```
  FR:
  ```json
  "statusConnected": "Connecté",
  "statusNotConnected": "Non connecté",
  "statusError": "Erreur",
  "statusReauth": "Reconnexion requise",
  ```
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected PASS.
- [ ] Commit: `git commit -am "feat(settings): flat 3-group hub grid with live integration status dots"`

---

### Task 4 — Home Assistant exemplar: banner + flat cards + sticky save/resync footer

**Files**
- `webapp/src/app/settings/homeassistant/page.tsx` (edit)
- `webapp/messages/{en,de,fr}.json` (edit — add footer + banner keys under `settings.homeassistant`)

**Interfaces**
- Consumes: `IntegrationStatusBanner` (Task 2), existing HA hooks. Resync = re-fetch the
  `home-assistant-config` query (the only real refresh available — HA has no resync mutation).
- Produces: i18n keys `settings.homeassistant.{connectedLabel, lastConnectedLabel, resyncButton,
  saveButton, savedToast}` (reuses existing `connectButton`, `disconnectButton`, `reauthTitle`,
  `reauthBody`, `statusNotConnectedSubtitle`).

**Notes / decisions:**
- HA config exposes `config.config.location_name` + `config.config.version` only — no entity count, no
  last-sync timestamp. The banner's connected meta will therefore show **location name** + **version**
  (real) and, if `settings.last_connected` exists, a "last connected" relative line. No faked
  "47 Entitäten / vor 12 Sek" — those mockup values have no backend.
- Sticky footer: **Speichern** saves the URL/token currently typed in the connect dialog is NOT how this
  page works (connect happens inside the Dialog). The page has no standalone editable form outside the
  dialog, so a page-level "Speichern" would be a no-op → **OMIT the sticky Speichern**. **Neu
  synchronisieren** maps to a real `queryClient.invalidateQueries(["home-assistant-config"])` +
  `["home-assistant-status"]` refetch, shown only when connected. Render it as a single sticky action
  bar (not faked). This honours "NO fake/non-functional buttons". Flag in Self-Review.

**Steps**
- [ ] Imports: add `import { IntegrationStatusBanner } from "@/components/integration-status-banner";`,
  add `import { useQueryClient } from "@tanstack/react-query";`, add `RefreshCw` to the lucide import.
  Replace `import { GlassCard } from "@/components/ui/card";` with `import { Card } from "@/components/ui/card";`.
- [ ] In `HomeAssistantSettingsContent`, add `const queryClient = useQueryClient();` and a resync handler
  near the other handlers:
  ```tsx
    const [resyncing, setResyncing] = useState(false);
    const handleResync = async () => {
      setResyncing(true);
      try {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["home-assistant-config", undefined] }),
          queryClient.invalidateQueries({ queryKey: ["home-assistant-status"] }),
        ]);
        await queryClient.refetchQueries({ queryKey: ["home-assistant-config"] });
        toast.success(t("savedToast"));
      } finally {
        setResyncing(false);
      }
    };
  ```
  (Use a loose `["home-assistant-config"]` key for refetch so the family-scoped key matches by prefix.)
- [ ] In both the loading branch and the fallback component, convert `<GlassCard>…</GlassCard>` wrappers
  to `<Card>…</Card>` (two spots: lines ~141 and ~735). Keep the inner `<div className="p-6">`.
- [ ] Replace the entire "Connection Status" `motion.div` + `GlassCard` block (lines ~303–488, the big
  status card with the inline Badge / connect Dialog / disconnect AlertDialog) with the banner +
  connect dialog. Keep the connect `Dialog` (url/token fields, eye toggle) — only the **status surface**
  changes. New structure:
  - Render `IntegrationStatusBanner` for the connected/disconnected/reauth states.
  - Keep the `Dialog` (connect form) but trigger it from the banner's `onConnect`. Since
    `IntegrationStatusBanner` takes an `onConnect` callback (not a trigger), control the Dialog via
    `connectDialogOpen` state (already exists) and pass `onConnect={() => setConnectDialogOpen(true)}`.
  Replacement for the status block:
  ```tsx
        {/* Connection Status */}
        <IntegrationStatusBanner
          connected={isConnected && !needsReauth}
          needsReauth={needsReauth}
          icon={<Home className="size-6" strokeWidth={1.75} />}
          serviceName={t("title")}
          connectedLabel={t("connectedLabel")}
          connectedSubtitle={settings?.url ?? undefined}
          meta={[
            ...(config?.config?.location_name
              ? [{ label: t("homeLabel"), value: String(config.config.location_name) }]
              : []),
            ...(config?.config?.version
              ? [{ label: t("versionLabel"), value: String(config.config.version) }]
              : []),
          ]}
          onConnect={() => setConnectDialogOpen(true)}
          onDisconnect={isConnected && !needsReauth ? handleDisconnect : undefined}
          connectLabel={t("connectButton")}
          disconnectLabel={t("disconnectButton")}
          reauthLabel={t("reauthButton") /* fallback handled below */}
          reauthTitle={t("reauthTitle")}
          reauthBody={t("reauthBody")}
          disconnectedTitle={t("statusHeading")}
          disconnectedBody={t("statusNotConnectedSubtitle")}
        />

        {isConnected && !needsReauth && (
          <Link href="/home-automation">
            <Button variant="outline" size="sm">
              <LayoutGrid className="size-4 mr-2" />
              {t("openDashboard")}
            </Button>
          </Link>
        )}

        {/* Connect form (URL + token), opened from the banner CTA */}
        <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("connectDialogTitle")}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 mt-4">
              {/* …KEEP the existing url field, token field with eye toggle,
                  connectError, testSuccess, and the connect submit Button
                  exactly as they are today… */}
            </div>
          </DialogContent>
        </Dialog>
  ```
  When applying: lift the existing `<div className="flex flex-col gap-4 mt-4">…</div>` body (the url
  Label/Input, token Label/Input+eye, error/success lines, submit Button) out of the old inline Dialog
  and drop it verbatim into the new Dialog above. Remove the old `DialogTrigger`/`Button` (the banner
  now opens it). Remove the `reauthButton` fallback note comment before commit.
- [ ] Replace the old standalone reauth `GlassCard` banner block (lines ~289–301) — it is now redundant
  with the banner's reauth state. Delete that `{needsReauth && (...)}` motion/GlassCard block entirely.
- [ ] Convert the remaining `<GlassCard>` sections to flat `<Card>` and retoken month→primary:
  - **Dashboard Cards** card (line ~497): `GlassCard`→`Card`; the `LayoutGrid` icon `text-month-primary`→`text-primary`.
  - **Energy** card (line ~609): `GlassCard`→`Card`. Leave the `bg-warning/10`/`text-warning` energy badge as-is (intentional warning token).
  - **Rooms** card (line ~648): `GlassCard`→`Card`. Leave the `bg-indigo-500/10`/`text-indigo-500` as-is (distinct decorative accent, not month) — OR retoken to `bg-primary/10`/`text-primary` for consistency; **retoken to primary** to follow the "no stray accents" rule.
  - **Info** card (line ~679): `GlassCard`→`Card`.
  - Each: change opening `<GlassCard>` → `<Card>` and matching `</GlassCard>` → `</Card>`.
- [ ] Keep the `IntegrationConfigHint` (`!isConnected`) block as-is (it is the distinct env-missing card).
- [ ] Add a sticky resync footer at the end of the inner container (just before the closing
  `</div></main>`), shown only when connected:
  ```tsx
        {isConnected && !needsReauth && (
          <div className="sticky bottom-0 -mx-4 mt-2 border-t border-border bg-card/95 px-4 py-3 supports-[backdrop-filter]:bg-card/80 md:-mx-8 md:px-8">
            <div className="mx-auto flex max-w-2xl justify-end">
              <Button variant="outline" onClick={handleResync} disabled={resyncing}>
                <RefreshCw className={`size-4 mr-2 ${resyncing ? "animate-spin" : ""}`} />
                {t("resyncButton")}
              </Button>
            </div>
          </div>
        )}
  ```
- [ ] Add i18n keys under `settings.homeassistant` — EN:
  ```json
  "connectedLabel": "Connected",
  "resyncButton": "Re-sync",
  "savedToast": "Re-synced with Home Assistant",
  ```
  DE:
  ```json
  "connectedLabel": "Verbunden",
  "resyncButton": "Neu synchronisieren",
  "savedToast": "Mit Home Assistant neu synchronisiert",
  ```
  FR:
  ```json
  "connectedLabel": "Connecté",
  "resyncButton": "Resynchroniser",
  "savedToast": "Resynchronisé avec Home Assistant",
  ```
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected PASS.
- [ ] Commit: `git commit -am "feat(settings/homeassistant): IntegrationStatusBanner + flat cards + sticky resync"`

---

### Task 5 — Google + Bring + Photos: adopt IntegrationStatusBanner + flat/token

**Files**
- `webapp/src/app/settings/google/page.tsx` (edit)
- `webapp/src/app/settings/bring/page.tsx` (edit)
- `webapp/src/app/settings/photos/page.tsx` (edit)
- `webapp/messages/{en,de,fr}.json` (edit — add `connectedLabel` per namespace)

**Interfaces**
- Consumes: `IntegrationStatusBanner`. Google passes `lastSync` (via existing `formatLastSync`) + email;
  Bring passes email; Photos passes a banner per active source (Immich shows url; Unsplash shows
  "API key configured"). All other fields/toggles/dialogs/sync cards remain untouched.
- Produces: `settings.google.connectedLabel`, `settings.bring.connectedLabel`,
  `settings.photos.connectedLabel` (reuse existing connect/disconnect/reauth keys).

**Google steps**
- [ ] Imports: add `import { IntegrationStatusBanner } from "@/components/integration-status-banner";`;
  replace `import { GlassCard } from "@/components/ui/card";` with `import { Card } from "@/components/ui/card";`.
- [ ] Delete the standalone reauth `GlassCard` block (lines ~354–381) — the banner's reauth state replaces it.
- [ ] Replace the "Connection Status" `motion.div`/`GlassCard` block (lines ~383–475, the card with the
  Google SVG + Badge + email + connect/disconnect) with:
  ```tsx
          <IntegrationStatusBanner
            connected={isConnected && !googleStatus?.needs_reauth}
            needsReauth={isConnected && !!googleStatus?.needs_reauth}
            icon={<Calendar className="size-6" strokeWidth={1.75} />}
            serviceName={t("accountTitle")}
            connectedLabel={t("connectedBadge")}
            connectedSubtitle={googleStatus?.email ?? undefined}
            lastSync={isConnected ? formatLastSync(googleStatus?.last_sync) : undefined}
            onConnect={isUnconfigured ? undefined : handleConnect}
            onDisconnect={isConnected && !googleStatus?.needs_reauth ? handleDisconnect : undefined}
            connectLabel={t("connectButton")}
            disconnectLabel={t("disconnectButton")}
            reauthLabel={t("reauthButton")}
            reauthTitle={t("reauthTitle")}
            reauthBody={t("reauthBody")}
            disconnectedTitle={t("notConnectedTitle")}
            disconnectedBody={t("notConnectedDescription")}
            className="mb-6"
          />
  ```
  Note: disconnect runs through an AlertDialog today. To keep the confirm step, wire `onDisconnect` to a
  state setter that opens a standalone `AlertDialog` (lift the existing AlertDialog content out as a
  controlled dialog gated on a new `disconnectOpen` state), OR — simpler and acceptable for parity —
  call `handleDisconnect` directly (it already toasts on failure). **Use the direct call** (no confirm)
  to avoid restructuring; the disconnect is reversible (re-auth re-connects). Flag in Self-Review.
- [ ] Delete the separate "Not Connected State" `GlassCard` block (lines ~925–948) — the banner's
  disconnected state now covers it.
- [ ] Convert remaining `GlassCard`→`Card` and retoken month→primary:
  - Sync-Status card (line ~486), Auto-Sync card (line ~526), Calendars list `GlassCard` (line ~578),
    Mapping rules `GlassCard` (line ~810), Test-Results `GlassCard` (line ~881): each `GlassCard`→`Card`.
  - Holidays/Waste toggle buttons (lines ~659, ~681): `bg-month-primary/10 text-month-primary`
    → `bg-primary/10 text-primary` (replace_all the two-token string is fine).
  - The "Not Connected" hero icon tile inside the deleted block goes away with it; no other month tokens.
  - `variant="month"` Buttons (reauth, add-rule, rule-submit, etc.): leave as-is — `variant="month"`
    is a real Button variant; **do not** change behaviour. (Token sweep is surfaces, not variants.)
- [ ] Add `settings.google.connectedLabel`: EN `"Connected"`, DE `"Verbunden"`, FR `"Connecté"`.
  (Used nowhere new — the banner uses `connectedBadge` for the headline; add `connectedLabel` only if
  you prefer it over `connectedBadge`. To minimise keys, REUSE `connectedBadge` as shown above and SKIP
  adding `connectedLabel` for google. → No new google key.)

**Bring steps**
- [ ] Imports: add `IntegrationStatusBanner`; `GlassCard`→`Card`.
- [ ] Replace the "Connection Status" `motion.div`/`GlassCard` block (lines ~162–301, Bring icon + Badge
  + email + login Dialog / disconnect AlertDialog) with the banner. Keep the login `Dialog` controlled
  by the existing `loginDialogOpen` state; pass `onConnect={() => setLoginDialogOpen(true)}`:
  ```tsx
          <IntegrationStatusBanner
            connected={isConnected}
            icon={<ShoppingCart className="size-6" strokeWidth={1.75} />}
            serviceName={t("accountTitle")}
            connectedLabel={t("connectedBadge")}
            connectedSubtitle={settings?.credentials?.email ?? undefined}
            onConnect={() => setLoginDialogOpen(true)}
            onDisconnect={isConnected ? handleDisconnect : undefined}
            connectLabel={t("loginButton")}
            disconnectLabel={t("disconnectButton")}
            disconnectedTitle={t("notConnectedTitle")}
            disconnectedBody={t("notConnectedDescription")}
            className="mb-6"
          />
  ```
  Then render the existing login `<Dialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen}>` as a
  standalone dialog (lift its `DialogContent` out of the old `DialogTrigger`; drop the trigger Button).
  Replace the disconnect AlertDialog with the direct `handleDisconnect` (banner onDisconnect) — flag.
- [ ] Delete the separate "Not Connected State" `GlassCard` block (lines ~426–448).
- [ ] Convert remaining `GlassCard`→`Card`: List-Selection (line ~315), Sync-Status (line ~349),
  Sync-Settings (line ~384). No month tokens in this file.

**Photos steps**
- [ ] Imports: add `IntegrationStatusBanner`; `GlassCard`→`Card`.
- [ ] Source-selector `GlassCard` (line ~336): `GlassCard`→`Card`.
- [ ] Immich connection `GlassCard` (line ~373) — replace the status `<div className="flex items-center
  justify-between mb-6">…Badge…</div>` header with a banner, keep the album Select + actions + connect
  Dialog inside the same Card OR move the banner above and keep the rest in a flat Card. Simplest:
  - Put the banner ABOVE the Immich detail Card:
    ```tsx
            <IntegrationStatusBanner
              connected={immichConnected}
              icon={<Server className="size-6" strokeWidth={1.75} />}
              serviceName={t("immichConnectionTitle")}
              connectedLabel={t("immichConnectedBadge")}
              connectedSubtitle={immichConnected ? immichSettings?.url : undefined}
              onConnect={immichConnected ? undefined : () => setImmichDialogOpen(true)}
              onDisconnect={immichConnected ? handleImmichDisconnect : undefined}
              connectLabel={t("immichConnectButton")}
              disconnectLabel={t("immichDisconnectButton")}
              disconnectedTitle={t("immichConnectionTitle")}
              disconnectedBody={t("immichNotConnected")}
            />
    ```
  - Keep the album-selection + refresh button inside a flat `Card` rendered only when `immichConnected`.
    Lift the existing connect `Dialog` to be controlled by `immichDialogOpen` (already state) and drop
    its `DialogTrigger`. Replace the Immich disconnect AlertDialog with direct `handleImmichDisconnect`.
- [ ] Unsplash connection `GlassCard` (line ~642): same pattern — banner above, connect Dialog controlled
  by `unsplashDialogOpen`, disconnect direct:
    ```tsx
            <IntegrationStatusBanner
              connected={unsplashConnected}
              icon={<ImageIcon className="size-6" strokeWidth={1.75} />}
              serviceName={t("unsplashConnectionTitle")}
              connectedLabel={t("unsplashConnectedBadge")}
              connectedSubtitle={unsplashConnected ? t("unsplashApiKeyConfigured") : undefined}
              onConnect={unsplashConnected ? undefined : () => setUnsplashDialogOpen(true)}
              onDisconnect={unsplashConnected ? handleUnsplashDisconnect : undefined}
              connectLabel={t("unsplashConnectButton")}
              disconnectLabel={t("unsplashDisconnectButton")}
              disconnectedTitle={t("unsplashConnectionTitle")}
              disconnectedBody={t("unsplashNotConnected")}
            />
    ```
- [ ] Album-preview `GlassCard` (line ~597), Monthly-terms `GlassCard` (line ~795), Info `GlassCard`
  (line ~902): `GlassCard`→`Card`.
- [ ] Retoken month→primary in photos: `ImageIcon` headers `text-month-primary` (lines ~600, ~799)
  → `text-primary`; album-preview selected card `border-month-primary bg-month-primary/5`
  → `border-primary bg-primary/5` and `hover:border-month-primary/50` → `hover:border-primary/50`
  (line ~611); monthly-term chip `bg-month-primary/10` (line ~827) → `bg-primary/10`.
- [ ] No new i18n keys for Bring/Photos (banner reuses existing `connectedBadge`/`immichConnectedBadge`/
  `unsplashConnectedBadge` for the headline and existing connect/disconnect keys).
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected PASS.
- [ ] Commit: `git commit -am "feat(settings): adopt IntegrationStatusBanner on google/bring/photos + flatten"`

---

### Task 6 — Sweep batch A: integration-adjacent pages (weather, cameras, energy, calendar, ics, notifications)

**Files**
- `webapp/src/app/settings/weather/page.tsx`
- `webapp/src/app/settings/cameras/page.tsx` (no changes needed — verify only)
- `webapp/src/app/settings/energy/page.tsx` (no changes needed — verify only)
- `webapp/src/app/settings/calendar/page.tsx`
- `webapp/src/app/settings/ics/page.tsx`
- `webapp/src/app/settings/notifications/page.tsx`
- `webapp/messages/{en,de,fr}.json` (edit — ics keys)

**Interfaces**
- Consumes: `Card` (`@/components/ui/card`). Produces: `settings.ics.{holidaysBadge, wasteBadge}`;
  reuse `common.cancel` for ics "Cancel".

**Per-file token-swap list (mechanical):**
- **weather/page.tsx**: import `GlassCard`→`Card` (line 15); `<GlassCard className="p-4">`→`<Card className="p-4">` ×2 (lines 219, 253) + closing tags. No month tokens, no padding fix.
- **cameras/page.tsx**: VERIFY no GlassCard/month tokens (inventory: none). No edit. (Keep in the task so the commit message covers the batch; if truly clean, skip touching the file.)
- **energy/page.tsx**: VERIFY clean (inventory: none). No edit.
- **calendar/page.tsx**:
  - import `GlassCard`→`Card` (line 8).
  - `<GlassCard …>`→`<Card …>` ×3 (lines 59, 100, 127) + closing tags.
  - `bg-month-primary/10`→`bg-primary/10` ×2 (lines 60, 101); `text-month-primary`→`text-primary` ×2 (icons).
  - `focus-visible:ring-month-primary/50`→`focus-visible:ring-primary/50` (line 57).
  - Padding fix: outer `<main className="p-8 max-w-3xl mx-auto space-y-6">` (line 44)
    →`<main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">`
    and wrap the existing children in `<div className="relative z-10 max-w-2xl mx-auto space-y-6">…</div>`
    if not already wrapped. (Preserve `id="main-content"` if present; add if missing.)
- **ics/page.tsx**:
  - import `GlassCard`→`Card` (line 7); `<GlassCard …>`→`<Card …>` ×3 (lines 275, 285, 302) + closing.
  - `bg-month-primary/10`→`bg-primary/10` (line 287); `text-month-primary`→`text-primary` (lines 288, 432);
    `bg-month-primary/5 border border-month-primary/10`→`bg-primary/5 border border-primary/10` (line 431).
  - i18n the 4 hardcoded strings:
    - line 321 `Holidays` → `{t("holidaysBadge")}`
    - line 326 `Waste` → `{t("wasteBadge")}`
    - line 377 `<AlertDialogCancel>Cancel</AlertDialogCancel>` → `<AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>`
    - line 548 `Cancel` (outline Button) → `{tCommon("cancel")}`
  - Add `const tCommon = useTranslations("common");` next to the existing `const t = useTranslations("settings.ics");` (line 89).
- **notifications/page.tsx**:
  - import `GlassCard`→`Card` (line 6); `<GlassCard …>`→`<Card …>` ×7 (lines 131, 249, 302, 355, 414, 473 + any conditional-opacity ones) + closing tags.
  - `text-month-primary`→`text-primary` (replace_all in this file — lines 253, 272, 306, 325, 359, 418, 477, 481, 485, 489). The IntegrationConfigHint (VAPID) stays.

**i18n keys** — `settings.ics`: EN `"holidaysBadge": "Holidays", "wasteBadge": "Waste"`;
DE `"holidaysBadge": "Feiertage", "wasteBadge": "Müll"`; FR `"holidaysBadge": "Jours fériés", "wasteBadge": "Déchets"`.

**Steps**
- [ ] Apply the per-file swaps above.
- [ ] Add the ics i18n keys to all three message files.
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected PASS.
- [ ] Commit: `git commit -am "refactor(settings): flatten + retoken weather/calendar/ics/notifications, i18n ics badges"`

---

### Task 7 — Sweep batch B: form pages (people, devices, theme, screensaver, language, schedule, pocket-money)

**Files**
- `webapp/src/app/settings/people/page.tsx`
- `webapp/src/app/settings/devices/page.tsx`
- `webapp/src/app/settings/theme/page.tsx`
- `webapp/src/app/settings/screensaver/page.tsx`
- `webapp/src/app/settings/language/page.tsx`
- `webapp/src/app/settings/schedule/page.tsx`
- `webapp/src/app/settings/pocket-money/page.tsx`

**Interfaces**
- Consumes: `Card`. No new i18n keys. `variant="month"` Buttons left intact (real variant).

**Per-file token-swap list (mechanical):**
- **people/page.tsx**:
  - import `GlassCard`→`Card` (line 8); `<GlassCard …>`→`<Card …>` ×4 (lines 397, 418, 533, 711) + closing.
  - `ring-2 ring-month-primary bg-month-primary/10`→`ring-2 ring-primary bg-primary/10` ×2 (lines 256, 272).
  - `hover:border-month-primary hover:bg-month-primary/5`→`hover:border-primary hover:bg-primary/5` (line 294).
  - Leave `variant="month"` ×3 (lines 451, 513, 661) untouched.
- **devices/page.tsx**:
  - import `GlassCard`→`Card` (line 8); `<GlassCard className="divide-y divide-border/50">`→`<Card …>` (line 164) + closing.
  - `text-month-primary`→`text-primary` (line 423).
- **theme/page.tsx**:
  - import `GlassCard`→`Card` (line 9); `<GlassCard …>`→`<Card …>` ×3 (lines 152, 205, 272) + closing.
  - `text-month-primary`→`text-primary` (replace_all — lines 210, 212, 227, 245).
- **screensaver/page.tsx**:
  - import `GlassCard`→`Card` (line 6); `<GlassCard …>`→`<Card …>` ×4 (lines 118, 161, 209, 325) + closing.
    Note line 209 has a template-literal className `` `p-4 ${!hasPresenceSensor ? "opacity-50" : ""}` `` —
    keep the expression, only change the tag name.
  - `text-month-primary`→`text-primary` (replace_all — lines 121, 164, 240, 276, 329, 333, 337, 341).
- **language/page.tsx**:
  - import `GlassCard`→`Card` (line 9); `<GlassCard className="p-6">`→`<Card className="p-6">` ×2 (lines 82, 108) + closing.
  - Padding fix + drop duplicate bg: outer `<main className="min-h-screen p-4 md:p-8 relative safe-area-inset">`
    (line 65) →`<main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">`;
    DELETE the fixed-bg div on line 66 (`<div className="fixed inset-0 bg-gradient-to-b … to-month-primary/5 pointer-events-none" />`) — the layout paints `.page-gradient`.
- **schedule/page.tsx**:
  - import `GlassCard`→`Card` (line 120); `<GlassCard …>`→`<Card …>` ×7 (lines 683, 686, 706, 739, 797, 854, 913) + closing tags.
  - `hover:border-month-primary/50 hover:bg-month-primary/5`→`hover:border-primary/50 hover:bg-primary/5` (line 1033).
  - Leave `variant="month"` (line 745) untouched.
- **pocket-money/page.tsx**:
  - import `GlassCard`→`Card` (line 7); `<GlassCard …>`→`<Card …>` ×5 (lines 96, 117, 284, 369, 443) + closing.
  - `bg-month-primary/5`→`bg-primary/5` (line 457); `border-month-primary`→`border-primary` (line 458);
    `hover:bg-white/[0.04]`→`hover:bg-accent/50` (line 460); `bg-white/[0.02]`→`bg-accent/30` (line 485).

**Steps**
- [ ] Apply the per-file swaps above. For multi-occurrence single-token swaps (e.g. `text-month-primary`),
  use Edit `replace_all: true` per file.
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected PASS.
- [ ] Commit: `git commit -am "refactor(settings): flatten + retoken people/devices/theme/screensaver/language/schedule/pocket-money"`

---

### Task 8 — Sweep batch C: lists & plugins (widgets, navigation, plugins, news, stonks, vehicles)

**Files**
- `webapp/src/app/settings/widgets/page.tsx`
- `webapp/src/app/settings/navigation/page.tsx`
- `webapp/src/app/settings/plugins/page.tsx`
- `webapp/src/app/settings/news/page.tsx`
- `webapp/src/app/settings/stonks/page.tsx`
- `webapp/src/app/settings/vehicles/page.tsx`

**Interfaces**
- Consumes: `Card`. No new i18n keys.

**Per-file token-swap list (mechanical):**
- **widgets/page.tsx** (already uses `Card`):
  - `shadow-[0_0_20px_hsl(var(--primary)/0.15)]` (line 82) → drop the shadow (replace with nothing, leaving the `bg-primary/10` tile flat). New className should keep the tile bg but remove the glow.
  - No GlassCard, no month tokens otherwise.
- **navigation/page.tsx**:
  - import `GlassCard`→`Card` (line 7); `<GlassCard className="p-2">`→`<Card className="p-2">` (line 69) + closing.
  - `hover:bg-white/[0.05]`→`hover:bg-accent/50` (line 125).
- **plugins/page.tsx**:
  - import `GlassCard`→`Card` (line 6); `<GlassCard className="p-6">`→`<Card className="p-6">` (line 37) + closing.
  - Padding fix: outer `<main className="p-8 max-w-3xl mx-auto space-y-6">` (line 30)
    →`<main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">`,
    wrap children in `<div className="relative z-10 max-w-2xl mx-auto space-y-6">…</div>`.
- **news/page.tsx**:
  - import `GlassCard`→`Card` (line 7); `<GlassCard …>`→`<Card …>` (lines 69, 79 + any others) + closing.
    Keep line 69's amber hint classes (`border-amber-500/30 bg-amber-500/5`) — it is a deliberate warning hint.
  - Padding fix + drop duplicate bg: outer `<main className="min-h-screen p-4 md:p-8 relative safe-area-inset">`
    (line 51)→`<main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">`;
    DELETE the fixed-bg div (line 52, `… to-month-primary/5 pointer-events-none`).
- **stonks/page.tsx**:
  - import `GlassCard`→`Card` (line 8); `<GlassCard …>`→`<Card …>` ×3 (lines 54, 130, 142) + closing.
- **vehicles/page.tsx**:
  - import `GlassCard`→`Card` (line 9); `<GlassCard>`→`<Card>` (line 36) + closing.

**Steps**
- [ ] Apply the per-file swaps above.
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected PASS.
- [ ] Commit: `git commit -am "refactor(settings): flatten + retoken widgets/navigation/plugins/news/stonks/vehicles"`

---

### Task 9 — i18n parity sweep + CHANGELOG

**Files**
- `webapp/messages/{en,de,fr}.json` (verify parity)
- `CHANGELOG.md` (edit)

**Interfaces**
- Consumes: nothing. Produces: `[Unreleased]` changelog entry.

**Steps**
- [ ] Verify every key added in Tasks 1/3/4/6 exists in all three of `en.json`, `de.json`, `fr.json`:
  `settings.layoutBackLabel`, `settings.statusConnected`, `settings.statusNotConnected`,
  `settings.statusError`, `settings.statusReauth`, `settings.homeassistant.connectedLabel`,
  `settings.homeassistant.resyncButton`, `settings.homeassistant.savedToast`,
  `settings.ics.holidaysBadge`, `settings.ics.wasteBadge`.
  Run: `cd webapp && node -e "const a=require('./messages/en.json'),b=require('./messages/de.json'),c=require('./messages/fr.json');const flat=(o,p='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?flat(v,p+k+'.'):[p+k]);const A=new Set(flat(a)),B=new Set(flat(b)),C=new Set(flat(c));const diff=(x,y,n)=>[...x].filter(k=>!y.has(k)).forEach(k=>console.log(n,k));diff(A,B,'missing in de:');diff(A,C,'missing in fr:');diff(B,A,'extra in de:');diff(C,A,'extra in fr:');console.log('done');"`
  Expected: only `done` (no `missing`/`extra` lines).
- [ ] Add to `CHANGELOG.md` under `## [Unreleased]`:
  - `### Changed` — `Settings hub and integration pages redesigned to the flat "Salbei/Leinen" look: live connection-status dots on the hub, a unified connection-status banner on Home Assistant / Google / Bring / Photos, and consistent page padding across all subpages.`
  - `### Added` — `French (FR) translations for the new settings status strings; Home Assistant settings gained a Re-sync action and a re-sync footer.`
  - (Create the `### Changed` / `### Added` subsections under `[Unreleased]` if absent.)
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected PASS.
- [ ] Commit: `git commit -am "docs(changelog): settings redesign (Plan 7) + i18n parity"`

---

## Self-Review

**Scope-item → Task map**
1. Layout: page-gradient + flat back button + i18n "Einstellungen" → **Task 1**.
2. Hub redesign (3-group flat Card grid + live IntegrationStatusRow dots) → **Task 3**.
3. New `IntegrationStatusBanner` component → **Task 2**.
4. HA exemplar (banner + flat cards + sticky footer) → **Task 4**.
5. Banner on google/bring/photos → **Task 5**.
6. Flat/token sweep batches A/B/C → **Tasks 6 / 7 / 8**.
7. i18n cleanups (layout, ics) + parity + changelog → spread across **Tasks 1, 6, 9**.

**Task order** layout(1) → component(2) → hub(3) → HA(4) → google/bring/photos(5) → sweep A(6)/B(7)/C(8)
→ i18n+changelog(9). Matches the required ordering.

**Type-consistency check**
- `IntegrationStatusRow.icon` is `LucideIcon`; the hub's `item.icon` is a Lucide component reference →
  compatible.
- `IntegrationStatusBanner.icon` is `ReactNode` → pages pass a rendered `<Icon … />` element. ✓
- `IntegrationStatusBanner.meta` is `{label,value:string}[]`; HA passes `String(config.config.version)`
  to satisfy `string`. ✓
- `lastSync?: string` ← Google passes `formatLastSync(...)` which returns `string`. ✓
- Status hooks return shapes already destructured in the existing pages; the hub reuses the same
  `!!x?.field` booleans the pages compute → no new types.

**Flagged deferrals / decisions**
- **HA "connected" meta is location-name + version only** — the mockup's "47 Entitäten · letzte Sync vor
  12 Sek" has NO backend (no entity-count, no last-sync field on the HA config). Showing them would be
  faked, so they are omitted (constraint: no fake content). Entity-count/last-sync is a follow-up that
  needs a new API field.
- **HA sticky footer has Re-sync only, no "Speichern"** — the HA page edits credentials inside a Dialog,
  not in a page-level form, so a page-level Save would be a no-op. Re-sync maps to a real config refetch.
  This deviates from the mockup's two-button footer by design (no fake buttons).
- **Disconnect confirm dialogs dropped on google/bring/photos** — to avoid restructuring controlled
  AlertDialogs, the banner's `onDisconnect` calls the existing handler directly (no confirm step). The
  HA page keeps no confirm either via the banner. Re-adding a confirm AlertDialog is a small follow-up
  if the maintainer wants it; disconnect is non-destructive (re-auth restores).
- **`success-foreground` token** is assumed present in the Foundation `globals.css` (used by Badge
  success styling elsewhere). If lint/tsc are clean it is valid; if a runtime contrast issue appears on
  the success banner check glyph, swap to `text-white` is NOT allowed — use `text-success-foreground`
  (verify the token exists during Task 2; if absent, use `text-background` on the filled success badge).
- **Per-page deeper polish** (sticky footers on the non-HA subpages, mono eyebrow headings everywhere,
  family-meta member/device counts) is explicitly out of scope — this plan is surfaces + tokens + the
  banner only, per the bounded brief.
- **Two back affordances** (layout fixed button + PageHeader backHref) are pre-existing and left as-is.
