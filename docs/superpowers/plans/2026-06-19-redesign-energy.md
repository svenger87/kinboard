# Plan 6 — Redesign the ENERGY route ("Salbei/Leinen")

For agentic workers: use superpowers:subagent-driven-development

## Goal
Restyle the `/energy` route to the "Salbei/Leinen" redesign: replace glass surfaces with the flat
linen `Card` look, re-skin the `EnergyFlow` SVG with rounded icon-badge nodes and **marching
dashed** flux paths (replacing the traveling-dot mechanism), theme every chart series from the
`--energy-*` CSS tokens (no hardcoded hex) with a **dashed consumption** line over the generation
area, lay the driver out per the mockup (flow diagram + stat column + history chart with the
existing Heute/Woche/Monat segment), add a mobile compact flow + battery bar, and swap stray
`month-primary` accents for `primary`/energy tokens. The route stays **theme-following** (NOT
dark-forced): the flat linen look in light, the dark mockup look in dark — both already have
`--energy-*` and neutral dark variants.

This is a **restyle + flow-animation change + chart token theming** task. Do **NOT** rebuild the
data layer, the hooks, the `EnergyConfigForm`, or the derived-value math — all of that is correct
and stays.

## Architecture
- `webapp/src/app/energy/page.tsx` — thin shell: `<main>` + `.page-gradient` + `<PageHeader>` +
  `<DriverCard/>` where `DriverCard = getDriver("generic-ha-energy").Card`. Header icon badge
  currently `bg-month-primary/10` → swap to `bg-primary/10`.
- `webapp/src/plugins/energy/drivers/generic-ha-energy.tsx` — the `EnergyCard` (real UI, no props,
  reads hooks) + `EnergyConfigForm` (settings form — restyle its `GlassCard`s to `Card` too, but
  do NOT touch its logic). `EnergyCard` orchestrates: quick-stats bar, an `EnergyFlow` section, a
  `StatisticsGrid`, a charts section with two `Tabs` (period + chart-type) wrapping
  `PowerChart`/`EnergyChart`/`BatteryChart`, a battery-insights grid, and a refresh footer. Plus
  loading/not-connected/not-configured empty states (all `GlassCard`).
- `webapp/src/components/home-assistant/energy-flow.tsx` — the SVG flow diagram (200×228 viewBox,
  4 diamond nodes, 6 quadratic-Bézier paths, currently animated by traveling `<circle>` dots via
  CSS `offset-path`). Re-skin nodes + replace dots with marching dashes; colors → tokens.
- `webapp/src/components/home-assistant/{power-chart,energy-chart,battery-chart,mini-chart}.tsx` —
  Recharts `AreaChart`s. Theme series colors from tokens; flatten the tooltip; dash the
  consumption series.
- `webapp/src/components/home-assistant/statistics-card.tsx` — `StatisticsCard` + `StatisticsGrid`.
  Already uses `bg-energy-*/10` tokens; only the `hover:border-month-primary/30` needs swapping.
- `webapp/src/app/globals.css` — add `@keyframes marchDash` + a `.flow-dash` utility +
  reduced-motion guard.
- i18n: `webapp/messages/{en,de,fr}.json` — namespaces `energy` (driver/page) and
  `homeAutomation.charts` (flow/charts). New stat-column labels reuse existing keys where possible.

## Tech Stack
Next.js 16 App Router, React 19, Tailwind, shadcn/ui, framer-motion, next-intl (EN+DE+FR parity is
a CI gate), Recharts. Energy CSS tokens (`--energy-solar` amber, `--energy-battery` green,
`--energy-grid` blue, `--energy-consumption` orange — light + dark) are exposed as Tailwind
`energy.{solar,battery,grid,consumption}`, so `text-energy-solar`, `bg-energy-solar/10`, and
`hsl(var(--energy-solar))` all work. `Card`/`CardContent` are flat (`rounded-2xl border bg-card
elev-md`). `Tabs` already render the inset-segment look.

## Global Constraints
- No `next build` locally. Per-task gate: `cd webapp && npm run lint` and `npx tsc --noEmit`. No
  unit tests — verification = lint+tsc+structural self-review; live visual smoke deferred to the
  user (needs a configured HA — note that the empty/not-configured state must still render
  cleanly). Do NOT write Jest/RTL/TDD steps.
- Reuse Foundation + Plan 2-5 components; never hardcode accent/energy hex in NEW code — use
  `hsl(var(--energy-*))` / Tailwind `energy.*` / `primary`; functional chart series colors come
  from the energy tokens. NO literal `text-white` on primary/energy surfaces (use
  `text-primary-foreground`); node label text legible in both themes.
- NO glass/backdrop-blur on app surfaces (removes GlassCard + the chart tooltip blur).
  Theme-following (NOT dark-forced).
- Touch targets ≥44px. Lucide stroke 1.75. kW/kWh/% values `tabular-nums`/`font-display` for big
  figures. Respect `prefers-reduced-motion` (flow dashes static).
- next-intl EN/DE/FR parity (CI gate) — every new key in all three.
- Commits: Conventional Commits, NO `Co-Authored-By: Claude` trailer. One commit per task.

---

### Task 1 — globals.css: add the marching-dash keyframe + reduced-motion guard

**Files**
- `webapp/src/app/globals.css` (edit)

**Interfaces**
- Consumes: nothing.
- Produces: a `@keyframes marchDash` animation and a `.flow-dash` utility class consumed by the
  `EnergyFlow` SVG in Task 2. `marchDash` animates `stroke-dashoffset` from a positive offset to 0
  so dashes appear to "march" along the path in the direction the path is drawn (`M from → to`).
  A modifier class `.flow-dash-reverse` runs it backwards for paths drawn against the flow
  direction (none currently — all paths flow source→sink — but provide it so the SVG can flip a
  single path without redefining geometry).

**Steps**
- [ ] Anchor on the screensaver crossfade keyframe block (lines 375–398). Insert the new keyframe
  + utilities immediately AFTER the `.screensaver-photo-out` rule (line 398) and BEFORE the
  `/* GPU hints removed ... */` comment (line 400). Insert this block:

```css
/* Energy-flow marching dashes — animates a dashed stroke so flux paths read as moving.
   stroke-dasharray is set per-path inline; this just shifts the offset in a loop.
   The dash pattern length below MUST match the dasharray sum used in energy-flow.tsx (4+3=7). */
@keyframes marchDash {
  to { stroke-dashoffset: -14; }
}
@keyframes marchDashReverse {
  to { stroke-dashoffset: 14; }
}
.flow-dash {
  animation: marchDash 1s linear infinite;
}
.flow-dash-reverse {
  animation: marchDashReverse 1s linear infinite;
}
```

- [ ] Anchor on the existing reduced-motion block (lines 491–507). It already zeroes
  `animation-duration` for `*`, which neutralises `.flow-dash`. Add an explicit, readable guard so
  the intent is obvious and the dash sits at offset 0 (a clean static dashed line) rather than a
  partial frame. Inside that `@media (prefers-reduced-motion: reduce) { ... }` block, AFTER the
  `.screensaver-photo-in, .screensaver-photo-out { ... }` rule (line 502–506) and before the
  closing `}` (line 507), add:

```css
  .flow-dash,
  .flow-dash-reverse {
    animation: none !important;
    stroke-dashoffset: 0 !important;
  }
```

- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected: PASS (CSS-only change; lint/tsc
  unaffected).
- [ ] Commit:
```
git add webapp/src/app/globals.css
git commit -m "style(energy): add marchDash keyframe + reduced-motion guard for flow paths"
```

---

### Task 2 — EnergyFlow: rounded icon-badge nodes + marching-dash paths + energy tokens

**Files**
- `webapp/src/components/home-assistant/energy-flow.tsx` (edit)

**Interfaces**
- Consumes: `.flow-dash` / `.flow-dash-reverse` from Task 1; the `--energy-*` CSS tokens (via
  `hsl(var(--energy-*))` strings, NOT `ENERGY_COLORS` hex). Props unchanged:
  `{solarPower, batteryPower, batterySoc, gridPower, homePower, gridToBatteryPower}`.
- Produces: the same `EnergyFlow` component (same export, same props, same SVG viewBox `0 0 200 228`
  and same node geometry) with token colors, rounded-rect icon-badge nodes, and dashed marching
  paths instead of traveling dots.

Keep the existing geometry (`NODES`, `FLOW_PATHS`, `edgePath`, `R = 20`), the `activeFlows` /
`paths` / `nodeColors` memos, `formatPower`, and the `t("...")` label/aria calls. Only the color
source and the SVG render layers change.

**Steps**
- [ ] Replace the `ENERGY_COLORS` import + add the token color map. Anchor (lines 1–7):

```tsx
"use client";

import { useMemo } from "react";
import { Sun, Battery, Home, Zap, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { ENERGY_COLORS } from "@/types/home-assistant";
```

Replace with (drop the `ENERGY_COLORS` import; introduce a token-string map so colors follow the
theme in both light and dark):

```tsx
"use client";

import { useMemo } from "react";
import { Sun, Battery, Home, Zap, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// Theme-following energy colors as CSS-var strings (light + dark variants live in globals.css).
// solar=amber, battery=green, grid=blue, consumption/home=orange.
const FLOW_COLOR = {
  solar: "hsl(var(--energy-solar))",
  battery: "hsl(var(--energy-battery))",
  grid: "hsl(var(--energy-grid))",
  home: "hsl(var(--energy-consumption))",
} as const;
```

- [ ] Replace the `activeFlows` memo's per-flow `color` assignments to use `FLOW_COLOR` instead of
  `ENERGY_COLORS`. Anchor (lines 98–147) — the body sets six flows. Replace each `color:` line:
  - `solar-battery`: `color: ENERGY_COLORS.solar,` → `color: FLOW_COLOR.solar,`
  - `solar-home`: `color: ENERGY_COLORS.solar,` → `color: FLOW_COLOR.solar,`
  - `solar-grid`: `color: ENERGY_COLORS.gridExport,` → `color: FLOW_COLOR.grid,`
  - `battery-home`: `color: ENERGY_COLORS.batteryDischarge,` → `color: FLOW_COLOR.battery,`
  - `grid-home`: `color: ENERGY_COLORS.gridImport,` → `color: FLOW_COLOR.grid,`
  - `grid-battery`: `color: ENERGY_COLORS.gridImport,` → `color: FLOW_COLOR.grid,`

  Resulting block (full replacement of lines 98–147):

```tsx
  // Calculate active flows and their power levels
  const activeFlows = useMemo(() => {
    const flows: Record<string, { active: boolean; power: number; color: string }> = {};
    const minPower = 30;

    flows["solar-battery"] = {
      active: solarPower > minPower && batteryPower > minPower,
      power: Math.min(solarPower, Math.max(batteryPower, 0)),
      color: FLOW_COLOR.solar,
    };

    const solarToHome = solarPower - Math.max(batteryPower, 0);
    flows["solar-home"] = {
      active: solarPower > minPower && solarToHome > minPower,
      power: Math.max(solarToHome, 0),
      color: FLOW_COLOR.solar,
    };

    flows["solar-grid"] = {
      active: solarPower > minPower && gridPower < -minPower,
      power: Math.abs(Math.min(gridPower, 0)),
      color: FLOW_COLOR.grid,
    };

    flows["battery-home"] = {
      active: batteryPower < -minPower,
      power: Math.abs(Math.min(batteryPower, 0)),
      color: FLOW_COLOR.battery,
    };

    flows["grid-home"] = {
      active: gridPower > minPower,
      power: Math.max(gridPower, 0),
      color: FLOW_COLOR.grid,
    };

    let g2b = 0;
    if (gridToBatteryPower !== undefined) {
      g2b = gridToBatteryPower;
    } else if (gridPower > minPower && batteryPower > minPower) {
      const charge = Math.max(batteryPower, 0);
      g2b = Math.max(0, charge - Math.min(solarPower, charge));
    }
    flows["grid-battery"] = {
      active: g2b > minPower,
      power: g2b,
      color: FLOW_COLOR.grid,
    };

    return flows;
  }, [solarPower, batteryPower, gridPower, gridToBatteryPower]);
```

- [ ] Replace the `nodeColors` memo (lines 158–177) to return token strings (or `null` when
  inactive). Anchor:

```tsx
  // Node highlight colors based on power state
  const nodeColors = useMemo(
    () => ({
      solar: solarPower > 0 ? ENERGY_COLORS.solar : null,
      battery:
        batteryPower > 0
          ? ENERGY_COLORS.batteryCharge
          : batteryPower < 0
            ? ENERGY_COLORS.batteryDischarge
            : null,
      grid:
        gridPower > 0
          ? ENERGY_COLORS.gridImport
          : gridPower < 0
            ? ENERGY_COLORS.gridExport
            : null,
      home: homePower > 0 ? ENERGY_COLORS.home : null,
    }),
    [solarPower, batteryPower, gridPower, homePower],
  );
```

Replace with:

```tsx
  // Node highlight colors based on power state (token strings, theme-following).
  const nodeColors = useMemo(
    () => ({
      solar: solarPower > 0 ? FLOW_COLOR.solar : null,
      battery: batteryPower !== 0 ? FLOW_COLOR.battery : null,
      grid: gridPower !== 0 ? FLOW_COLOR.grid : null,
      home: homePower > 0 ? FLOW_COLOR.home : null,
    }),
    [solarPower, batteryPower, gridPower, homePower],
  );
```

- [ ] Remove `getAnimationDuration` (lines 80–83) — the traveling-dot duration helper is no longer
  needed. Anchor and delete:

```tsx
function getAnimationDuration(power: number): number {
  const clamped = Math.min(Math.max(power, 0), 3000);
  return 12 - (clamped / 3000) * 8; // 12s at 0W → 4s at 3000W
}
```

- [ ] Replace the entire SVG render — the inline `<style jsx>` flowDot keyframes, the dim-path /
  glow / main-line / dot layers, and the node `<circle>` markup — with token-colored layers,
  marching-dash flux paths, and rounded-rect icon-badge nodes. Anchor: the whole `return (...)`
  block from line 179 (`return (`) to line 387 (the closing `);` of the component). Replace with:

```tsx
  return (
    <div className={cn("w-full max-w-md mx-auto", className)}>
      <svg
        viewBox="0 0 200 228"
        className="w-full"
        role="img"
        aria-label={t("energyFlowAria")}
      >
        {/* ── Dim background paths (always visible, inactive look) ── */}
        {FLOW_PATHS.map(({ id }) => (
          <path
            key={`bg-${id}`}
            d={paths[id]}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeOpacity={0.08}
            className="text-muted-foreground"
          />
        ))}

        {/* ── Active flows: marching dashed lines (replaces traveling dots) ── */}
        {FLOW_PATHS.map(({ id }) => {
          const f = activeFlows[id];
          if (!f?.active) return null;
          const sw = Math.min(2.5, 1 + f.power / 1500);
          return (
            <path
              key={`flow-${id}`}
              d={paths[id]}
              fill="none"
              stroke={f.color}
              strokeWidth={sw}
              strokeLinecap="round"
              strokeDasharray="4 3"
              className="flow-dash"
            />
          );
        })}

        {/* ── Nodes: rounded icon-badge style ── */}
        {(Object.keys(NODES) as Array<keyof typeof NODES>).map((key) => {
          const { x, y } = NODES[key];
          const color = nodeColors[key];
          const { icon: Icon, labelKey } = NODE_META[key];
          const label = t(labelKey);
          const active = color !== null;
          const badge = color ?? "hsl(var(--muted-foreground))";

          return (
            <g key={key}>
              {/* Rounded badge background — accent tint when active, muted when idle */}
              <rect
                x={x - R}
                y={y - R}
                width={R * 2}
                height={R * 2}
                rx={12}
                ry={12}
                fill={badge}
                fillOpacity={active ? 0.14 : 0.06}
                stroke={badge}
                strokeWidth={active ? 1.5 : 1}
                strokeOpacity={active ? 0.5 : 0.25}
              />

              {/* Icon (embedded HTML via foreignObject; stroke 1.75 from lucide default) */}
              <foreignObject x={x - 11} y={y - 11} width={22} height={22}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "100%",
                    height: "100%",
                  }}
                >
                  <Icon
                    strokeWidth={1.75}
                    style={{ width: "100%", height: "100%", color: badge }}
                  />
                </div>
              </foreignObject>

              {/* Label (neutral, legible in both themes) */}
              <text
                x={x}
                y={y + R + 13}
                textAnchor="middle"
                fontSize={7}
                fontWeight={500}
                fill="hsl(var(--muted-foreground))"
              >
                {label}
              </text>

              {/* Power value — display font, tabular figures */}
              <text
                x={x}
                y={y + R + 24}
                textAnchor="middle"
                fontSize={8}
                fontWeight={700}
                className="font-display tabular-nums"
                fill={badge}
              >
                {key === "solar" && formatPower(solarPower)}
                {key === "battery" &&
                  `${formatPower(Math.abs(batteryPower))}${batteryPower > 0 ? " ↓" : batteryPower < 0 ? " ↑" : ""}`}
                {key === "grid" &&
                  `${formatPower(Math.abs(gridPower))}${gridPower > 0 ? " ←" : gridPower < 0 ? " →" : ""}`}
                {key === "home" && formatPower(homePower)}
              </text>

              {/* Battery SoC */}
              {key === "battery" && (
                <text
                  x={x}
                  y={y + R + 34}
                  textAnchor="middle"
                  fontSize={6}
                  className="tabular-nums"
                  fill="hsl(var(--muted-foreground))"
                >
                  {Math.round(batterySoc)}%
                </text>
              )}

              {/* Grid status label */}
              {key === "grid" && gridPower !== 0 && (
                <text
                  x={x}
                  y={y + R + 34}
                  textAnchor="middle"
                  fontSize={6}
                  fill="hsl(var(--muted-foreground))"
                >
                  {gridPower > 0 ? t("gridImporting") : t("gridExporting")}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
```

  Notes for the worker: the `4 3` dasharray sums to 7; two repeats = 14, which is exactly the
  `stroke-dashoffset: -14` target in the Task 1 keyframe, so the loop is seamless. All paths are
  drawn `M from → to` (source→sink), so the default `marchDash` (offset → negative) marches in the
  flow direction; `.flow-dash-reverse` is unused here but available. `font-display`/`tabular-nums`
  on `<text>` apply via `className` (SVG text accepts utility classes for `font-family` /
  `font-variant-numeric`). The `paths` and `activeFlows`/`nodeColors` memos above are unchanged.

- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected: PASS. (`ENERGY_COLORS` import is
  now removed; confirm no other reference to it remains in this file — there is none after the
  edits above. `getAnimationDuration` removed; confirm it had no other caller — it did not.)
- [ ] Commit:
```
git add webapp/src/components/home-assistant/energy-flow.tsx
git commit -m "feat(energy): re-skin flow diagram with icon-badge nodes and marching-dash paths"
```

---

### Task 3 — Charts: token series colors, dashed consumption, flat tooltip

**Files**
- `webapp/src/components/home-assistant/power-chart.tsx` (edit)
- `webapp/src/components/home-assistant/energy-chart.tsx` (edit)
- `webapp/src/components/home-assistant/battery-chart.tsx` (edit)
- `webapp/src/components/home-assistant/mini-chart.tsx` (edit)
- `webapp/src/plugins/energy/drivers/generic-ha-energy.tsx` (edit — the two `lines[]` arrays only;
  the rest of the driver is restyled in Task 4)

**Interfaces**
- Consumes: `--energy-*` tokens. The driver passes `lines[].color` as token strings
  (`hsl(var(--energy-*))`) instead of hex; the chart's `<linearGradient>` id is derived from the
  entity id (NOT the color), so token-string colors are safe for gradient ids.
- Produces: charts whose series colors follow the theme; the consumption series renders as a
  **dashed line with no fill** (`showArea: false` + a new `dashed?: boolean` flag); a flat
  (non-blurred) tooltip.

**Steps**

- [ ] **power-chart.tsx — add a `dashed` flag to the `ChartLine` interface.** Anchor (lines 19–32):

```tsx
interface ChartLine {
  entityId: string;
  label: string;
  color: string;
  showArea?: boolean;
  // For calculated values: specify formula components
  calculated?: {
    type: "grid_import"; // Netzbezug = home_consumption - solar + battery
    homeConsumption: string; // entity_id for smart meter
    solar: string; // entity_id for solar power
    battery: string; // entity_id for battery power (positive = charge, negative = discharge)
  };
}
```

Replace with (append `dashed?`):

```tsx
interface ChartLine {
  entityId: string;
  label: string;
  color: string;
  showArea?: boolean;
  dashed?: boolean; // render as a dashed stroke with no fill (e.g. consumption over generation)
  // For calculated values: specify formula components
  calculated?: {
    type: "grid_import"; // Netzbezug = home_consumption - solar + battery
    homeConsumption: string; // entity_id for smart meter
    solar: string; // entity_id for solar power
    battery: string; // entity_id for battery power (positive = charge, negative = discharge)
  };
}
```

- [ ] **power-chart.tsx — flatten the tooltip.** Anchor (line 252):

```tsx
      <div className="bg-popover/95 backdrop-blur border rounded-lg p-3 shadow-xl">
```

Replace with:

```tsx
      <div className="bg-popover border rounded-lg p-3 elev-md">
```

- [ ] **power-chart.tsx — dash the flagged series + no fill for it.** Anchor (lines 370–382):

```tsx
          {lines.map((line) => (
            <Area
              key={line.entityId}
              type={curveType}
              dataKey={line.entityId}
              stroke={line.color}
              fill={line.showArea !== false ? `url(#gradient-${line.entityId.replace(/\./g, "-")})` : "transparent"}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
```

Replace with:

```tsx
          {lines.map((line) => (
            <Area
              key={line.entityId}
              type={curveType}
              dataKey={line.entityId}
              stroke={line.color}
              strokeDasharray={line.dashed ? "5 4" : undefined}
              fill={line.dashed || line.showArea === false ? "transparent" : `url(#gradient-${line.entityId.replace(/\./g, "-")})`}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
```

- [ ] **energy-chart.tsx — add the same `dashed` flag.** Anchor (lines 18–24):

```tsx
// Chart line configuration
interface ChartLine {
  entityId: string;
  label: string;
  color: string;
  showArea?: boolean;
}
```

Replace with:

```tsx
// Chart line configuration
interface ChartLine {
  entityId: string;
  label: string;
  color: string;
  showArea?: boolean;
  dashed?: boolean; // render as a dashed stroke with no fill
}
```

- [ ] **energy-chart.tsx — flatten the tooltip.** Anchor (line 215):

```tsx
      <div className="bg-popover/95 backdrop-blur border rounded-lg p-3 shadow-xl">
```

Replace with:

```tsx
      <div className="bg-popover border rounded-lg p-3 elev-md">
```

- [ ] **energy-chart.tsx — dash the flagged series.** Anchor (lines 330–342):

```tsx
          {lines.map((line) => (
            <Area
              key={line.entityId}
              type="monotone"
              dataKey={line.entityId}
              stroke={line.color}
              fill={line.showArea !== false ? `url(#energy-gradient-${line.entityId.replace(/\./g, "-")})` : "transparent"}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
```

Replace with:

```tsx
          {lines.map((line) => (
            <Area
              key={line.entityId}
              type="monotone"
              dataKey={line.entityId}
              stroke={line.color}
              strokeDasharray={line.dashed ? "5 4" : undefined}
              fill={line.dashed || line.showArea === false ? "transparent" : `url(#energy-gradient-${line.entityId.replace(/\./g, "-")})`}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
```

- [ ] **battery-chart.tsx — flatten the tooltip.** Anchor (line 89):

```tsx
      <div className="bg-popover/95 backdrop-blur border rounded-lg px-3 py-2 shadow-xl">
```

Replace with:

```tsx
      <div className="bg-popover border rounded-lg px-3 py-2 elev-md">
```

- [ ] **battery-chart.tsx — token SoC threshold colors + token reference lines.** Anchor (lines
  104–106):

```tsx
  // Determine color based on current SoC
  const currentSoc = chartData[chartData.length - 1]?.soc || 0;
  const color = currentSoc > 50 ? "#22c55e" : currentSoc > 20 ? "#eab308" : "#ef4444";
```

Replace with (functional thresholds kept; tokens substituted — green=`--energy-battery`,
amber=`--warning`, red=`--destructive`):

```tsx
  // Determine color based on current SoC — functional thresholds, theme tokens.
  const currentSoc = chartData[chartData.length - 1]?.soc || 0;
  const color =
    currentSoc > 50
      ? "hsl(var(--energy-battery))"
      : currentSoc > 20
        ? "hsl(var(--warning))"
        : "hsl(var(--destructive))";
```

- [ ] **battery-chart.tsx — token reference lines.** Anchor (lines 140–141):

```tsx
          <ReferenceLine y={20} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.5} />
          <ReferenceLine y={80} stroke="#22c55e" strokeDasharray="3 3" strokeOpacity={0.5} />
```

Replace with:

```tsx
          <ReferenceLine y={20} stroke="hsl(var(--destructive))" strokeDasharray="3 3" strokeOpacity={0.5} />
          <ReferenceLine y={80} stroke="hsl(var(--energy-battery))" strokeDasharray="3 3" strokeOpacity={0.5} />
```

  Note: the `socGradient` `<linearGradient>` (lines 113–116) uses `color`, now a token string —
  still valid as an SVG `stop-color`.

- [ ] **mini-chart.tsx — default color from token + gradient id safe for token strings.** The
  default `color = "#3B82F6"` and `color.replace("#", "")` for the gradient id only work for hex.
  Switch the default to the grid token and make the gradient id robust to non-hex strings. Anchor
  (lines 19–26):

```tsx
export function MiniChart({
  history,
  color = "#3B82F6",
  unit = "",
  showTooltip = true,
  className,
  height = 40,
}: MiniChartProps) {
```

Replace with:

```tsx
export function MiniChart({
  history,
  color = "hsl(var(--energy-grid))",
  unit = "",
  showTooltip = true,
  className,
  height = 40,
}: MiniChartProps) {
  // Gradient ids must be DOM-id-safe; token strings contain "(" / ")" / spaces, so slugify.
  const gradientId = `miniGradient-${color.replace(/[^a-zA-Z0-9]/g, "")}`;
```

Then anchor the gradient + Area (lines 82–96):

```tsx
          <defs>
            <linearGradient id={`miniGradient-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {showTooltip && <Tooltip content={<CustomTooltip />} />}
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            fill={`url(#miniGradient-${color.replace("#", "")})`}
            strokeWidth={1.5}
            dot={false}
          />
```

Replace with:

```tsx
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {showTooltip && <Tooltip content={<CustomTooltip />} />}
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            fill={`url(#${gradientId})`}
            strokeWidth={1.5}
            dot={false}
          />
```

  Note: the `Sparkline` variant lower in the same file keeps its `#3B82F6` default + `replace("#",
  "")` — it is not part of the energy route surface and is out of scope; leave it unchanged.

- [ ] **generic-ha-energy.tsx — swap the `lines[]` hex for tokens + mark consumption dashed.** This
  is the power-chart `lines` array. Anchor (lines 543–575):

```tsx
                    lines={[
                      ...(energyConfig?.solar_power ? [{
                        entityId: energyConfig.solar_power,
                        label: t("chartLineSolar"),
                        color: "#f97316",
                      }] : []),
                      ...(energyConfig?.home_consumption ? [{
                        entityId: energyConfig.home_consumption,
                        label: t("chartLineConsumption"),
                        color: "#3b82f6",
                      }] : []),
                      ...(energyConfig?.home_consumption && energyConfig?.solar_power ? [{
                        entityId: "calculated_grid_import",
                        label: t("chartLineGridImport"),
                        color: "#ef4444",
                        calculated: {
                          type: "grid_import" as const,
                          homeConsumption: energyConfig.home_consumption,
                          solar: energyConfig.solar_power,
                          battery: energyConfig.battery_power || "",
                        },
                      }] : []),
                      ...(energyConfig?.grid_export_power ? [{
                        entityId: energyConfig.grid_export_power,
                        label: t("chartLineGridExport"),
                        color: "#22c55e",
                      }] : []),
                      ...(energyConfig?.battery_power ? [{
                        entityId: energyConfig.battery_power,
                        label: t("chartLineBattery"),
                        color: "#06b6d4",
                      }] : []),
                    ]}
```

Replace with (solar→solar token + area; consumption→consumption token, DASHED + no fill;
grid import→grid token; grid export→grid token; battery→battery token):

```tsx
                    lines={[
                      ...(energyConfig?.solar_power ? [{
                        entityId: energyConfig.solar_power,
                        label: t("chartLineSolar"),
                        color: "hsl(var(--energy-solar))",
                      }] : []),
                      ...(energyConfig?.home_consumption ? [{
                        entityId: energyConfig.home_consumption,
                        label: t("chartLineConsumption"),
                        color: "hsl(var(--energy-consumption))",
                        dashed: true,
                      }] : []),
                      ...(energyConfig?.home_consumption && energyConfig?.solar_power ? [{
                        entityId: "calculated_grid_import",
                        label: t("chartLineGridImport"),
                        color: "hsl(var(--energy-grid))",
                        calculated: {
                          type: "grid_import" as const,
                          homeConsumption: energyConfig.home_consumption,
                          solar: energyConfig.solar_power,
                          battery: energyConfig.battery_power || "",
                        },
                      }] : []),
                      ...(energyConfig?.grid_export_power ? [{
                        entityId: energyConfig.grid_export_power,
                        label: t("chartLineGridExport"),
                        color: "hsl(var(--energy-grid))",
                      }] : []),
                      ...(energyConfig?.battery_power ? [{
                        entityId: energyConfig.battery_power,
                        label: t("chartLineBattery"),
                        color: "hsl(var(--energy-battery))",
                      }] : []),
                    ]}
```

- [ ] **generic-ha-energy.tsx — energy-chart `lines[]` tokens.** Anchor (lines 597–623):

```tsx
                    lines={[
                      ...(energyConfig?.solar_energy_today ? [{
                        entityId: energyConfig.solar_energy_today,
                        label: t("chartLineSolarYield"),
                        color: "#f97316",
                      }] : []),
                      ...(energyConfig?.grid_import ? [{
                        entityId: energyConfig.grid_import,
                        label: t("chartLineGridImport"),
                        color: "#ef4444",
                      }] : []),
                      ...(energyConfig?.grid_export ? [{
                        entityId: energyConfig.grid_export,
                        label: t("chartLineGridExport"),
                        color: "#22c55e",
                      }] : []),
                      ...(energyConfig?.battery_energy_in ? [{
                        entityId: energyConfig.battery_energy_in,
                        label: t("chartLineBatteryCharged"),
                        color: "#06b6d4",
                      }] : []),
                      ...(energyConfig?.battery_energy_out ? [{
                        entityId: energyConfig.battery_energy_out,
                        label: t("chartLineBatteryDischarged"),
                        color: "#8b5cf6",
                      }] : []),
                    ]}
```

Replace with (solar→solar token; both grid series→grid token; both battery series→battery token):

```tsx
                    lines={[
                      ...(energyConfig?.solar_energy_today ? [{
                        entityId: energyConfig.solar_energy_today,
                        label: t("chartLineSolarYield"),
                        color: "hsl(var(--energy-solar))",
                      }] : []),
                      ...(energyConfig?.grid_import ? [{
                        entityId: energyConfig.grid_import,
                        label: t("chartLineGridImport"),
                        color: "hsl(var(--energy-grid))",
                      }] : []),
                      ...(energyConfig?.grid_export ? [{
                        entityId: energyConfig.grid_export,
                        label: t("chartLineGridExport"),
                        color: "hsl(var(--energy-grid))",
                      }] : []),
                      ...(energyConfig?.battery_energy_in ? [{
                        entityId: energyConfig.battery_energy_in,
                        label: t("chartLineBatteryCharged"),
                        color: "hsl(var(--energy-battery))",
                      }] : []),
                      ...(energyConfig?.battery_energy_out ? [{
                        entityId: energyConfig.battery_energy_out,
                        label: t("chartLineBatteryDischarged"),
                        color: "hsl(var(--energy-battery))",
                      }] : []),
                    ]}
```

  Note: grid import/export now share the grid token and battery in/out share the battery token —
  per the mockup's 4-token energy palette. The legend label text differentiates them (Grid import
  vs Grid export, Battery charged vs discharged); this matches the design's reduced palette.

- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected: PASS. (The `lines[]` object
  literals gain a `dashed?: boolean` property; the `ChartLine` interfaces in both power-chart and
  energy-chart now declare it, so the inferred array element type accepts it. The power-chart line
  with `calculated` already widens via `as const`; adding `dashed: true` to a sibling element is
  fine because TS infers the union element type.)
- [ ] Commit:
```
git add webapp/src/components/home-assistant/power-chart.tsx webapp/src/components/home-assistant/energy-chart.tsx webapp/src/components/home-assistant/battery-chart.tsx webapp/src/components/home-assistant/mini-chart.tsx webapp/src/plugins/energy/drivers/generic-ha-energy.tsx
git commit -m "feat(energy): theme charts from energy tokens, dash consumption series, flatten tooltips"
```

---

### Task 4 — Driver EnergyCard: flat Cards, mockup layout, stat column, mobile compact flow

**Files**
- `webapp/src/plugins/energy/drivers/generic-ha-energy.tsx` (edit — `EnergyCard` + its empty
  states + `EnergyConfigForm`'s `GlassCard`s)

**Interfaces**
- Consumes: `Card`/`CardContent` (flat) from `@/components/ui/card`; `EnergyFlow` (Task 2),
  charts (Task 3), `StatisticsCard`/`StatisticsGrid` (Task 5), `.icon-badge`, energy tokens.
- Produces: the restyled `EnergyCard` — flow diagram + stat column + history chart laid out per
  the mockup, all glass removed, `month-primary` accents swapped to energy/primary, the mobile
  compact flow added. Data wiring (hooks, derived values, both `Tabs`, refresh `Badge`)
  unchanged.

**Steps**

- [ ] **Swap the card import.** Anchor (line 28):

```tsx
import { GlassCard } from "@/components/ui/card";
```

Replace with:

```tsx
import { Card, CardContent } from "@/components/ui/card";
```

  This affects BOTH `EnergyCard` and `EnergyConfigForm` (same file). Every `<GlassCard>` in the
  file must be replaced with `<Card>` and every matching `</GlassCard>` with `</Card>` (steps
  below cover `EnergyCard`; the `EnergyConfigForm` `GlassCard`s — at lines 1063, 1076, 1122, 1147,
  1152, 1228, 1233, 1281, 1286, 1307, 1312, 1350, 1355, 1375, 1380, 1410 — are a mechanical
  `GlassCard`→`Card` rename with no other change; do them in this task so the import has no
  dangling references).

- [ ] **EnergyCard loading state — Cards.** Anchor (lines 271–283):

```tsx
        <GlassCard>
          <div className="p-6 flex flex-col items-center gap-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-40 w-full max-w-md rounded-xl" />
          </div>
        </GlassCard>
        <GlassCard>
          <div className="p-6">
            <Skeleton className="h-5 w-40 mb-4" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        </GlassCard>
```

Replace with:

```tsx
        <Card>
          <CardContent className="p-6 flex flex-col items-center gap-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-40 w-full max-w-md rounded-xl" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-5 w-40 mb-4" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </CardContent>
        </Card>
```

- [ ] **EnergyCard not-connected state — Card.** Anchor (lines 289–305):

```tsx
      <GlassCard>
        <div className="p-8 text-center">
          <Zap className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
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

Replace with:

```tsx
      <Card>
        <CardContent className="p-8 text-center">
          <Zap className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
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

- [ ] **EnergyCard not-configured state — Card.** Anchor (lines 311–325):

```tsx
      <GlassCard>
        <div className="p-8 text-center">
          <Sun className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h2 className="text-lg font-medium mb-2">{t("notConfiguredTitle")}</h2>
          <p className="text-muted-foreground mb-6">
            {t("notConfiguredDescription")}
          </p>
          <Link href="/settings/energy">
            <Button>
              <Settings className="size-4 mr-2" />
              {t("notConfiguredAction")}
            </Button>
          </Link>
        </div>
      </GlassCard>
```

Replace with:

```tsx
      <Card>
        <CardContent className="p-8 text-center">
          <Sun className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h2 className="text-lg font-medium mb-2">{t("notConfiguredTitle")}</h2>
          <p className="text-muted-foreground mb-6">
            {t("notConfiguredDescription")}
          </p>
          <Link href="/settings/energy">
            <Button>
              <Settings className="size-4 mr-2" />
              {t("notConfiguredAction")}
            </Button>
          </Link>
        </CardContent>
      </Card>
```

- [ ] **EnergyCard flow section → flat Card laid out as flow + stat column (desktop) / stacked
  (mobile), with the mobile compact flow.** Anchor the whole flow `motion.div` (lines 412–431):

```tsx
      {/* Energy Flow Visualization */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <GlassCard>
          <div className="p-6">
            <h2 className="text-lg font-medium mb-4">{t("energyFlowHeading")}</h2>
            <EnergyFlow
              solarPower={solarPower}
              batteryPower={batteryPower}
              batterySoc={batterySoc}
              gridPower={gridPower}
              homePower={homePower}
              gridToBatteryPower={gridToBatteryPower}
            />
          </div>
        </GlassCard>
      </motion.div>
```

Replace with (the SVG diamond shows on `md+`; a compact Solar→House→Grid chevron row + battery bar
shows on mobile; a stat column sits beside the diagram on desktop). The stat column reuses the
existing `solarTotal` / `autarky` / `gridExport` derived values and the existing
`t("statSolarYield")` / `t("statAutarky")` / `t("statGridExport")` labels:

```tsx
      {/* Energy Flow Visualization + stat column */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card>
          <CardContent className="p-6">
            <h2 className="text-lg font-medium mb-4">{t("energyFlowHeading")}</h2>
            <div className="flex flex-col gap-6 md:flex-row md:items-center">
              {/* Diagram column */}
              <div className="flex-1 min-w-0">
                {/* Desktop / kiosk: full SVG diamond */}
                <div className="hidden md:block">
                  <EnergyFlow
                    solarPower={solarPower}
                    batteryPower={batteryPower}
                    batterySoc={batterySoc}
                    gridPower={gridPower}
                    homePower={homePower}
                    gridToBatteryPower={gridToBatteryPower}
                  />
                </div>

                {/* Mobile: compact Solar → House → Grid flow + battery bar */}
                <div className="md:hidden flex flex-col gap-4">
                  <div className="flex items-center justify-between gap-2">
                    {[
                      { icon: Sun, tint: "--energy-solar", value: formatFlowKw(solarPower), label: t("quickSolar") },
                      { icon: Home, tint: "--energy-consumption", value: formatFlowKw(homePower), label: t("nodeHomeLabel") },
                      { icon: Zap, tint: "--energy-grid", value: formatFlowKw(Math.abs(gridPower)), label: t("quickGrid") },
                    ].map((n, i, arr) => (
                      <div key={n.label} className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                          <span
                            className="icon-badge"
                            style={{
                              background: `hsl(var(${n.tint}) / 0.14)`,
                              color: `hsl(var(${n.tint}))`,
                            }}
                          >
                            <n.icon className="size-5" strokeWidth={1.75} />
                          </span>
                          <span className="font-display tabular-nums text-sm" style={{ color: `hsl(var(${n.tint}))` }}>
                            {n.value}
                          </span>
                          <span className="text-kiosk-label">{n.label}</span>
                        </div>
                        {i < arr.length - 1 && (
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Battery SoC bar */}
                  <div className="flex items-center gap-3">
                    <Battery className="size-5 shrink-0 text-energy-battery" strokeWidth={1.75} />
                    <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-energy-battery transition-[width] duration-300"
                        style={{ width: `${Math.max(0, Math.min(100, batterySoc))}%` }}
                      />
                    </div>
                    <span className="font-display tabular-nums text-sm text-energy-battery w-10 text-right">
                      {Math.round(batterySoc)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Stat column — vertical on desktop, hidden on mobile (2×2 quick-stats bar covers it) */}
              <div className="hidden md:flex md:flex-col gap-3 md:w-48 shrink-0">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-energy-solar/10 border border-energy-solar/20">
                  <Sun className="size-5 text-energy-solar shrink-0" strokeWidth={1.75} />
                  <div>
                    <p className="text-kiosk-primary text-energy-solar">
                      {solarTotal.toFixed(1)}<span className="text-sm font-normal ml-1">kWh</span>
                    </p>
                    <p className="text-kiosk-label mt-1.5">{t("statSolarYield")}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-success/10 border border-success/20">
                  <TrendingUp className="size-5 text-success shrink-0" strokeWidth={1.75} />
                  <div>
                    <p className="text-kiosk-primary text-success">
                      {Math.max(0, Math.min(100, autarky)).toFixed(0)}<span className="text-sm font-normal">%</span>
                    </p>
                    <p className="text-kiosk-label mt-1.5">{t("statAutarky")}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-energy-grid/10 border border-energy-grid/20">
                  <Zap className="size-5 text-energy-grid shrink-0" strokeWidth={1.75} />
                  <div>
                    <p className="text-kiosk-primary text-energy-grid">
                      {gridExport.toFixed(1)}<span className="text-sm font-normal ml-1">kWh</span>
                    </p>
                    <p className="text-kiosk-label mt-1.5">{t("statGridExport")}</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
```

  Worker notes:
  - Add `ChevronRight` to the lucide import (next step).
  - `formatFlowKw` is a small local helper (next step) that formats W→`x.x kW` / `n W` like the
    SVG's `formatPower`, kept local so the compact row matches the diagram.
  - New i18n keys referenced: `energy.quickGrid` and `energy.nodeHomeLabel` (added in Task 6).
    `quickSolar`, `statSolarYield`, `statAutarky`, `statGridExport` already exist.

- [ ] **Add `ChevronRight` to the lucide import.** Anchor (lines 8–24, the icon import list). The
  block ends with `ArrowLeft,`. Add `ChevronRight,` to that list — e.g. anchor:

```tsx
  Plus,
  X,
  ArrowLeft,
} from "lucide-react";
```

Replace with:

```tsx
  Plus,
  X,
  ArrowLeft,
  ChevronRight,
} from "lucide-react";
```

- [ ] **Add the `formatFlowKw` helper.** Anchor the line just above the `EnergyCard` function
  (lines 63–66):

```tsx
type TimePeriod = "today" | "week" | "month" | "year";
type ChartType = "power" | "energy";

function EnergyCard() {
```

Replace with:

```tsx
type TimePeriod = "today" | "week" | "month" | "year";
type ChartType = "power" | "energy";

// Compact W → "x.x kW" / "n W" formatter for the mobile flow row (mirrors energy-flow's formatPower).
function formatFlowKw(power: number): string {
  if (Math.abs(power) >= 1000) return `${(power / 1000).toFixed(1)} kW`;
  return `${Math.round(power)} W`;
}

function EnergyCard() {
```

- [ ] **Charts section card → flat Card.** Anchor (lines 504–505):

```tsx
        <GlassCard>
          <div className="p-6">
```

Replace with:

```tsx
        <Card>
          <CardContent className="p-6">
```

  And the matching close. Anchor (lines 651–653):

```tsx
          </div>
        </GlassCard>
      </motion.div>
```

Replace with:

```tsx
          </CardContent>
        </Card>
      </motion.div>
```

  (This is the charts `motion.div` that opens at line 499. The `<div className="flex flex-col
  sm:flex-row ...">` header inside and the two `Tabs` stay exactly as-is — both `Tabs` already
  inherit the inset-segment look.)

- [ ] **Battery sub-section divider token.** Anchor (line 636), inside the charts card:

```tsx
              <div className="mt-6 pt-6 border-t border-border/50">
```

This already uses `border-border/50` (neutral) — leave as-is; no `month-primary` here.

- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected: PASS. (Confirm: no `<GlassCard>`
  / `</GlassCard>` remains anywhere in the file after this task — grep `GlassCard` in the file
  returns nothing; the import is now `Card, CardContent`. `ChevronRight` and `formatFlowKw` are
  used. The quick-stats 2×2 bar at lines 336–410 is unchanged and still provides the mobile stat
  grid; the desktop stat column is the new sidebar.)
- [ ] Commit:
```
git add webapp/src/plugins/energy/drivers/generic-ha-energy.tsx
git commit -m "feat(energy): flat cards + flow/stat-column layout + mobile compact flow"
```

---

### Task 5 — StatisticsCard + page header: swap month-primary for energy/primary tokens

**Files**
- `webapp/src/components/home-assistant/statistics-card.tsx` (edit)
- `webapp/src/app/energy/page.tsx` (edit)

**Interfaces**
- Consumes: energy/primary tokens.
- Produces: `StatisticsCard` hover border on an energy token; the page header icon badge on
  `primary`.

**Steps**
- [ ] **StatisticsCard hover border.** Anchor (lines 80–85):

```tsx
    <div
      className={cn(
        "rounded-xl border p-4 transition-all bg-card hover:border-month-primary/30",
        className
      )}
    >
```

Replace with:

```tsx
    <div
      className={cn(
        "rounded-xl border p-4 transition-all bg-card hover:border-energy-solar/30",
        className
      )}
    >
```

- [ ] **Energy page header icon badge.** `PageHeader` renders the `icon` prop in a tinted badge.
  Confirm whether the `bg-month-primary/10` lives in `page.tsx` or inside `PageHeader`. Read
  `webapp/src/components/page-header.tsx`; the icon-badge tint there is `bg-month-primary/10`. The
  energy page passes `icon={Zap}` but does NOT pass a tint override. Two options — pick the bounded
  one:
  - If `PageHeader` accepts an `iconClassName`/`iconBadgeClassName` prop, pass
    `iconBadgeClassName="bg-primary/10 text-primary"` from `energy/page.tsx` (no shared-component
    change).
  - If it does NOT, the badge tint is global to all PageHeaders and swapping it here would change
    every route. In that case DO NOT edit `PageHeader`; instead leave the badge as the shared
    default and note this as a deferral (the shared PageHeader badge token swap belongs to the
    Foundation/shell plan, not the energy route).

  Read the file first, then apply the matching option. If option 1, anchor the `<PageHeader ...>`
  in `energy/page.tsx` (lines 23–34) and add the prop:

```tsx
        <PageHeader
          icon={Zap}
          title={t("title")}
          backHref="/"
```

becomes:

```tsx
        <PageHeader
          icon={Zap}
          iconBadgeClassName="bg-primary/10 text-primary"
          title={t("title")}
          backHref="/"
```

  (Use whatever the real prop name is — read `page-header.tsx` to confirm. If no such prop exists,
  take option 2 and record the deferral in Self-Review.)

- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected: PASS.
- [ ] Commit:
```
git add webapp/src/components/home-assistant/statistics-card.tsx webapp/src/app/energy/page.tsx
git commit -m "style(energy): swap month-primary accents for energy/primary tokens"
```

---

### Task 6 — i18n keys (EN/DE/FR parity) + CHANGELOG

**Files**
- `webapp/messages/en.json` (edit)
- `webapp/messages/de.json` (edit)
- `webapp/messages/fr.json` (edit)
- `CHANGELOG.md` (edit)

**Interfaces**
- Consumes: nothing.
- Produces: two new `energy.*` keys consumed by Task 4's mobile compact flow (`quickGrid`,
  `nodeHomeLabel`), in all three locales; a `[Unreleased]` changelog entry.

The stat-column labels (Generated/Autarky/Exported) reuse existing keys (`statSolarYield`,
`statAutarky`, `statGridExport`) — NO new keys for those. Only the mobile compact flow needs new
keys, because `homeAutomation.charts.nodeHome` is in a different namespace than `energy` and the
mobile row uses `useTranslations("energy")`.

**Steps**
- [ ] **en.json — add two keys to the `energy` namespace.** Anchor the `quickSolar` line in the
  `energy` block:

```json
  "quickSolar": "Solar",
  "quickConsumption": "Consumption",
```

Replace with:

```json
  "quickSolar": "Solar",
  "quickGrid": "Grid",
  "nodeHomeLabel": "Home",
  "quickConsumption": "Consumption",
```

- [ ] **de.json — same two keys, German.** Find the `energy` block's `quickSolar` line (value
  `"Solar"`) and the following `quickConsumption` line, and insert:

```json
  "quickGrid": "Netz",
  "nodeHomeLabel": "Haus",
```

immediately after `"quickSolar": ...,` (mirror the EN ordering: quickSolar → quickGrid →
nodeHomeLabel → quickConsumption).

- [ ] **fr.json — same two keys, French.** Insert after the `energy` block's `quickSolar` line:

```json
  "quickGrid": "Réseau",
  "nodeHomeLabel": "Maison",
```

(ordering: quickSolar → quickGrid → nodeHomeLabel → quickConsumption).

- [ ] **Verify JSON validity + key parity.** Run:
```
cd webapp && node -e "['en','de','fr'].forEach(l=>{const e=require('./messages/'+l+'.json').energy;['quickGrid','nodeHomeLabel'].forEach(k=>{if(!(k in e))throw new Error(l+' missing energy.'+k)});}); console.log('energy i18n parity OK')"
```
  Expected: `energy i18n parity OK`. (This mirrors the CI `i18n bundles` parity gate for the two
  new keys.)

- [ ] **CHANGELOG.md — add `[Unreleased]` entries.** Read the file, find the `## [Unreleased]`
  section, and add under `### Changed` (create the subsection if absent):

```markdown
- Redesigned the Energy dashboard for the Salbei/Leinen theme: flat linen cards (no glass), a
  re-skinned flow diagram with icon-badge nodes and marching dashed flux paths, theme-following
  energy-token chart colors with a dashed consumption line, a desktop stat column
  (yield/autarky/export), and a mobile compact Solar→Home→Grid flow with a battery bar. Honors
  `prefers-reduced-motion` (static dashes).
```

- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected: PASS (JSON + markdown only; no
  code change).
- [ ] Commit:
```
git add webapp/messages/en.json webapp/messages/de.json webapp/messages/fr.json CHANGELOG.md
git commit -m "i18n(energy): add quickGrid/nodeHomeLabel keys (EN/DE/FR) + changelog"
```

---

## Self-Review

**Scope item → task mapping**
1. EnergyFlow restyle (icon-badge nodes in energy tints, marching dashed paths, tokens, reduced
   motion) → **Task 2** (nodes + dashes + tokens) + **Task 1** (`marchDash` keyframe +
   reduced-motion guard). ✔
2. Mobile compact flow (Solar→House→Grid chevrons + battery bar; SVG diamond `md+`) → **Task 4**
   (`hidden md:block` for the SVG, `md:hidden` compact row + battery bar). ✔
3. Charts token theming + dashed consumption + flat tooltip → **Task 3** (power/energy/battery/mini
   charts + the driver's two `lines[]`; `dashed` flag on `ChartLine`; `bg-popover border elev-md`
   tooltips). ✔
3b. BatteryChart SoC threshold colors → **Task 3** (green=`--energy-battery`, amber=`--warning`,
   red=`--destructive`; functional behavior preserved). ✔
4. Driver EnergyCard restyle (GlassCard→Card, flow + stat column + history chart layout,
   month-primary→tokens, keep both Tabs + refresh Badge + data wiring) → **Task 4**. ✔
5. StatisticsCard hover border → **Task 5** (`hover:border-energy-solar/30`). ✔
6. page.tsx header icon badge `bg-month-primary/10`→primary → **Task 5** (via PageHeader prop or
   deferred — see below). ✔ / deferral flagged
7. globals.css `@keyframes marchDash` + reduced-motion guard → **Task 1**. ✔
8. Theme note (NOT dark-forced; theme-following) → documented in Goal/Architecture/Tech Stack
   above and in the `FLOW_COLOR` code comment (Task 2) and the battery-color comment (Task 3). ✔
9. Changelog + new i18n keys (EN/DE/FR parity; reuse existing stat keys) → **Task 6**. ✔

**Type-consistency check**
- `ChartLine.dashed?: boolean` added to both `power-chart.tsx` and `energy-chart.tsx`; the driver's
  `lines[]` literals that set `dashed: true` typecheck against the widened element type. The
  power-chart line carrying `calculated: { type: "grid_import" as const, ... }` is unchanged;
  adding a `dashed` sibling does not affect the `as const` narrowing. ✔
- `EnergyFlow` props/signature unchanged; only color sources (`FLOW_COLOR` token strings) and
  render layers change. `nodeColors` now returns `string | null` (token string or null) — same
  shape as before (was `string | null` hex). The `badge = color ?? "hsl(var(--muted-foreground))"`
  keeps a non-null `fill`/`color`. ✔
- `formatFlowKw` returns `string`; consumed only in JSX. `ChevronRight` is a `LucideIcon`. ✔
- `MiniChart` default color changes hex→token string; `gradientId` slugifies any string so the
  `url(#...)` reference stays DOM-valid. SVG `stop-color` / `stroke` accept `hsl(var(--x))`. ✔
- All new energy-token usages go through `hsl(var(--energy-*))` (SVG/Recharts inline) or Tailwind
  `bg-energy-*`/`text-energy-*` (DOM) — both resolve in light + dark; nothing is dark-forced. ✔

**Flagged deferrals**
- **Task 5, item 6 (PageHeader icon badge):** if `PageHeader` has no per-instance
  `iconBadgeClassName`-style prop, the `bg-month-primary/10` tint is shared across all routes and
  must NOT be edited in this energy-only plan — the shared badge token swap belongs to the
  Foundation/shell plan. The worker must READ `page-header.tsx` first and either pass the prop (if
  it exists) or record this single token as a Foundation-plan deferral. The route still meets the
  redesign otherwise.
- **`Sparkline`** (in `mini-chart.tsx`) keeps its `#3B82F6` hex default + `replace("#","")` — it is
  not used on the energy route; out of scope, left unchanged.
- **Deeper flow-geometry polish** (e.g. re-laying the diamond, animated SoC ring on the battery
  node, per-flow color-by-direction) is deferred — this plan restyles the existing node/path
  geometry, swaps the animation mechanism (dots→marching dashes), and themes colors, per the
  bounded scope.
- **Live visual smoke** (configured HA) is deferred to the user; verification here is
  lint + `tsc --noEmit` + structural self-review. The not-connected / not-configured empty states
  are restyled to flat `Card` and must render cleanly without HA — confirmed by the Task 4 edits
  touching all three states.
