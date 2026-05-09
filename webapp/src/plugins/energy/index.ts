import { Zap } from "lucide-react";
import type { SurfacePlugin } from "../types";
import { useEnergyConfig } from "@/hooks";
import { useHomeAssistantStatus } from "@/hooks/use-home-assistant";
import { genericHaEnergyDriver } from "./drivers/generic-ha-energy";

/** Returns 1 if at least one core energy sensor is configured, else 0. */
function useEnergyConfigured(): { count: number | undefined; loading: boolean } {
  const { data: haSettings, isPending } = useHomeAssistantStatus();
  const energyConfig = useEnergyConfig();
  if (isPending) return { count: undefined, loading: true };
  const configured = genericHaEnergyDriver.isConfigured(energyConfig);
  return { count: configured ? 1 : 0, loading: false };
}

export const energyPlugin: SurfacePlugin = {
  id: "energy",
  navItem: {
    href: "/energy",
    icon: Zap,
    labelKey: "energy",
  },
  settingsItem: {
    href: "/settings/energy",
    icon: Zap,
    titleKey: "title",
    descriptionKey: "description",
  },
  dashboardWidget: undefined,
  isNavVisible: (ctx) => {
    if (ctx.haLoading) return "loading";
    if (!ctx.haConnected) return false;
    if (ctx.ownDataLoading) return "loading";
    return (ctx.ownDataCount ?? 0) > 0;
  },
  useOwnDataCount: useEnergyConfigured,
  i18nNamespace: "energy",
};
