import { NAV_ITEMS } from "@/lib/constants";
import { useHomeAssistantStatus } from "./use-home-assistant";
import { useCameraSettings } from "./use-cameras";
import { PLUGINS } from "@/plugins/registry";
import type { NavGatingContext } from "@/plugins/types";

// Nav items that require Home Assistant to be connected before
// they make sense to show. Clicking any of these without HA returns
// an "Connect Home Assistant first" landing page — fine if the user
// got there from a deep link, but useless clutter in the bottom nav.
// /tesla removed — superseded by /vehicles which is now a plugin-driven nav entry.
const HA_DEPENDENT_HREFS = new Set(["/home-automation", "/energy"]);

// Nav items that require at least one configured entity in their
// own DB-backed settings row.
const CAMERA_DEPENDENT_HREFS = new Set(["/cameras"]);

/**
 * Returns NAV_ITEMS filtered to only what's actually usable for the
 * current family's configuration. Direct URL access (typed link,
 * bookmark) still works — pages just render their own
 * "Connect this integration first" state. The filter only governs
 * which items appear in the bottom navigation.
 *
 * Predicate intentionally errs toward *showing* an item when state
 * is still loading: better to render a stale-but-correct nav than to
 * flash items in/out as queries resolve. The HA status query already
 * returns `null` quickly for unconfigured installs.
 *
 * Plugin-contributed nav items are evaluated by each plugin's
 * `isNavVisible` predicate. PLUGINS is module-level + readonly, so
 * iterating it in a fixed order inside this hook is safe — hook call
 * count never changes between renders. See SurfacePlugin.useOwnDataCount
 * for the Rules-of-Hooks invariant.
 */
export function useVisibleNavItems(): typeof NAV_ITEMS {
  const { data: haSettings, isPending: haPending } = useHomeAssistantStatus();
  const { data: cameraSettings, isPending: camerasPending } = useCameraSettings();

  // Call every plugin's useOwnDataCount in stable registry order.
  // PLUGINS is module-level + readonly (see plugins/registry.ts), so
  // hook count + order is stable across renders.
  const pluginCounts = PLUGINS.map((p) => ({
    id: p.id,
    href: p.navItem.href,
    ...p.useOwnDataCount(),
  }));

  const haConnected = Boolean(haSettings?.url && haSettings?.access_token);
  const hasAnyCamera = Boolean(cameraSettings?.cameras?.length);

  return NAV_ITEMS.filter((item) => {
    if (HA_DEPENDENT_HREFS.has(item.href)) {
      if (haPending) return false;
      return haConnected;
    }
    if (CAMERA_DEPENDENT_HREFS.has(item.href)) {
      if (camerasPending) return false;
      return hasAnyCamera;
    }

    // Plugin-contributed nav items: defer to the plugin's predicate.
    const pluginEntry = pluginCounts.find((c) => c.href === item.href);
    if (pluginEntry) {
      const plugin = PLUGINS.find((p) => p.id === pluginEntry.id)!;
      const ctx: NavGatingContext = {
        haConnected,
        haLoading: haPending,
        ownDataCount: pluginEntry.count,
        ownDataLoading: pluginEntry.loading,
      };
      const result = plugin.isNavVisible(ctx);
      return result === true;
    }

    return true;
  }) as unknown as typeof NAV_ITEMS;
}
