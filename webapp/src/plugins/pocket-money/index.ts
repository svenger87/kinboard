import { PiggyBank } from "lucide-react";
import type { SurfacePlugin } from "../types";
import { usePocketMoneyAccountsCount } from "@/hooks/use-pocket-money-accounts";
import { PocketMoneyWidget } from "@/components/widgets/pocket-money-widget";

export const pocketMoneyPlugin: SurfacePlugin = {
  id: "pocket-money",
  navItem: {
    href: "/pocket-money",
    icon: PiggyBank,
    labelKey: "pocketMoney",
  },
  settingsItem: {
    href: "/settings/pocket-money",
    icon: PiggyBank,
    titleKey: "title",
    descriptionKey: "description",
  },
  dashboardWidget: PocketMoneyWidget,
  isNavVisible: (ctx) => {
    if (ctx.ownDataLoading) return "loading";
    return (ctx.ownDataCount ?? 0) > 0;
  },
  useOwnDataCount: usePocketMoneyAccountsCount,
  i18nNamespace: "pocketMoney",
};
