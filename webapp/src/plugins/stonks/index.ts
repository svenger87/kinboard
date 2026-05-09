import { LineChart } from "lucide-react";
import type { SurfacePlugin } from "../types";
import { useTickersCount } from "@/hooks/use-tickers";

export const stonksPlugin: SurfacePlugin = {
  id: "stonks",
  navItem: {
    href: "/stonks",
    icon: LineChart,
    labelKey: "stonks",
  },
  settingsItem: {
    href: "/settings/stonks",
    icon: LineChart,
    titleKey: "title",
    descriptionKey: "description",
  },
  isNavVisible: (ctx) => {
    if (ctx.ownDataLoading) return "loading";
    return (ctx.ownDataCount ?? 0) > 0;
  },
  useOwnDataCount: useTickersCount,
  i18nNamespace: "stonks",
};
