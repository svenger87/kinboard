import { Car } from "lucide-react";
import type { SurfacePlugin } from "../types";
import { useVehiclesCount } from "@/hooks/use-vehicles";
import { VehiclesWidget } from "@/components/widgets/vehicles-widget";

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
  dashboardWidget: VehiclesWidget,
  isNavVisible: (ctx) => {
    if (ctx.ownDataLoading) return "loading";
    return (ctx.ownDataCount ?? 0) > 0;
  },
  useOwnDataCount: useVehiclesCount,
  i18nNamespace: "vehicles",
};
