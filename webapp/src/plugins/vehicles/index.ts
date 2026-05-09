import { Car } from "lucide-react";
import type { SurfacePlugin } from "../types";
import { useVehiclesCount } from "@/hooks/use-vehicles";

export const vehiclesPlugin: SurfacePlugin = {
  id: "vehicles",
  navItem: {
    href: "/vehicles",
    icon: Car,
    labelKey: "vehicles",
  },
  settingsItem: {
    href: "/settings/vehicles",
    icon: Car,
    titleKey: "title",
    descriptionKey: "description",
  },
  // dashboardWidget added in Task 10 — kept undefined until then so the
  // dashboard doesn't import a not-yet-existing component.
  isNavVisible: (ctx) => {
    if (ctx.haLoading || ctx.ownDataLoading) return "loading";
    if (!ctx.haConnected) return false;
    return (ctx.ownDataCount ?? 0) > 0;
  },
  useOwnDataCount: useVehiclesCount,
  i18nNamespace: "vehicles",
};
