import { Music } from "lucide-react";
import type { SurfacePlugin } from "../types";
import { useMediaPlayersCount } from "@/hooks/use-media-players";
import { MediaPlayerWidget } from "@/components/widgets/media-player-widget";

export const mediaPlugin: SurfacePlugin = {
  id: "media",
  navItem: { href: "/media", icon: Music, labelKey: "media" },
  settingsItem: {
    href: "/settings/media-players",
    icon: Music,
    titleKey: "settingsTitle",
    descriptionKey: "settingsDescription",
  },
  dashboardWidget: MediaPlayerWidget,
  isNavVisible: (ctx) => {
    if (ctx.ownDataLoading) return "loading";
    return (ctx.ownDataCount ?? 0) > 0;
  },
  useOwnDataCount: useMediaPlayersCount,
  i18nNamespace: "media",
};
