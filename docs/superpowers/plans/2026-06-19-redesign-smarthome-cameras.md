# Plan 12 — Redesign „Salbei/Leinen": Smart Home & Cameras

For agentic workers: use superpowers:subagent-driven-development.

## Goal
Apply the „Salbei/Leinen" redesign to the Smart Home (`/home-automation`) and Cameras (`/cameras`) surfaces. Flatten all glass/backdrop-blur to theme-following `bg-card`/token tints, swap every `month-primary` accent to `primary`, restyle the dashboard selector pills to the room-tab look (active = `bg-primary text-primary-foreground`), give the light-ON icon badge a subtle static glow in its `iconColor`, and turn the camera tiles into live tiles (name overlay over video, a "LIVE" pill with a red dot, a static scanline overlay, and a styled offline tile). No control logic, navigation, or data model changes.

This surface is **dashboard-based, not room-based** — the existing `DashboardSelector` (a horizontal pill list of user dashboards) stays the navigation model; the mockup's "room tabs" map visually to those pills. Scene-type cards render the **user's actual HA scene entities** — no hardcoded "Gute Nacht"/"Alles aus" names.

## Architecture
- **Smart Home page** (`home-automation/page.tsx`): `.page-gradient` + `PageHeader` + `DashboardSelector` + status-badge row + entity grid of `<EntityCard>`. Three connection-gate branches (loading / not-connected / no-dashboards) plus empty/energy-redirect states currently use `GlassCard`. The grid maps `dashboardCards` (sorted by `position`) → `<EntityCard card entity isLoading>`.
- **EntityCard dispatcher** (`home-assistant/entity-card.tsx`): renders loading skeleton + unavailable-entity tile (both glass today), then routes `card.card_type` → one of ~14 `cards/*.tsx`.
- **Card files** (`home-assistant/cards/*.tsx`): each owns its own control logic (sliders, steppers, service-call hooks) — KEEP intact. We only restyle containers/badges/accents.
- **FAB** (`floating-lights-fab.tsx`) + **LightControlItem** (`light-control-item.tsx`): the Sheet-based room lights panel; `month-primary` accents + FAB glow.
- **Cameras**: `cameras/page.tsx` → `Go2rtcCard` driver (`plugins/cameras/drivers/go2rtc.tsx`) → `<CameraGrid>`/`<CameraViewer>` (`camera-viewer.tsx`). The HA `camera-card.tsx` (camera entity inside a dashboard) is also in scope for flattening.
- **Shared util**: extract the duplicated `getColorTempColor()` into `lib/ha-color.ts`.

## Tech Stack
Next.js 16 (App Router), React 19, Tailwind, shadcn/ui (`Card`/`CardContent`, `Switch`, `Slider`, `Badge`, `Button`), framer-motion, lucide-react (stroke 1.75), next-intl (EN/DE/FR parity is a CI gate).

Verified primitives:
- `Badge` variants: `default | secondary | destructive | outline | success | warning | error | neutral`. `success`/`warning`/`error`/`neutral` are already `rounded-full`.
- `card.tsx` exports `Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, GlassCard`. `Card` = flat `rounded-2xl border bg-card elev-md`.
- `getColorTempColor(kelvin, minK, maxK)` is byte-identical in `light-card.tsx` (lines 18-41) and `light-control-item.tsx` (lines 18-41).

## Global Constraints
- No `next build` locally. Per-task gate: `cd webapp && npm run lint` and `npx tsc --noEmit`. No unit tests — verification = lint+tsc+structural self-review; live smoke needs a configured HA / cameras (deferred) — the not-connected/empty/offline states MUST render cleanly without HA. Do NOT write Jest/RTL/TDD steps.
- Reuse Foundation + Plan 2-11 components; never hardcode the month accent hex (use primary/tints); semantic/functional entity-state colors (light yellow, heat orange, cool blue, media green) + per-device colors may stay as documented inline tints; NO literal text-white except over video/photos/colored fills (camera overlays + glowing icon are over media/color — OK). Lucide stroke 1.75. Sensor values `tabular-nums`.
- NO glass/backdrop-blur on app surfaces (removes GlassCard + the `bg-white/[0.0x] backdrop-blur-sm` from entity cards + dispatcher). Theme-following (NOT dark-forced). NO fake features (scenes are the user's real HA scenes; LIVE pill reflects an actually-streaming camera). Scanline + glow are STATIC (no animation; ARM-GPU + reduced-motion safe).
- Touch targets ≥44px. next-intl EN/DE/FR parity (CI gate).
- Commits: Conventional Commits, NO `Co-Authored-By: Claude` trailer. One commit per task.

---

### Task 1 — Extract `getColorTempColor` util; flatten + token light/climate/cover/media cards

**Files**
- `webapp/src/lib/ha-color.ts` (NEW)
- `webapp/src/components/home-assistant/cards/light-card.tsx` (EDIT)
- `webapp/src/components/light-control-item.tsx` (EDIT — import only; full restyle in Task 4)
- `webapp/src/components/home-assistant/cards/climate-card.tsx` (EDIT)
- `webapp/src/components/home-assistant/cards/cover-card.tsx` (EDIT)
- `webapp/src/components/home-assistant/cards/media-player-card.tsx` (EDIT)

**Interfaces**
- Produces: `getColorTempColor(kelvin: number, minK: number, maxK: number): string` exported from `lib/ha-color.ts`.
- Consumes: `light-card.tsx` and `light-control-item.tsx` import it; the local copies are deleted.

Steps:

- [ ] Create `webapp/src/lib/ha-color.ts` with the COMPLETE util (lifted verbatim from `light-card.tsx` lines 18-41):
```ts
// Calculate a CSS color from a light's color temperature in Kelvin.
// Warm (2700K) #FF9F43 → neutral (4000K) #FFEAA7 → cool (6500K) #74B9FF.
export function getColorTempColor(kelvin: number, minK: number, maxK: number): string {
  const normalized = Math.max(0, Math.min(1, (kelvin - minK) / (maxK - minK)));

  if (normalized < 0.5) {
    const t = normalized * 2;
    const r = Math.round(255);
    const g = Math.round(159 + (234 - 159) * t);
    const b = Math.round(67 + (167 - 67) * t);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const t = (normalized - 0.5) * 2;
    const r = Math.round(255 - (255 - 116) * t);
    const g = Math.round(234 - (234 - 185) * t);
    const b = Math.round(167 + (255 - 167) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }
}
```

- [ ] **light-card.tsx** — delete the local `getColorTempColor` (lines 16-41, the comment block through the closing brace) and add the import after the `Slider` import. Replace:
```tsx
import { Slider } from "@/components/ui/slider";
import { useLightControl } from "@/hooks";
```
with:
```tsx
import { Slider } from "@/components/ui/slider";
import { getColorTempColor } from "@/lib/ha-color";
import { useLightControl } from "@/hooks";
```
Then delete the entire local function block (the `// Calculate color…` comment through line 41's `}`), leaving `interface LightCardProps { … }` directly above `export function LightCard`.

- [ ] **light-card.tsx** — flatten the container + glow the icon badge. Replace the root `<div role="button" …>` className/style block (lines 127-132):
```tsx
        className={`rounded-xl border border-white/[0.08] backdrop-blur-sm p-4 transition-all cursor-pointer ${
          isOn
            ? "border-yellow-500/30"
            : "bg-white/[0.03] hover:border-month-primary/30 hover:bg-white/[0.05]"
        } ${isUnavailable ? "opacity-50" : ""}`}
        style={isOn && iconColor ? { backgroundColor: `${iconColor}15` } : undefined}
```
with:
```tsx
        className={`rounded-2xl border bg-card elev-sm p-4 transition-all cursor-pointer ${
          isOn
            ? "border-yellow-500/30"
            : "border-border hover:border-primary/30"
        } ${isUnavailable ? "opacity-50" : ""}`}
        style={isOn && iconColor ? { backgroundColor: `${iconColor}15` } : undefined}
```

- [ ] **light-card.tsx** — add the static glow to the toggle button (the light-ON icon badge). Replace the toggle `<button>` open tag block (lines 143-150):
```tsx
            <button
              onClick={handleToggle}
              disabled={isPending || isUnavailable}
              className={`p-2 rounded-lg transition-colors ${
                isOn ? "bg-yellow-500/20" : "bg-muted text-muted-foreground"
              } hover:bg-yellow-500/30 disabled:opacity-50`}
              style={isOn && iconColor ? { color: iconColor } : undefined}
            >
```
with:
```tsx
            <button
              onClick={handleToggle}
              disabled={isPending || isUnavailable}
              className={`p-2 rounded-lg transition-colors ${
                isOn ? "bg-yellow-500/20 icon-badge" : "bg-muted text-muted-foreground"
              } hover:bg-yellow-500/30 disabled:opacity-50`}
              style={
                isOn && iconColor
                  ? { color: iconColor, boxShadow: `0 0 16px ${iconColor}66` }
                  : undefined
              }
            >
```
(The `0 0 16px <iconColor>66` is the subtle static glow — `66` ≈ 40% alpha; no animation.)

- [ ] **light-control-item.tsx** — delete the local `getColorTempColor` (lines 16-41) and import the shared util. Replace:
```tsx
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useLightControl } from "@/hooks";
```
with:
```tsx
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { getColorTempColor } from "@/lib/ha-color";
import { useLightControl } from "@/hooks";
```
Then delete the entire local function block (comment line 16 through line 41's `}`), leaving `interface LightControlItemProps` directly above. (Container restyle stays for Task 4.)

- [ ] **climate-card.tsx** — token-swap the only `month-primary` reference. Replace (line 63):
```tsx
          : "bg-card hover:border-month-primary/30"
```
with:
```tsx
          : "bg-card hover:border-primary/30"
```
Also upgrade the root container radius/elevation: replace (line 57-58):
```tsx
    <div
      className={`rounded-xl border p-4 transition-all ${
```
with:
```tsx
    <div
      className={`rounded-2xl border bg-card elev-sm p-4 transition-all ${
```
(The `bg-card` in the neutral branch is now redundant but harmless; the heating/cooling branches override it with their tint. Leave the conditional tints — orange=heat, blue=cool — as documented functional colors.)

- [ ] **cover-card.tsx** — same two swaps. Replace (line 72-73):
```tsx
    <div
      className={`rounded-xl border p-4 transition-all ${
```
with:
```tsx
    <div
      className={`rounded-2xl border bg-card elev-sm p-4 transition-all ${
```
and (line 77):
```tsx
          : "bg-card hover:border-month-primary/30"
```
with:
```tsx
          : "bg-card hover:border-primary/30"
```

- [ ] **media-player-card.tsx** — same two swaps. Replace (line 98-99):
```tsx
    <div
      className={`rounded-xl border p-4 transition-all ${
```
with:
```tsx
    <div
      className={`rounded-2xl border bg-card elev-sm p-4 transition-all ${
```
and (line 104):
```tsx
          : "bg-card hover:border-month-primary/30"
```
with:
```tsx
          : "bg-card hover:border-primary/30"
```

- [ ] Run gate:
```
cd webapp && npm run lint && npx tsc --noEmit
```
Expected: PASS.

- [ ] Commit:
```
refactor(homeautomation): extract ha-color util; flatten light/climate/cover/media cards to bg-card tokens + static light glow
```

---

### Task 2 — Flatten + token sensor/switch/scene/lock/fan/vacuum/alarm cards

**Files**
- `webapp/src/components/home-assistant/cards/sensor-card.tsx` (EDIT)
- `webapp/src/components/home-assistant/cards/switch-card.tsx` (EDIT)
- `webapp/src/components/home-assistant/cards/scene-card.tsx` (EDIT)
- `webapp/src/components/home-assistant/cards/lock-card.tsx` (EDIT)
- `webapp/src/components/home-assistant/cards/fan-card.tsx` (EDIT)
- `webapp/src/components/home-assistant/cards/vacuum-card.tsx` (EDIT)
- `webapp/src/components/home-assistant/cards/alarm-card.tsx` (EDIT)

**Interfaces**
- Consumes/Produces: no API change. Each file keeps its hooks + control logic; only classNames change.

Steps:

- [ ] **sensor-card.tsx** — token-swap the default device-class color. Replace (lines 82-83 inside `getSensorColor`):
```tsx
    default:
      return "text-month-primary";
```
with:
```tsx
    default:
      return "text-primary";
```

- [ ] **sensor-card.tsx** — flatten root container + icon badge. Replace (line 123):
```tsx
        className="rounded-xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm p-4 hover:border-month-primary/30 hover:bg-white/[0.05] transition-all cursor-pointer"
```
with:
```tsx
        className="rounded-2xl border border-border bg-card elev-sm p-4 hover:border-primary/30 transition-all cursor-pointer"
```
and replace the icon-badge wrapper (line 127):
```tsx
          <div className={`p-2.5 rounded-xl bg-white/[0.06] ${colorClass}`}>
```
with:
```tsx
          <div className={`p-2.5 rounded-xl bg-muted ${colorClass}`}>
```

- [ ] **switch-card.tsx** — flatten root container. Replace (lines 33-38):
```tsx
        className={`rounded-xl border border-white/[0.08] backdrop-blur-sm p-4 transition-all cursor-pointer ${
          isOn
            ? "bg-green-500/10 border-green-500/30"
            : "bg-white/[0.03] hover:border-month-primary/30 hover:bg-white/[0.05]"
        } ${isUnavailable ? "opacity-50" : ""}`}
```
with:
```tsx
        className={`rounded-2xl border bg-card elev-sm p-4 transition-all cursor-pointer ${
          isOn
            ? "bg-green-500/10 border-green-500/30"
            : "border-border hover:border-primary/30"
        } ${isUnavailable ? "opacity-50" : ""}`}
```
and flatten the icon badge (lines 43-47):
```tsx
            <div
              className={`p-2.5 rounded-xl transition-colors ${
                isOn ? "bg-green-500/20 text-green-500" : "bg-white/[0.06] text-muted-foreground"
              }`}
            >
```
with:
```tsx
            <div
              className={`p-2.5 rounded-xl transition-colors ${
                isOn ? "bg-green-500/20 text-green-500" : "bg-muted text-muted-foreground"
              }`}
            >
```
(The `<Switch>` top-right is already the standardized toggle — keep.)

- [ ] **scene-card.tsx** — token-swap the hover accent. Replace (lines 42-45):
```tsx
    <div
      className={`rounded-xl border p-4 transition-all bg-card hover:border-month-primary/30 ${
        isUnavailable ? "opacity-50" : ""
      }`}
    >
```
with:
```tsx
    <div
      className={`rounded-2xl border bg-card elev-sm p-4 transition-all hover:border-primary/30 ${
        isUnavailable ? "opacity-50" : ""
      }`}
    >
```
(Keep the purple icon badge as the scene's functional accent and the full-width activate `Button`.)

- [ ] **lock-card.tsx** — token-swap the neutral branch in `getBgColor` (line 56) and upgrade the root radius. Replace (line 56):
```tsx
    return "bg-card hover:border-month-primary/30";
```
with:
```tsx
    return "bg-card hover:border-primary/30";
```
and replace the root `<div>` (lines 70-71):
```tsx
    <div
      className={`rounded-xl border p-4 transition-all ${getBgColor()} ${
```
with:
```tsx
    <div
      className={`rounded-2xl border elev-sm p-4 transition-all ${getBgColor()} ${
```

- [ ] **fan-card.tsx** — token-swap + upgrade root. Replace (lines 48-49):
```tsx
    <div
      className={`rounded-xl border p-4 transition-all ${
```
with:
```tsx
    <div
      className={`rounded-2xl border bg-card elev-sm p-4 transition-all ${
```
and (line 52):
```tsx
          : "bg-card hover:border-month-primary/30"
```
with:
```tsx
          : "bg-card hover:border-primary/30"
```
(Keep the cyan on-state tint and the `animate-spin` on the running fan icon — that is a functional rotation tied to actual fan state, slow 2s, acceptable.)

- [ ] **vacuum-card.tsx** — flatten root + icon badge. Replace (lines 115-120):
```tsx
      className={`rounded-xl border border-white/[0.08] p-4 transition-all backdrop-blur-sm ${
        isCleaning
          ? "bg-green-500/10 border-green-500/30"
          : "bg-white/[0.03] hover:border-month-primary/30 hover:bg-white/[0.05]"
      } ${isUnavailable ? "opacity-50" : ""}`}
```
with:
```tsx
      className={`rounded-2xl border bg-card elev-sm p-4 transition-all ${
        isCleaning
          ? "bg-green-500/10 border-green-500/30"
          : "border-border hover:border-primary/30"
      } ${isUnavailable ? "opacity-50" : ""}`}
```
and the icon badge (lines 124-128):
```tsx
        <div
          className={`p-2.5 rounded-xl ${
            isCleaning ? "bg-green-500/20 text-green-500" : "bg-white/[0.06] text-muted-foreground"
          }`}
        >
```
with:
```tsx
        <div
          className={`p-2.5 rounded-xl ${
            isCleaning ? "bg-green-500/20 text-green-500" : "bg-muted text-muted-foreground"
          }`}
        >
```

- [ ] **alarm-card.tsx** — token-swap the neutral branch in `getBgColor` (line 61) + upgrade root. Replace (line 61):
```tsx
    return "bg-card hover:border-month-primary/30";
```
with:
```tsx
    return "bg-card hover:border-primary/30";
```
and replace the root `<div>` (lines 91-92):
```tsx
    <div
      className={`rounded-xl border p-4 transition-all ${getBgColor()} ${
```
with:
```tsx
    <div
      className={`rounded-2xl border elev-sm p-4 transition-all ${getBgColor()} ${
```

- [ ] Run gate:
```
cd webapp && npm run lint && npx tsc --noEmit
```
Expected: PASS.

- [ ] Commit:
```
style(homeautomation): flatten sensor/switch/scene/lock/fan/vacuum/alarm cards to bg-card tokens, month-primary→primary
```

---

### Task 3 — Flatten + token person/weather/generic cards + the EntityCard dispatcher

**Files**
- `webapp/src/components/home-assistant/cards/person-card.tsx` (EDIT)
- `webapp/src/components/home-assistant/cards/weather-card.tsx` (EDIT)
- `webapp/src/components/home-assistant/cards/generic-card.tsx` (EDIT)
- `webapp/src/components/home-assistant/entity-card.tsx` (EDIT)

**Interfaces**
- Consumes/Produces: no API change. Class-only edits.

Steps:

- [ ] **person-card.tsx** — token-swap the neutral branch in `getBgColor` (line 60) + upgrade root. Replace (line 60):
```tsx
    if (isUnknown) return "bg-card hover:border-month-primary/30";
```
with:
```tsx
    if (isUnknown) return "bg-card hover:border-primary/30";
```
and replace the root `<div>` (lines 65-66):
```tsx
    <div
      className={`rounded-xl border p-4 transition-all ${getBgColor()} ${
```
with:
```tsx
    <div
      className={`rounded-2xl border elev-sm p-4 transition-all ${getBgColor()} ${
```

- [ ] **weather-card.tsx** — token-swap + upgrade root. Replace (lines 94-95):
```tsx
    <div
      className={`rounded-xl border p-4 transition-all bg-card hover:border-month-primary/30 ${
```
with:
```tsx
    <div
      className={`rounded-2xl border bg-card elev-sm p-4 transition-all hover:border-primary/30 ${
```
(Keep the functional condition icon colors — yellow=sun, blue=rain, cyan=snow.)

- [ ] **generic-card.tsx** — flatten root + icon badge + token the on-state tint. Replace (lines 65-69):
```tsx
        className={`rounded-xl border border-white/[0.08] backdrop-blur-sm p-4 transition-all cursor-pointer ${
          supportsToggle && isOn
            ? "bg-month-primary/10 border-month-primary/30"
            : "bg-white/[0.03] hover:border-month-primary/30 hover:bg-white/[0.05]"
        } ${isUnavailable ? "opacity-50" : ""}`}
```
with:
```tsx
        className={`rounded-2xl border bg-card elev-sm p-4 transition-all cursor-pointer ${
          supportsToggle && isOn
            ? "bg-primary/10 border-primary/30"
            : "border-border hover:border-primary/30"
        } ${isUnavailable ? "opacity-50" : ""}`}
```
and the icon badge (lines 73-79):
```tsx
          <div
            className={`p-2.5 rounded-xl ${
              supportsToggle && isOn
                ? "bg-month-primary/20 text-month-primary"
                : "bg-white/[0.06] text-muted-foreground"
            }`}
          >
```
with:
```tsx
          <div
            className={`p-2.5 rounded-xl ${
              supportsToggle && isOn
                ? "bg-primary/20 text-primary"
                : "bg-muted text-muted-foreground"
            }`}
          >
```

- [ ] **entity-card.tsx** — flatten the loading skeleton tile. Replace (line 34):
```tsx
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm p-4">
```
with:
```tsx
      <div className="rounded-2xl border border-border bg-card elev-sm p-4">
```

- [ ] **entity-card.tsx** — flatten the unavailable-entity tile. Replace (line 47):
```tsx
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm p-4 opacity-60">
```
with:
```tsx
      <div className="rounded-2xl border border-border bg-card elev-sm p-4 opacity-60">
```
(Keep the destructive icon-badge tint + the unavailable label.)

- [ ] Run gate:
```
cd webapp && npm run lint && npx tsc --noEmit
```
Expected: PASS.

- [ ] Commit:
```
style(homeautomation): flatten person/weather/generic cards + EntityCard dispatcher to bg-card tokens
```

---

### Task 4 — Home-automation page (GlassCard→Card, status badges, primary accents) + DashboardSelector pills + scenes section + FAB/LightControlItem

**Files**
- `webapp/src/app/home-automation/page.tsx` (EDIT)
- `webapp/src/components/home-assistant/dashboard-selector.tsx` (EDIT)
- `webapp/src/components/floating-lights-fab.tsx` (EDIT)
- `webapp/src/components/light-control-item.tsx` (EDIT)

**Interfaces**
- Consumes: `Card`, `CardContent` from `@/components/ui/card`; `dashboardCards` (already in scope) filtered by `card_type === "scene"` for the scenes section; new i18n key `homeAutomation.scenesHeading` (added in Task 6).
- Produces: no API change to `DashboardSelector` props.

Steps:

- [ ] **page.tsx** — swap the import. Replace (line 22):
```tsx
import { GlassCard } from "@/components/ui/card";
```
with:
```tsx
import { Card, CardContent } from "@/components/ui/card";
```

- [ ] **page.tsx** — token the two header icon badges in the loading + not-connected branches. There are two occurrences of:
```tsx
            <div className="p-2.5 rounded-xl bg-month-primary/10 shrink-0">
              <Home className="size-6 text-month-primary" strokeWidth={1.5} />
            </div>
```
(loading branch ~line 128, not-connected branch ~line 171) and a third in the no-dashboards branch (~line 212). Replace ALL three occurrences with:
```tsx
            <div className="p-2.5 rounded-xl bg-primary/10 shrink-0">
              <Home className="size-6 text-primary" strokeWidth={1.5} />
            </div>
```
(Use `replace_all` is not safe because the surrounding indentation differs across branches; apply each match individually by including the unique enclosing className context if needed.)

- [ ] **page.tsx** — flatten the loading skeleton card. Replace (lines 143-153):
```tsx
              <GlassCard key={i} className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <Skeleton className="size-10 rounded-xl" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-24 mb-1" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
                <Skeleton className="h-8 w-full rounded-lg" />
              </GlassCard>
```
with:
```tsx
              <Card key={i} className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <Skeleton className="size-10 rounded-xl" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-24 mb-1" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
                <Skeleton className="h-8 w-full rounded-lg" />
              </Card>
```

- [ ] **page.tsx** — flatten the not-connected gate card. Replace (lines 180-194):
```tsx
          <GlassCard>
            <div className="p-8 text-center">
              <Home className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h2 className="text-lg font-medium mb-2">{t("notConnectedTitle")}</h2>
              <p className="text-muted-foreground mb-6">
                {t("notConnectedDescription")}
              </p>
              <Link href="/settings/homeassistant">
                <Button>
                  <Settings className="size-4 mr-2" />
                  {t("notConnectedAction")}
                </Button>
              </Link>
            </div>
          </GlassCard>
```
with:
```tsx
          <Card>
            <CardContent className="p-8 text-center">
              <Home className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h2 className="text-lg font-medium mb-2">{t("notConnectedTitle")}</h2>
              <p className="text-muted-foreground mb-6">
                {t("notConnectedDescription")}
              </p>
              <Link href="/settings/homeassistant">
                <Button>
                  <Settings className="size-4 mr-2" />
                  {t("notConnectedAction")}
                </Button>
              </Link>
            </CardContent>
          </Card>
```

- [ ] **page.tsx** — flatten the no-dashboards gate card. Replace (lines 227-246):
```tsx
          <GlassCard>
            <div className="p-8 text-center">
              <LayoutGrid className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h2 className="text-lg font-medium mb-2">{t("noDashboardsTitle")}</h2>
              <p className="text-muted-foreground mb-6">
                {t("noDashboardsDescription")}
              </p>
              <Button
                onClick={() => handleCreateDashboard(t("defaultDashboardName"), "home", "custom")}
                disabled={createDashboard.isPending}
              >
                {createDashboard.isPending ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="size-4 mr-2" />
                )}
                {t("noDashboardsAction")}
              </Button>
            </div>
          </GlassCard>
```
with:
```tsx
          <Card>
            <CardContent className="p-8 text-center">
              <LayoutGrid className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h2 className="text-lg font-medium mb-2">{t("noDashboardsTitle")}</h2>
              <p className="text-muted-foreground mb-6">
                {t("noDashboardsDescription")}
              </p>
              <Button
                onClick={() => handleCreateDashboard(t("defaultDashboardName"), "home", "custom")}
                disabled={createDashboard.isPending}
              >
                {createDashboard.isPending ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="size-4 mr-2" />
                )}
                {t("noDashboardsAction")}
              </Button>
            </CardContent>
          </Card>
```

- [ ] **page.tsx** — flatten the empty-dashboard gate card. Replace (lines 301-315):
```tsx
          <GlassCard>
            <div className="p-8 text-center">
              <LayoutGrid className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h2 className="text-lg font-medium mb-2">{t("emptyDashboardTitle")}</h2>
              <p className="text-muted-foreground mb-6">
                {t("emptyDashboardDescription")}
              </p>
              <Link href={`/settings/homeassistant?dashboard=${activeDashboardId}`}>
                <Button>
                  <Plus className="size-4 mr-2" />
                  {t("emptyDashboardAction")}
                </Button>
              </Link>
            </div>
          </GlassCard>
```
with:
```tsx
          <Card>
            <CardContent className="p-8 text-center">
              <LayoutGrid className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h2 className="text-lg font-medium mb-2">{t("emptyDashboardTitle")}</h2>
              <p className="text-muted-foreground mb-6">
                {t("emptyDashboardDescription")}
              </p>
              <Link href={`/settings/homeassistant?dashboard=${activeDashboardId}`}>
                <Button>
                  <Plus className="size-4 mr-2" />
                  {t("emptyDashboardAction")}
                </Button>
              </Link>
            </CardContent>
          </Card>
```

- [ ] **page.tsx** — flatten the energy-redirect gate card. Replace (lines 320-342):
```tsx
          <GlassCard>
            <div className="p-8 text-center">
              <Home className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h2 className="text-lg font-medium mb-2">{t("energyRedirectTitle")}</h2>
              <p className="text-muted-foreground mb-6">
                {t("energyRedirectDescription")}
              </p>
              <div className="flex items-center justify-center gap-3">
                <Link href="/energy">
                  <Button>
                    <Zap className="size-4 mr-2" />
                    {t("energyRedirectAction")}
                  </Button>
                </Link>
                <Link href="/settings/homeassistant/energy">
                  <Button variant="outline">
                    <Settings className="size-4 mr-2" />
                    {t("energyConfigure")}
                  </Button>
                </Link>
              </div>
            </div>
          </GlassCard>
```
with:
```tsx
          <Card>
            <CardContent className="p-8 text-center">
              <Home className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h2 className="text-lg font-medium mb-2">{t("energyRedirectTitle")}</h2>
              <p className="text-muted-foreground mb-6">
                {t("energyRedirectDescription")}
              </p>
              <div className="flex items-center justify-center gap-3">
                <Link href="/energy">
                  <Button>
                    <Zap className="size-4 mr-2" />
                    {t("energyRedirectAction")}
                  </Button>
                </Link>
                <Link href="/settings/homeassistant/energy">
                  <Button variant="outline">
                    <Settings className="size-4 mr-2" />
                    {t("energyConfigure")}
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
```

- [ ] **page.tsx** — flatten the status-badges row. Replace the "Devices" badge (lines 366-369):
```tsx
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 text-sm text-muted-foreground">
                    <Activity className="size-3.5 text-month-primary" />
                    {t("statusDevices", { count: entities.length })}
                  </div>
```
with:
```tsx
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-sm text-muted-foreground">
                    <Activity className="size-3.5 text-primary" />
                    {t("statusDevices", { count: entities.length })}
                  </div>
```
and the "Active" badge (lines 371-374):
```tsx
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-sm text-emerald-400">
                      <Power className="size-3.5" />
                      {t("statusActive", { count: activeEntities.length })}
                    </div>
```
with:
```tsx
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/[0.14] text-sm text-success">
                      <Power className="size-3.5" />
                      {t("statusActive", { count: activeEntities.length })}
                    </div>
```
and the "Off" badge (lines 376-379):
```tsx
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 text-sm text-muted-foreground">
                      <PowerOff className="size-3.5" />
                      {t("statusOff", { count: offEntities.length })}
                    </div>
```
with:
```tsx
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-sm text-muted-foreground">
                      <PowerOff className="size-3.5" />
                      {t("statusOff", { count: offEntities.length })}
                    </div>
```
and the "Other" badge (lines 382-385):
```tsx
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 text-sm text-blue-400">
                      <CircleDot className="size-3.5" />
                      {t("statusOther", { count: otherEntities.length })}
                    </div>
```
with:
```tsx
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 text-sm text-blue-500">
                      <CircleDot className="size-3.5" />
                      {t("statusOther", { count: otherEntities.length })}
                    </div>
```

- [ ] **page.tsx** — add a prominent scenes section above the entity grid. Find the start of the cards-grid block (line 395):
```tsx
        {/* Cards Grid (for custom dashboards with cards) */}
        {dashboardCards.length > 0 && activeDashboard?.type !== "energy" && (
          <>
            <motion.div
              key={activeDashboardId}
```
Insert this block IMMEDIATELY BEFORE that comment (so it renders between the status badges and the grid):
```tsx
        {/* Scenes — the user's actual HA scene/script entities, surfaced as a prominent flat row */}
        {(() => {
          const sceneCards = dashboardCards
            .filter((c) => c.card_type === "scene" || c.card_type === "script")
            .sort((a, b) => a.position - b.position);
          if (sceneCards.length === 0 || activeDashboard?.type === "energy") return null;
          return (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
              className="flex flex-col gap-2"
            >
              <h2 className="text-sm font-medium text-muted-foreground">{t("scenesHeading")}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {sceneCards.map((card) => (
                  <EntityCard
                    key={card.id}
                    card={card}
                    entity={entityMap.get(card.entity_id)}
                    isLoading={loadingEntities}
                  />
                ))}
              </div>
            </motion.div>
          );
        })()}

```
(The scene cards still render via the existing `SceneCard` (flattened in Task 2) — no fake names. They additionally remain in the main grid below, which is acceptable; the section is a convenience surfacing per the scope's "optionally surface".)

- [ ] **dashboard-selector.tsx** — restyle the pills to the active = `bg-primary text-primary-foreground` room-tab look. Replace the `button` className (lines 96-101):
```tsx
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap",
                activeDashboardId === dashboard.id
                  ? "bg-month-primary/10 text-month-primary"
                  : "hover:bg-accent text-muted-foreground hover:text-foreground"
              )}
```
with:
```tsx
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap min-h-[44px]",
                activeDashboardId === dashboard.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground"
              )}
```
(`min-h-[44px]` satisfies the touch-target floor; `rounded-full` + `bg-primary` is the pill room-tab look.)

- [ ] **floating-lights-fab.tsx** — RoomTab active state. Replace (lines 96-100):
```tsx
      className={`shrink-0 flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all ${
        isActive
          ? "bg-month-primary text-primary-foreground"
          : "bg-muted/50 hover:bg-muted text-muted-foreground"
      }`}
```
with:
```tsx
      className={`shrink-0 flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all ${
        isActive
          ? "bg-primary text-primary-foreground"
          : "bg-muted/50 hover:bg-muted text-muted-foreground"
      }`}
```

- [ ] **floating-lights-fab.tsx** — FAB button glow + indicator border. Replace (lines 449-462):
```tsx
      <button
        onClick={() => setIsOpen(true)}
        className="fixed right-4 z-50 p-4 rounded-full bg-month-primary text-primary-foreground shadow-lg shadow-[0_0_20px_hsl(var(--month-primary)/0.3)] hover:shadow-xl transition-all hover:scale-105 active:scale-95 fab-above-nav"
        aria-label={t("fabAria")}
        aria-expanded={isOpen}
        aria-controls="lights-control-panel"
      >
        <div className="relative">
          <Lightbulb className="size-6" />
          {totalLightsOn > 0 && (
            <span className="absolute -top-1 -right-1 size-3 bg-yellow-400 rounded-full border-2 border-month-primary" />
          )}
        </div>
      </button>
```
with:
```tsx
      <button
        onClick={() => setIsOpen(true)}
        className="fixed right-4 z-50 p-4 rounded-full bg-primary text-primary-foreground shadow-lg shadow-[0_0_20px_hsl(var(--primary)/0.3)] hover:shadow-xl transition-all hover:scale-105 active:scale-95 fab-above-nav"
        aria-label={t("fabAria")}
        aria-expanded={isOpen}
        aria-controls="lights-control-panel"
      >
        <div className="relative">
          <Lightbulb className="size-6" />
          {totalLightsOn > 0 && (
            <span className="absolute -top-1 -right-1 size-3 bg-yellow-400 rounded-full border-2 border-primary" />
          )}
        </div>
      </button>
```

- [ ] **light-control-item.tsx** — flatten container + glow the icon badge (parallels Task 1's light-card). Replace (lines 115-122):
```tsx
    <div
      className={`rounded-xl border p-4 transition-all ${
        isOn
          ? "border-yellow-500/30"
          : "bg-card"
      } ${isUnavailable ? "opacity-50" : ""}`}
      style={isOn && iconColor ? { backgroundColor: `${iconColor}15` } : undefined}
    >
```
with:
```tsx
    <div
      className={`rounded-2xl border bg-card elev-sm p-4 transition-all ${
        isOn ? "border-yellow-500/30" : "border-border"
      } ${isUnavailable ? "opacity-50" : ""}`}
      style={isOn && iconColor ? { backgroundColor: `${iconColor}15` } : undefined}
    >
```
and the icon badge (lines 125-130):
```tsx
        <div
          className={`p-2 rounded-lg transition-colors ${
            isOn ? "bg-yellow-500/20" : "bg-muted text-muted-foreground"
          }`}
          style={isOn && iconColor ? { color: iconColor } : undefined}
        >
```
with:
```tsx
        <div
          className={`p-2 rounded-lg transition-colors ${
            isOn ? "bg-yellow-500/20 icon-badge" : "bg-muted text-muted-foreground"
          }`}
          style={
            isOn && iconColor
              ? { color: iconColor, boxShadow: `0 0 16px ${iconColor}66` }
              : undefined
          }
        >
```

- [ ] Run gate:
```
cd webapp && npm run lint && npx tsc --noEmit
```
Expected: PASS.

- [ ] Commit:
```
feat(homeautomation): flatten page gates to Card, pill dashboard tabs (bg-primary), scenes section, primary FAB glow
```

---

### Task 5 — Cameras: live tiles (LIVE pill + scanline + name overlay + offline tile), HA camera-card flatten, go2rtc driver flat states

**Files**
- `webapp/src/components/camera-viewer.tsx` (EDIT)
- `webapp/src/components/home-assistant/cards/camera-card.tsx` (EDIT)
- `webapp/src/plugins/cameras/drivers/go2rtc.tsx` (EDIT)

**Interfaces**
- Consumes: new i18n keys `components.cameraViewer.live` and `components.cameraViewer.offline` (added in Task 6); `Badge` from `@/components/ui/badge`.
- Produces: no API change; `CameraViewer`/`CameraGrid` signatures unchanged.

Design treatments (all STATIC, no animation):
- Name moves to an overlay `absolute bottom-2 left-2 text-white` over a `bg-gradient-to-t from-black/60` scrim drawn over the video area.
- "LIVE" pill: `absolute top-2 left-2`, red dot + LIVE text, shown only when a stream is actively loaded (not loading, no error).
- Scanline: a `pointer-events-none absolute inset-0` div with a `repeating-linear-gradient` (subtle, ~4px stripes, low alpha), drawn over the video.
- Offline tile: dark `bg-black/90` fill + centered `VideoOff` + camera name + retry, shown when `error` is set.

Steps:

- [ ] **camera-viewer.tsx** — import `Badge`. Add after the `Button` import (line 14):
```tsx
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
```

- [ ] **camera-viewer.tsx** — add a shared static scanline + live overlay helper near the top of the file (after the `CameraViewerProps` interface, before `export function CameraViewer`):
```tsx
// Static CSS scanline overlay — no animation (ARM-GPU + reduced-motion safe).
function ScanlineOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage:
          "repeating-linear-gradient(to bottom, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 4px)",
      }}
    />
  );
}

// "LIVE" pill — red dot + label, shown only when a stream is actively rendering.
function LivePill({ label }: { label: string }) {
  return (
    <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/55 text-white text-[10px] font-medium uppercase tracking-wider">
      <span className="size-1.5 rounded-full bg-red-500" />
      {label}
    </div>
  );
}
```

- [ ] **camera-viewer.tsx** — restyle the `error` branch in `renderStream` to the offline tile. Replace (lines 211-237):
```tsx
    if (error) {
      return (
        <div className={`${containerClass} bg-muted flex flex-col items-center justify-center gap-2`}>
          <VideoOff className="size-8 text-muted-foreground" />
          <span className="text-sm text-muted-foreground text-center px-4">
            {error}
          </span>
          <Button variant="outline" size="sm" onClick={() => {
            if (stream_type === "webrtc") {
              initWebRTC();
            } else {
              setIsLoading(true);
              setError(null);
              // Force re-render of image
              if (imgRef.current) {
                const url = new URL(imgRef.current.src);
                url.searchParams.set("t", Date.now().toString());
                imgRef.current.src = url.toString();
              }
            }
          }}>
            <RefreshCw className="size-4 mr-2" />
            {t("retry")}
          </Button>
        </div>
      );
    }
```
with:
```tsx
    if (error) {
      return (
        <div className={`${containerClass} bg-black/90 flex flex-col items-center justify-center gap-2`}>
          <VideoOff className="size-8 text-white/40" />
          <span className="text-sm font-medium text-white/80">{name}</span>
          <span className="text-xs text-white/50 text-center px-4">{error}</span>
          <Button variant="outline" size="sm" className="mt-1" onClick={() => {
            if (stream_type === "webrtc") {
              initWebRTC();
            } else {
              setIsLoading(true);
              setError(null);
              // Force re-render of image
              if (imgRef.current) {
                const url = new URL(imgRef.current.src);
                url.searchParams.set("t", Date.now().toString());
                imgRef.current.src = url.toString();
              }
            }
          }}>
            <RefreshCw className="size-4 mr-2" />
            {t("retry")}
          </Button>
        </div>
      );
    }
```

- [ ] **camera-viewer.tsx** — add scanline to the mjpeg + webrtc-placeholder stream branches inside `renderStream`. In the `case "webrtc":` block (lines 242-256), add `<ScanlineOverlay />` just before the closing `</div>`:
```tsx
            {/* Placeholder shown when video is in fullscreen */}
            {!isFullscreen && fullscreenOpen && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Video className="size-8 text-white/30" />
              </div>
            )}
            {!isFullscreen && <ScanlineOverlay />}
          </div>
```
In the `case "mjpeg":` block, after the `<img …/>` and before the closing `</div>` (line 274), add:
```tsx
            />
            {!isFullscreen && <ScanlineOverlay />}
          </div>
```
(The `rtsp` branch uses `AutoRefreshSnapshot`; scanline added there in the next step.)

- [ ] **camera-viewer.tsx** — add scanline to `AutoRefreshSnapshot`. In its returned JSX (lines 462-486), add `{!isFullscreen && <ScanlineOverlay />}` just before the existing auto-refresh badge `<div className="absolute bottom-2 left-2 …">`:
```tsx
      />
      {!isFullscreen && <ScanlineOverlay />}
      <div className="absolute bottom-2 left-2 px-2 py-1 rounded bg-black/70 text-white text-xs flex items-center gap-1">
        <RefreshCw className="size-3" />
        {t("autoRefresh")}
      </div>
```

- [ ] **camera-viewer.tsx** — restyle the thumbnail tile: token the hover, add LIVE pill + name overlay over the video, and remove the separate label bar. Replace the tile root (line 297-298):
```tsx
      <div
        className={`rounded-xl border bg-card overflow-hidden transition-all hover:border-month-primary/30 cursor-pointer group ${className}`}
```
with:
```tsx
      <div
        className={`rounded-2xl border bg-card overflow-hidden transition-all hover:border-primary/30 cursor-pointer group ${className}`}
```

- [ ] **camera-viewer.tsx** — inside the webrtc preview branch, add the scanline + (in non-fullscreen) keep the video. Replace the webrtc preview block (lines 303-328):
```tsx
          {stream_type === "webrtc" ? (
            <div className="w-full aspect-video bg-black relative">
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="size-8 animate-spin text-white/50" />
                </div>
              )}
              {/* Video element - only rendered here when NOT fullscreen */}
              {!fullscreenOpen && (
                <video
                  ref={setVideoRef}
                  autoPlay
                  playsInline
                  muted={isMuted}
                  className="size-full object-contain"
                  onLoadedData={handleVideoLoaded}
                  onError={() => handleError(t("errorVideoLoad"))}
                />
              )}
              {/* Placeholder when fullscreen is open */}
              {fullscreenOpen && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Video className="size-8 text-white/30" />
                </div>
              )}
            </div>
          ) : (
            renderStream(false)
          )}
```
with:
```tsx
          {stream_type === "webrtc" ? (
            <div className="w-full aspect-video bg-black relative">
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="size-8 animate-spin text-white/50" />
                </div>
              )}
              {/* Video element - only rendered here when NOT fullscreen */}
              {!fullscreenOpen && (
                <video
                  ref={setVideoRef}
                  autoPlay
                  playsInline
                  muted={isMuted}
                  className="size-full object-contain"
                  onLoadedData={handleVideoLoaded}
                  onError={() => handleError(t("errorVideoLoad"))}
                />
              )}
              {/* Placeholder when fullscreen is open */}
              {fullscreenOpen && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Video className="size-8 text-white/30" />
                </div>
              )}
              {!fullscreenOpen && <ScanlineOverlay />}
            </div>
          ) : (
            renderStream(false)
          )}

          {/* LIVE pill — only when a stream is actively rendering */}
          {!error && !isLoading && <LivePill label={t("live")} />}

          {/* Name overlay over the video */}
          {!error && (
            <div className="absolute bottom-0 inset-x-0 p-2 pt-6 bg-gradient-to-t from-black/60 to-transparent pointer-events-none">
              <span className="text-sm font-medium text-white truncate block">{name}</span>
            </div>
          )}
```

- [ ] **camera-viewer.tsx** — remove the now-redundant bottom label bar (lines 341-354), since the name is now an overlay. Delete:
```tsx
        {/* Label */}
        {showControls && (
          <div className="p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Video className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium truncate">{name}</span>
              </div>
              <span className="text-xs text-muted-foreground uppercase">
                {stream_type}
              </span>
            </div>
          </div>
        )}
```
(Leave the fullscreen-hint `Maximize2` block above it intact. The `showControls` prop is still consumed by that hint, so no unused-var lint.)

- [ ] **home-assistant/cards/camera-card.tsx** — token the hover accent. Replace (lines 103-106):
```tsx
        className={`rounded-xl border bg-card overflow-hidden transition-all hover:border-month-primary/30 cursor-pointer ${
          isUnavailable ? "opacity-50" : ""
        }`}
```
with:
```tsx
        className={`rounded-2xl border bg-card overflow-hidden transition-all hover:border-primary/30 cursor-pointer ${
          isUnavailable ? "opacity-50" : ""
        }`}
```

- [ ] **home-assistant/cards/camera-card.tsx** — restyle the offline preview (the `isUnavailable` branch, lines 110-114) to a dark tile + name. Replace:
```tsx
        <div className="relative aspect-video bg-muted">
          {isUnavailable ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <VideoOff className="size-8 text-muted-foreground" />
            </div>
          ) : (
```
with:
```tsx
        <div className="relative aspect-video bg-black/90">
          {isUnavailable ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
              <VideoOff className="size-8 text-white/40" />
              <span className="text-xs text-white/60">{label}</span>
            </div>
          ) : (
```

- [ ] **go2rtc.tsx** — flatten the `Go2rtcConfigForm` `GlassCard`s to `Card`/`CardContent` and the loading state. First swap the import (line 21):
```tsx
import { GlassCard } from "@/components/ui/card";
```
with:
```tsx
import { Card, CardContent } from "@/components/ui/card";
```
Then replace the three `GlassCard` blocks. Loading state (lines 251-260):
```tsx
      <GlassCard>
        <div className="p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">{t("loadingHint")}</span>
          </div>
        </div>
      </GlassCard>
```
with:
```tsx
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">{t("loadingHint")}</span>
          </div>
        </CardContent>
      </Card>
```
Camera-list card (line 270 `<GlassCard>` … line 368 `</GlassCard>`): replace the opening `<GlassCard>` with `<Card>`, the inner `<div className="p-6">` with `<CardContent className="p-6">`, the matching `</div>` with `</CardContent>`, and the closing `</GlassCard>` with `</Card>`.
Info card (line 387 `<GlassCard>` … line 411 `</GlassCard>`): same swap — `<GlassCard>`→`<Card>`, `<div className="p-6">`→`<CardContent className="p-6">`, closing `</div>`→`</CardContent>`, `</GlassCard>`→`</Card>`.

- [ ] **go2rtc.tsx** — token the `CamerasSkeleton` aspect tiles (already `rounded-2xl`, no change needed) and confirm no remaining `GlassCard`/`month-primary` references in the file via Grep.

- [ ] Run gate:
```
cd webapp && npm run lint && npx tsc --noEmit
```
Expected: PASS.

- [ ] Commit:
```
feat(cameras): live tiles with LIVE pill + static scanline + name overlay + offline state; flatten driver to Card tokens
```

---

### Task 6 — i18n keys (EN/DE/FR parity) + CHANGELOG

**Files**
- `webapp/messages/en.json` (EDIT)
- `webapp/messages/de.json` (EDIT)
- `webapp/messages/fr.json` (EDIT)
- `CHANGELOG.md` (EDIT)

**Interfaces**
- Produces: `homeAutomation.scenesHeading`, `components.cameraViewer.live`, `components.cameraViewer.offline` in all three locales.

Steps:

- [ ] Add `homeAutomation.scenesHeading` to each locale (place adjacent to existing `homeAutomation` string keys such as `autoRefreshNote`):
  - en: `"scenesHeading": "Scenes"`
  - de: `"scenesHeading": "Szenen"`
  - fr: `"scenesHeading": "Scènes"`

- [ ] Add to `components.cameraViewer` in each locale:
  - en: `"live": "Live"`, `"offline": "Offline"`
  - de: `"live": "Live"`, `"offline": "Offline"`
  - fr: `"live": "En direct"`, `"offline": "Hors ligne"`

- [ ] Verify JSON validity + EN/DE/FR key parity for the touched namespaces:
```
cd webapp && node -e "const en=require('./messages/en.json'),de=require('./messages/de.json'),fr=require('./messages/fr.json');const w=(o,p='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?w(v,p+k+'.'):[p+k]);const E=new Set(w(en)),D=new Set(w(de)),F=new Set(w(fr));const diff=(a,b)=>[...a].filter(x=>!b.has(x));console.log('en-de',diff(E,D),'de-en',diff(D,E));console.log('en-fr',diff(E,F),'fr-en',diff(F,E));"
```
Expected: all empty arrays.

- [ ] Add CHANGELOG `[Unreleased]` entries under the right sections (create `### Changed` / `### Fixed` headers if absent under `[Unreleased]`):
```markdown
### Changed
- Smart Home: flattened entity cards to the Salbei/Leinen card style (theme-following, no glass), pill-style dashboard tabs, a glowing light-on icon badge, and a Scenes section that surfaces your actual Home Assistant scenes.
- Cameras: live tiles now show a LIVE pill, a subtle scanline overlay, the camera name over the video, and a clear offline state when a stream drops.
```

- [ ] Run gate:
```
cd webapp && npm run lint && npx tsc --noEmit
```
Expected: PASS.

- [ ] Commit:
```
feat(i18n): add scenes heading + camera LIVE/offline labels (en/de/fr); changelog for smart-home & cameras redesign
```

---

## Self-Review

Scope-item → task mapping:
1. Extract `getColorTempColor` → shared util used by both consumers — **Task 1** (creates `lib/ha-color.ts`, updates light-card + light-control-item imports, deletes both local copies).
2. Flatten entity cards + dispatcher (~14 files), batched 2-3 ways:
   - light + climate + cover + media → **Task 1**
   - sensor + switch + scene + lock + fan + vacuum + alarm → **Task 2**
   - person + weather + generic + dispatcher → **Task 3**
   All `bg-white/[0.0x]`/`backdrop-blur-sm`/`border-white/[0.08]` removed; `month-primary`→`primary`; functional state tints (yellow/orange/blue/green/purple) documented as kept; light-ON glow added (Tasks 1 + 4 for the two light surfaces).
3. Home-automation page (GlassCard→Card on all gate branches: loading skeleton, not-connected, no-dashboards, empty, energy-redirect; status badges flat/rounded-full; primary accents) + DashboardSelector pills (active `bg-primary text-primary-foreground`, `rounded-full`, ≥44px) + scenes section (filters real scene/script cards, no hardcoded names) → **Task 4**.
4. FloatingLightsFab + LightControlItem (`month-primary`→`primary`, RoomTab `bg-primary`, FAB glow `hsl(var(--primary)/0.3)`, container flatten + light glow) → **Task 4**.
5. Cameras viewer (name overlay over video, LIVE pill, static scanline, offline tile, `hover:border-primary/30`, `rounded-2xl`) + HA camera-card flatten + go2rtc driver Card/Empty/Error/Skeleton flat → **Task 5**.
6. i18n new keys (scenesHeading, live, offline) EN/DE/FR parity + changelog → **Task 6**.

Type-consistency check:
- `getColorTempColor` signature is identical to both deleted copies; consumers call it unchanged. No type change.
- `EntityCard` reused in the new scenes section with the same `{ card, entity, isLoading }` props; `entityMap.get()` returns `HAEntity | undefined` which matches the `entity` prop type.
- `Card`/`CardContent` are existing exports; `Badge` import is the existing primitive. No new props introduced on `CameraViewer`/`CameraGrid`/`DashboardSelector`.
- `t("scenesHeading")` uses the `homeAutomation` namespace already bound in `page.tsx` (`const t = useTranslations("homeAutomation")`). `t("live")`/`t("offline")` use the `components.cameraViewer` namespace already bound in `camera-viewer.tsx`.
- `showControls` remains consumed (fullscreen-hint block) after removing the label bar — no unused-prop lint.

Flagged deferrals:
- **Live smoke test** (real HA + cameras) is deferred — no configured HA/go2rtc in the dev environment. Verification is lint + tsc + structural review; the not-connected / empty / offline branches render without HA and are explicitly covered.
- **LIVE pill semantics**: shown when `!error && !isLoading`, i.e. a stream is actively rendering. For `rtsp` (auto-refresh snapshot) and `mjpeg` this means the first frame loaded; this is the honest "currently receiving frames" signal, not a fake always-on badge.
- The scenes section intentionally also leaves scene cards in the main grid (per "optionally surface"); if duplication is unwanted, a follow-up could exclude scene/script cards from the main grid — out of scope here.
- `entity-detail-sheet.tsx`, `switch-control-item.tsx`, `sensor-display-item.tsx`, `binary-sensor-display-item.tsx` are NOT touched — they are not in the named scope and were not flagged as carrying glass; a follow-up sweep can confirm if a later audit shows residual `month-primary`/glass there.
