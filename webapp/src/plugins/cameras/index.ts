import { Video } from "lucide-react";
import type { SurfacePlugin } from "../types";
import { useCameraSettings } from "@/hooks/use-cameras";

/** Returns the camera count, used for nav-gating. */
function useCameraCount(): { count: number | undefined; loading: boolean } {
  const { data: settings, isPending } = useCameraSettings();
  if (isPending) return { count: undefined, loading: true };
  return { count: settings?.cameras?.length ?? 0, loading: false };
}

export const camerasPlugin: SurfacePlugin = {
  id: "cameras",
  navItem: {
    href: "/cameras",
    icon: Video,
    labelKey: "cameras",
  },
  settingsItem: {
    href: "/settings/cameras",
    icon: Video,
    titleKey: "title",
    descriptionKey: "description",
  },
  dashboardWidget: undefined,
  isNavVisible: (ctx) => {
    if (ctx.ownDataLoading) return "loading";
    return (ctx.ownDataCount ?? 0) > 0;
  },
  useOwnDataCount: useCameraCount,
  i18nNamespace: "cameras",
};
