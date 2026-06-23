# Kinboard Redesign — Plan 13: Weather + Screensaver

> **For agentic workers:** Use superpowers:subagent-driven-development to execute this plan task-by-task. Steps use `- [ ]` checkboxes.

**Goal:** Finish the visual redesign of the two remaining surfaces — the weather detail **modal** (the `/weather` page was removed; weather lives in the dashboard widget + `WeatherModal`) and the kiosk photo **Screensaver** — to the "Salbei / Leinen" look.

**Architecture:** The weather modal (`weather-modal.tsx`) is already flat (uses `bg-muted/30` theme panels, not GlassCard) and already has every mockup piece (current hero + sun arc, hourly row + sparkline, radar map with layer tabs + legend, 5-day forecast). This plan is a light token pass on it. The screensaver (`screensaver.tsx`) is a full-bleed photo with overlays (glass-over-photo is allowed); it gains a **weather chip** (mockup wants weather top-right; currently absent), uses **PersonAvatar** for person-linked events, aligns the clock to Bricolage-light, and i18n's three hardcoded German section labels.

**Tech Stack:** Next.js 16, React 19, Tailwind, shadcn/ui, framer-motion, next-intl (EN+DE+FR), date-fns, Lucide.

## Global Constraints

- No `next build` locally. Per-task gate: `cd webapp && npm run lint` and `npx tsc --noEmit`. No unit tests — verification is lint+tsc+structural self-review; live smoke (needs Immich photos + configured weather) is deferred. No Jest/RTL/TDD steps.
- Reuse Foundation + Plan 2-12 components; never hardcode the month accent hex — use `primary`/tints. Functional weather colors (sun-arc gradient, clothing-tip tints, comfort scale, temp bars) and the `--weather-*`/`--energy-*` semantic tokens may stay (documented). Screensaver overlays sit OVER PHOTOS, so `text-white`/`bg-black/40` glass there is allowed.
- NO glass/backdrop-blur on app surfaces (the modal is already flat — keep it; the Dialog overlay itself is the modal scrim, leave it). Lucide stroke 1.75. Temps/times `tabular-nums`.
- Reduced-motion respected; the photo crossfade keyframes are unchanged.
- next-intl EN/DE/FR parity is a CI gate — every new key in all three.
- Commits: Conventional Commits, NO `Co-Authored-By: Claude` trailer. One commit per task.

### Grounding notes (verified by reading the files)
- `weather-modal.tsx` `month-primary` occurrences: icon badges at lines ~208-209, ~232-233, ~250-251; hourly hour-icon `text-month-primary` ~353; forecast today panel `bg-month-primary/10` ~397; forecast day-icon `text-month-primary` ~402; `HourlySparkline` gradient/stroke/dots `hsl(var(--month-primary))` ~574-598. Radar layer `Tabs` has a `h-8` override at ~295. Current-weather hero panel is `bg-muted/30 rounded-xl p-4` at ~247.
- `weather-modal.tsx` functional hex to KEEP: `tempBarColor` (~458), `getClothingTips` colors, `getComfortLevel` colors, `SunArc` `#fb923c/#fbbf24` gradient, `MapLegend` color ramps. The hourly precip uses `text-weather-rain` (token — keep).
- `screensaver.tsx`: NO `month-primary` usage (good). Hardcoded German labels: `"Nachrichten"` (~452), `"Termine"` (~737), `"Geburtstage"` (~774). Clock spans use `font-display font-extralight text-7xl landscape:lg:text-[8rem]` (~712-719). `upcomingEvents` memo (~396-412) captures `{id,title,start,allDay,location,color}` but NOT person name/avatar. `usePeople()` already loaded. The top-right stack currently holds the energy/tesla widget (~498); weather is NOT shown. The screensaver already imports many hooks from `@/hooks`; `useWeather` is exported there.
- `useWeather()` → `{ data: WeatherData | null }`; `WeatherData` fields include `temp:number`, `condition:string` (confirmed in earlier plans). Returns null when unconfigured → render nothing.
- `PersonAvatar` props `{ name, color, avatarUrl?, size?, ring?, className? }`. `Person` has `{ name, color, avatar_url }`.
- i18n namespaces: weather modal = `weather`; screensaver = `components.screensaver`.

---

### Task 1 — Weather modal: token swap + info-tint hero + drop Tabs h-8

**Files**
- Modify: `webapp/src/components/widgets/weather-modal.tsx`

**Interfaces**
- Consumes: existing hooks/props. Produces: same component, primary-tokened.

**Steps**
- [ ] Swap all `month-primary` → `primary` in this file: the three icon-badge blocks (`bg-month-primary/10` → `bg-primary/10`, `text-month-primary` → `text-primary` at ~208-209, ~232-233, ~250-251), the hourly hour-icon `text-month-primary` → `text-primary` (~353), the forecast today panel `bg-month-primary/10` → `bg-primary/10` (~397), the forecast day-icon `text-month-primary` → `text-primary` (~402), and in `HourlySparkline` every `hsl(var(--month-primary))` → `hsl(var(--primary))` (the gradient stops ~574-575, the polyline stroke ~585, and the circle fill ~598). Use find/replace for `month-primary` → `primary` across the file, then SPOT-CHECK that no functional hex (tempBar/clothing/comfort/SunArc/MapLegend) was touched (those have no `month-primary`).
- [ ] Drop the radar Tabs height override so it inherits the Foundation inset-segment: change `<TabsList className="h-8">` (~295) to `<TabsList>`. Leave the per-trigger `className="text-xs px-2"`.
- [ ] Give the current-weather hero an info tint per the mockup. Change the first hero panel (~247) from `className="bg-muted/30 rounded-xl p-4"` to `className="bg-gradient-to-br from-info/10 to-info/5 border border-info/10 rounded-xl p-4"`. Leave the other `bg-muted/30` panels (map, hourly, clothing, forecast) flat.
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected: PASS.
- [ ] Commit: `style(weather): primary tokens + info-tint hero + inset-segment radar tabs`

---

### Task 2 — Screensaver: weather chip + PersonAvatar events + Bricolage-light clock + i18n labels

**Files**
- Modify: `webapp/src/components/widgets/../screensaver.tsx`  (actual path: `webapp/src/components/screensaver.tsx`)

**Interfaces**
- Consumes: `useWeather` (from `@/hooks`), `PersonAvatar` (`@/components/person-avatar`).
- Produces: a top-right weather chip (temp + condition icon, renders nothing when weather null), person-avatar event rows, lighter clock weight, and `t()`-driven section labels.

**Steps**
- [ ] Add imports. In the `@/hooks` import (line ~8) add `useWeather`. Add `import { PersonAvatar } from "@/components/person-avatar";` near the other component imports. Add `CloudRain, CloudSnow, CloudLightning` to the lucide import (line ~11) if not present (it already imports `Sun, Cloud` — confirm; add the missing rain/snow/thunder icons).
- [ ] Add a small condition→icon helper above the `Screensaver` component (mirror the KioskStatusBar mapping):
  ```tsx
  function screensaverWeatherIcon(condition: string) {
    const c = condition.toLowerCase();
    if (c.includes("thunder") || c.includes("gewitter")) return CloudLightning;
    if (c.includes("snow") || c.includes("schnee")) return CloudSnow;
    if (c.includes("rain") || c.includes("regen") || c.includes("drizzle") || c.includes("niesel")) return CloudRain;
    if (c.includes("clear") || c.includes("klar") || c.includes("sun") || c.includes("sonn")) return Sun;
    return Cloud;
  }
  ```
- [ ] Read weather in the component body (near the other hooks, ~line 119): `const { data: weather } = useWeather();` and `const WeatherIcon = weather ? screensaverWeatherIcon(weather.condition) : null;`
- [ ] Render a weather chip in the top-right area. Insert it as the FIRST child of the top-right stack — i.e. directly before the `{(showEnergyWidget || showTeslaWidget) && (` block (~498), as its own absolutely-positioned element so it shows even without energy/tesla:
  ```tsx
  {/* Weather chip - top right (renders nothing when weather unconfigured) */}
  {weather && WeatherIcon && (
    <div
      className="absolute top-4 right-4 landscape:lg:top-12 landscape:lg:right-12 safe-area-inset screensaver-slide-down"
      style={{ animationDelay: "0.85s" }}
    >
      <div className="flex items-center gap-3 bg-black/40 rounded-xl px-4 py-2.5">
        <WeatherIcon className="size-7 text-white" strokeWidth={1.75} />
        <span className="font-display font-light text-3xl text-white tabular-nums leading-none">
          {Math.round(weather.temp)}°
        </span>
      </div>
    </div>
  )}
  ```
  Then move the existing energy/tesla widget down so the two don't overlap: change the energy/tesla wrapper's top offset from `top-4 ... landscape:lg:top-12` to `top-20 ... landscape:lg:top-28` (so it stacks below the weather chip). (If only one of weather/energy shows, the gap is harmless.)
- [ ] Lighten the clock to Bricolage 300. In the three clock spans (~712, ~715, ~718) change `font-extralight` → `font-light`. (Leave sizes/`clock-display`/`tracking-tighter`.)
- [ ] Use PersonAvatar for person-linked events. First extend the `upcomingEvents` memo (~396-412) to capture the person: inside `.map`, after resolving `person`, return additionally `personName: person?.name ?? null, personColor: person?.color ?? null, personAvatar: person?.avatar_url ?? null` (keep the existing `color` fallback). Then in the event row (~741-748) replace the color bar:
  ```tsx
  <div className="w-1 h-8 rounded-full shrink-0" style={{ backgroundColor: event.color }} />
  ```
  with a PersonAvatar when a person is linked, else the bar:
  ```tsx
  {event.personName ? (
    <PersonAvatar name={event.personName} color={event.personColor ?? event.color} avatarUrl={event.personAvatar} size={32} className="shrink-0" />
  ) : (
    <div className="w-1 h-8 rounded-full shrink-0" style={{ backgroundColor: event.color }} />
  )}
  ```
- [ ] i18n the three hardcoded German section labels. Replace `Nachrichten` (~452) with `{t("newsLabel")}`, `Termine` (~737) with `{t("eventsLabel")}`, `Geburtstage` (~774) with `{t("birthdaysLabel")}`. Add these keys to ALL THREE locales under `components.screensaver` (en: "News"/"Events"/"Birthdays"; de: "Nachrichten"/"Termine"/"Geburtstage"; fr: "Actualités"/"Événements"/"Anniversaires").
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected: PASS. Confirm `newsLabel`/`eventsLabel`/`birthdaysLabel` present in en/de/fr.
- [ ] Commit: `feat(screensaver): weather chip + person-avatar events + Bricolage-light clock + i18n labels`

---

### Task 3 — Changelog + final parity

**Files**
- Modify: `CHANGELOG.md`

**Steps**
- [ ] Under `## [Unreleased]`, add to `### Changed` (and `### Added` for the new weather chip): the weather modal restyle (primary tokens, info-tint hero, inset-segment radar tabs) and the screensaver redesign (weather chip, person-avatar events, lighter clock, localized section labels — previously hardcoded German). One line each, self-hoster-facing.
- [ ] `cd webapp && npm run lint && npx tsc --noEmit` — Expected: PASS. Confirm full en/de/fr key parity (identical key sets).
- [ ] Commit: `docs(changelog): weather modal + screensaver redesign`

---

## Self-Review

- **Scope → task:** weather modal tokens/hero/tabs → Task 1; screensaver weather chip + PersonAvatar events + clock weight + i18n labels → Task 2; changelog + parity → Task 3.
- **Type consistency:** `useWeather()` returns `{data: WeatherData|null}`; chip guards on `weather && WeatherIcon`, reads `weather.temp`/`.condition` (both confirmed fields). `PersonAvatar` takes `{name,color,avatarUrl?,size}` — the extended `upcomingEvents` supplies `personName/personColor/personAvatar` (string|null) with the existing `event.color` as the color fallback. New lucide icons (`CloudRain/CloudSnow/CloudLightning`) added to the import.
- **Constraints:** no `month-primary` left in weather-modal after Task 1; functional weather hex untouched; screensaver overlays are over-photo (white/black glass allowed); no new app-surface glass; clock uses `font-display font-light` (Bricolage 300). i18n parity maintained (3 new screensaver keys ×3 locales).
- **Deferrals:** the screensaver keeps its richer-than-mockup news/energy/tesla overlays (existing features — not removed); the radar "rain blobs + time scrubber" in the mockup is the existing Leaflet `WeatherMap` precipitation layer (already present, not rebuilt); live smoke (Immich photos + weather) deferred.
