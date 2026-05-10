import { NAV_ITEMS } from "@/lib/constants";
import { applyNavOrder } from "@/lib/nav-order";
import { useHomeAssistantStatus } from "./use-home-assistant";
import { useIsPluginEnabled } from "./use-enabled-plugins";
import { useNavOrder } from "./use-nav-order";
import { PLUGINS } from "@/plugins/registry";
import type { NavGatingContext } from "@/plugins/types";

// Nav items that require Home Assistant to be connected before
// they make sense to show. Clicking any of these without HA returns
// an "Connect Home Assistant first" landing page — fine if the user
// got there from a deep link, but useless clutter in the bottom nav.
// /tesla removed — superseded by /vehicles (plugin-driven nav entry).
// /energy removed — superseded by energyPlugin (plugin-driven nav entry).
// /cameras removed — superseded by camerasPlugin (plugin-driven nav entry).
const HA_DEPENDENT_HREFS = new Set(["/home-automation"]);

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
  const navOrder = useNavOrder();

  // Call every plugin's useOwnDataCount in stable registry order.
  // PLUGINS is module-level + readonly (see plugins/registry.ts), so
  // hook count + order is stable across renders.
  const pluginCounts = PLUGINS.map((p) => ({
    id: p.id,
    href: p.navItem.href,
    ...p.useOwnDataCount(),
  }));

  // Call useIsPluginEnabled for each plugin in the same stable registry
  // order. PLUGINS is module-level + readonly, so hook call count is
  // invariant across renders — safe per Rules of Hooks.
  const pluginEnabledFlags = PLUGINS.map((p) => ({
    id: p.id,
    // eslint-disable-next-line react-hooks/rules-of-hooks
    enabled: useIsPluginEnabled(p.id),
  }));

  const haConnected = Boolean(haSettings?.url && haSettings?.access_token);

  const filtered = NAV_ITEMS.filter((item) => {
    if (HA_DEPENDENT_HREFS.has(item.href)) {
      if (haPending) return false;
      return haConnected;
    }

    // Plugin-contributed nav items: first check if the plugin is enabled
    // for this family, then defer to the plugin's own visibility predicate.
    const pluginEntry = pluginCounts.find((c) => c.href === item.href);
    if (pluginEntry) {
      const enabledFlag = pluginEnabledFlags.find((e) => e.id === pluginEntry.id)?.enabled ?? true;
      if (!enabledFlag) return false;
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
  });

  return applyNavOrder(filtered, navOrder) as unknown as typeof NAV_ITEMS;
}
