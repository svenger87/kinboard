"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useActiveLayout } from "@/hooks/use-active-layout";
import { useHomeData } from "@/hooks/use-home-data";
import { useKeyboardShortcuts, useSwipeNavigation, useThemeSettings } from "@/hooks";
import { useStartRedirect } from "@/hooks/use-device-owner";
import { homeDataNeeds } from "@/lib/home-data";
import type { Grid } from "@/lib/layouts/grid";
import { growToMinimums } from "@/lib/layouts/home-fit";
import type { HomeLayoutItem } from "@/lib/layouts/types";
import { WeatherEffects } from "@/components/weather-effects";
import { CreaturesOnHome } from "@/components/creatures-on-home";
import { FloatingLightsFab } from "@/components/floating-lights-fab";
import { ClockProvider } from "@/components/widgets/clock";
import { LayoutGrid } from "./layout-grid";
import { HomeDataProvider } from "./home-data-context";
import { HOME_WIDGET_COMPONENTS, missingHomeWidgets } from "./home-widgets";
import { HomeNoticesStrip } from "./home-notices-strip";

/**
 * Home as the family designed it (RFC-022 step 5), and the switch that
 * decides whether this screen draws it.
 *
 * The gate (§7.4): "Home with a layout ships when every widget can be
 * placed". Until every key of HOME_WIDGETS has a component in a box, no
 * screen draws a designed Home, whatever its layout says, and Home does not
 * even ask for layouts. The e2e specs open the gate on a dev server with
 * HOME_LAYOUT_TEST_KEY in localStorage; `process.env.NODE_ENV` is inlined
 * at build time, so in a production build the check is the constant `false`
 * and the key does nothing.
 */

/** The localStorage key that opens the gate on a dev server ("1"); see above. */
export const HOME_LAYOUT_TEST_KEY = "kinboard.test.home-layouts";

/** Every Home widget has a component in a box (§7.4). */
const ALL_WIDGETS_PLACEABLE = missingHomeWidgets().length === 0;

/** How long Home waits for the layout queries before it draws today's Home anyway. */
const LAYOUT_WAIT_MS = 4000;

const noSubscribe = () => () => {};

function readTestMode(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  try {
    return window.localStorage.getItem(HOME_LAYOUT_TEST_KEY) === "1";
  } catch {
    return false;
  }
}

/** The dev-server-only test mode of the gate: false on the server and in every production build. */
function useHomeLayoutTestMode(): boolean {
  return useSyncExternalStore(noSubscribe, readTestMode, () => false);
}

/**
 * Whether Home may draw a designed layout at all: the gate (every widget
 * placeable) or the test mode. Cheap and query-free; when it is false the
 * caller renders today's Home without asking for layouts.
 */
export function useHomeLayoutsOn(): boolean {
  const testMode = useHomeLayoutTestMode();
  const on = ALL_WIDGETS_PLACEABLE || testMode;
  // Set once the client has decided, i.e. after hydration: the server's HTML
  // is always today's Home, so a check that a screen keeps it means
  // something only from here on (e2e/layouts-home-live.spec.ts).
  useEffect(() => {
    document.documentElement.dataset.homeLayouts = on ? "on" : "off";
  }, [on]);
  return on;
}

type HomeChoice =
  | { kind: "wait" }
  | { kind: "builtIn" }
  | { kind: "designed"; items: HomeLayoutItem[]; grid: Grid };

/** Which Home this screen draws, once the gate is open (see useHomeLayoutsOn). */
function useHomeChoice(): HomeChoice {
  const active = useActiveLayout("home");
  // As on the screensaver: a kiosk with a layout must not show today's Home
  // first and then swap, so neither draws until the layout queries have
  // answered. Should that take longer than LAYOUT_WAIT_MS (a query failing
  // and retrying), today's Home comes, so the screen is never left empty.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (active.ready) return;
    const timer = setTimeout(() => setWaited(true), LAYOUT_WAIT_MS);
    return () => clearTimeout(timer);
  }, [active.ready]);
  if (active.grid && active.items.length > 0) return { kind: "designed", items: active.items, grid: active.grid };
  return active.ready || waited ? { kind: "builtIn" } : { kind: "wait" };
}

/**
 * Home with the gate open: the designed layout where this screen has one
 * (§3.6: a kiosk by its own layout or the family default, any other screen
 * only by its own, never below 600px), else `builtIn`, today's Home.
 */
export function HomeWithLayout({ builtIn }: { builtIn: ReactNode }) {
  const choice = useHomeChoice();
  const testMode = useHomeLayoutTestMode();
  if (choice.kind === "designed") return <DesignedHome items={choice.items} grid={choice.grid} placeholders={testMode} />;
  if (choice.kind === "wait") return <main id="main-content" className="min-h-page" aria-busy="true" data-testid="home-layout-wait" />;
  return builtIn;
}

/** Renders `children` unless this screen draws a designed Home (the compact/classic switch, §7.3). */
export function UnlessHomeLayout({ children }: { children: ReactNode }) {
  return useHomeLayoutsOn() ? <UnlessDesigned>{children}</UnlessDesigned> : children;
}

function UnlessDesigned({ children }: { children: ReactNode }) {
  const choice = useHomeChoice();
  return choice.kind === "builtIn" ? children : null;
}

/** A widget with no component in a box yet: only ever drawn in the test mode, so a spec can place every key. */
function MissingWidget({ item }: { item: HomeLayoutItem }) {
  return (
    <div
      data-home-widget-missing={item.widget}
      className="flex h-full w-full items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 text-sm text-muted-foreground"
    >
      {item.widget}
    </div>
  );
}

/**
 * The designed Home: the layout's widgets on its grid, which fills the
 * screen above the navigation bar and never scrolls (§7.1). The weather
 * effects, creatures on Home and the page's wash stay layers behind it; the
 * notices that come and go slide in over its top (§3.4) and never move it;
 * the floating lights button floats where it always does (§3.5).
 */
export function DesignedHome({
  items,
  grid,
  placeholders = false,
}: {
  items: HomeLayoutItem[];
  grid: Grid;
  /** Draw a placeholder for a widget with no component (the gate's test mode only). */
  placeholders?: boolean;
}) {
  const t = useTranslations("dashboard");
  const { showSeconds } = useThemeSettings();
  useKeyboardShortcuts();
  useSwipeNavigation();
  // A layout saved before the minimums followed the pixels can hold boxes
  // too small for their widget on this screen (a 2-step date on a portrait
  // panel is 18px tall): they are drawn grown to their minimum, with what is
  // below them moved down, as the designer's "Fit" would save them.
  const drawn = useMemo(() => growToMinimums(items, grid.width, grid.height).items, [items, grid.width, grid.height]);
  const widgetKeys = useMemo(() => items.map((i) => i.widget), [items]);
  const needs = useMemo(() => homeDataNeeds(widgetKeys), [widgetKeys]);
  const data = useHomeData(needs);
  // A screen that is not talked to has no messages widget (RFC-005 §6), as
  // today's Home shows the panel only with the messages card switched on.
  const talkedTo = widgetKeys.includes("messages");

  const start = useStartRedirect();
  if (start === "wait") {
    return <main id="main-content" className="min-h-page" aria-busy="true" data-testid="dashboard-start-wait" />;
  }

  return (
    <main
      id="main-content"
      data-testid="designed-home"
      className="relative overflow-hidden hide-status-bar"
      // The screen less the navigation bar: PageShell pads the bar's height
      // below, so the page is exactly the screen tall and nothing scrolls.
      style={{ height: "calc(100dvh - var(--nav-spacing))" }}
    >
      <div className="page-gradient pointer-events-none fixed inset-0 z-0" />
      <WeatherEffects />
      <CreaturesOnHome />
      <h1 className="sr-only">{t("ariaWidgets")}</h1>
      {/* One data source and one clock for every box: the clock, the date,
          the greeting and the today strip share its tick instead of each
          running a timer of its own. */}
      <HomeDataProvider value={data}>
        <ClockProvider showSeconds={showSeconds}>
        <section
          data-testid="designed-home-grid"
          // Not `festival-grid`: its direct children are taken for cards (the
          // festival dressing, the creatures' platforms), and here that would
          // be the one grid-sized wrapper of LayoutGrid.
          className="absolute inset-0 z-10"
          aria-label={t("ariaWidgets")}
        >
          <LayoutGrid
            grid={grid}
            items={drawn}
            surface="home"
            render={(item, box) => {
              const Widget = HOME_WIDGET_COMPONENTS[item.widget];
              if (Widget) return <Widget item={item} box={box} />;
              return placeholders ? <MissingWidget item={item} /> : null;
            }}
          />
        </section>
        </ClockProvider>
      </HomeDataProvider>
      <HomeNoticesStrip messages={talkedTo} />
      <FloatingLightsFab />
    </main>
  );
}
