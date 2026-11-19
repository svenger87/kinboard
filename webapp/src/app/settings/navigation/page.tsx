"use client";

import { useEffect, useState } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { useTranslations } from "next-intl";
import { GripVertical, ListOrdered, Pin, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { useVisibleNavItems } from "@/hooks/use-visible-nav-items";
import { setNavOrder, clearNavOrder } from "@/lib/nav-order";
import { canHideNavItem, getHiddenNavItems, setHiddenNavItems, setSettingsIconOnly } from "@/lib/nav-visibility";
import { useHiddenNavItems, useSettingsIconOnly } from "@/hooks/use-hidden-nav-items";
import { Switch } from "@/components/ui/switch";
import { useFamilyStore } from "@/stores/family-store";
import { navEntryLabel } from "@/lib/constants";

export default function NavigationSettingsPage() {
  const t = useTranslations("settings.navigation");
  const tNav = useTranslations("nav");
  const visibleItems = useVisibleNavItems(true);
  const hiddenItems = useHiddenNavItems();
  const settingsIconOnly = useSettingsIconOnly();
  const { device } = useFamilyStore();
  const isKiosk = device?.is_kiosk ?? false;

  // Home is not part of the arrangement: both navs pin it at the front of
  // the bar, outside the scrolling row (DesktopNav: a centred active item
  // otherwise pushed it off the left edge). Listing it as an ordinary
  // draggable row let a saved order put another item first — an order the
  // bar then silently overrode. It is shown pinned at the top instead,
  // and every order saved here starts with it.
  const homeItem = visibleItems.find((i) => i.href === "/");
  const draggableItems = visibleItems.filter((i) => i.href !== "/");

  // Local working copy. Initialized from useVisibleNavItems (which already
  // reflects the saved order); subsequent drags update local state, and
  // we persist on each commit so the bottom nav reflects the change live.
  const [order, setOrder] = useState<readonly string[]>(() =>
    draggableItems.map((i) => i.href),
  );

  // Sync if upstream visibility changes (e.g., a plugin gets toggled
  // in another tab). Only resets the order when the underlying set
  // changes — preserves an in-progress drag otherwise.
  useEffect(() => {
    const visibleSet = new Set(draggableItems.map((i) => i.href));
    const currentSet = new Set(order);
    const same =
      visibleSet.size === currentSet.size &&
      [...visibleSet].every((h) => currentSet.has(h));
    if (!same) setOrder(draggableItems.map((i) => i.href));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems]);

  const handleReorder = (next: string[]) => {
    setOrder(next);
    setNavOrder(["/", ...next]);
  };

  const handleReset = () => {
    clearNavOrder();
    setOrder(draggableItems.map((i) => i.href));
  };

  // Map key explicitly widened to `string` — visibleItems is `typeof
  // NAV_ITEMS` whose element type carries href as a literal-union, and
  // `.get(href)` with `href: string` would otherwise fail to type-check.
  const itemsByHref = new Map<string, (typeof visibleItems)[number]>(
    visibleItems.map((i) => [i.href, i]),
  );

  return (
    <main
      id="main-content"
      className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset"
    >
      <div className="relative z-10 max-w-2xl mx-auto space-y-6">
        <PageHeader
          title={t("title")}
          icon={ListOrdered}
        />

        <p className="text-sm text-muted-foreground">{t("intro")}</p>

        <Card className="p-2">
          {homeItem && (
            <PinnedNavItemRow
              Icon={homeItem.icon}
              label={navEntryLabel(homeItem, tNav)}
              enabled={!hiddenItems.includes("/")}
            />
          )}
          <Reorder.Group
            axis="y"
            values={order as string[]}
            onReorder={handleReorder}
            className="space-y-1"
          >
            {order.map((href) => {
              const item = itemsByHref.get(href);
              if (!item) return null;
              return (
                <NavItemRow
                  key={href}
                  href={href}
                  isKiosk={isKiosk}
                  Icon={item.icon}
                  label={navEntryLabel(item, tNav)}
                  enabled={!hiddenItems.includes(href)}
                  onEnabledChange={(enabled) => {
                    const next = new Set(getHiddenNavItems());
                    if (enabled) next.delete(href);
                    else next.add(href);
                    setHiddenNavItems([...next]);
                  }}
                />
              );
            })}
          </Reorder.Group>
        </Card>
        <p className="text-xs text-muted-foreground">
          {t(isKiosk ? "fixedItemsHintKiosk" : "fixedItemsHint")}
        </p>

        <Card id="settings-icon" data-setting="settings-icon" className="flex items-center justify-between gap-4 p-4">
          <div>
            <p className="font-medium">{t("settingsIconOnly")}</p>
            <p className="text-sm text-muted-foreground">{t("settingsIconOnlyHint")}</p>
          </div>
          <Switch checked={settingsIconOnly} onCheckedChange={setSettingsIconOnly} aria-label={t("settingsIconOnly")} />
        </Card>

        <Button
          variant="outline"
          onClick={handleReset}
          className="w-full"
        >
          <RotateCcw className="size-4 mr-2" />
          {t("reset")}
        </Button>

        <p className="text-xs text-muted-foreground">{t("perDeviceHint")}</p>
      </div>
    </main>
  );
}

/**
 * Home's row: same shape as a draggable row, but with a pin where the
 * drag handle would be — Home always sits at the front of the bar, so
 * there is nothing to arrange. Its switch is disabled (Home is in
 * ALWAYS_SHOWN_NAV_ITEMS), exactly as it was when the row was draggable.
 */
function PinnedNavItemRow({
  Icon,
  label,
  enabled,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  enabled: boolean;
}) {
  const t = useTranslations("settings.navigation");

  return (
    <div className="flex items-center gap-3 rounded-md bg-white/[0.02] px-3 py-2 select-none mb-1">
      <span className="text-muted-foreground p-1 -ml-1" aria-hidden="true">
        <Pin className="size-4" />
      </span>
      <Icon className="size-5" />
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{t("homeAlwaysFirst")}</span>
      <Switch className="ml-auto" checked={enabled} disabled aria-label={t("showItem", { label })} />
    </div>
  );
}

function NavItemRow({
  href,
  Icon,
  label,
  enabled,
  isKiosk,
  onEnabledChange,
}: {
  href: string;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  enabled: boolean;
  isKiosk: boolean;
  onEnabledChange: (enabled: boolean) => void;
}) {
  // Per-item dragControls + dragListener=false constrains the drag
  // affordance to the explicit handle, so taps on the row body don't
  // accidentally pick up a drag (matters on touch).
  const controls = useDragControls();
  const t = useTranslations("settings.navigation");

  return (
    <Reorder.Item
      value={href}
      dragListener={false}
      dragControls={controls}
      className="flex items-center gap-3 rounded-md bg-white/[0.02] hover:bg-accent/50 px-3 py-2 select-none"
    >
      <button
        type="button"
        onPointerDown={(e) => controls.start(e)}
        className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground p-1 -ml-1"
        aria-label={t("dragToReorder")}
      >
        <GripVertical className="size-4" />
      </button>
      <Icon className="size-5" />
      <span className="text-sm font-medium">{label}</span>
      <Switch className="ml-auto" checked={enabled} onCheckedChange={onEnabledChange} disabled={!canHideNavItem(href, isKiosk)} aria-label={t("showItem", { label })} />
    </Reorder.Item>
  );
}
