import { useMemo } from "react";
import { NAV_ITEMS } from "@/lib/constants";
import { useHomeAssistantStatus } from "./use-home-assistant";
import { useCameraSettings } from "./use-cameras";

// Nav items that require Home Assistant to be connected before
// they make sense to show. Clicking any of these without HA returns
// an "Connect Home Assistant first" landing page — fine if the user
// got there from a deep link, but useless clutter in the bottom nav.
const HA_DEPENDENT_HREFS = new Set(["/home-automation", "/energy", "/tesla"]);

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
 */
export function useVisibleNavItems(): typeof NAV_ITEMS {
  const { data: haSettings, isPending: haPending } = useHomeAssistantStatus();
  const { data: cameraSettings, isPending: camerasPending } = useCameraSettings();

  return useMemo(() => {
    const haConnected = Boolean(haSettings?.url && haSettings?.access_token);
    const hasAnyCamera = Boolean(cameraSettings?.cameras?.length);

    return NAV_ITEMS.filter((item) => {
      if (HA_DEPENDENT_HREFS.has(item.href)) {
        // While the HA status query is in flight on a fresh page load,
        // hide rather than flash. The query resolves in <100 ms.
        if (haPending) return false;
        return haConnected;
      }
      if (CAMERA_DEPENDENT_HREFS.has(item.href)) {
        if (camerasPending) return false;
        return hasAnyCamera;
      }
      return true;
    }) as unknown as typeof NAV_ITEMS;
  }, [haSettings, haPending, cameraSettings, camerasPending]);
}
