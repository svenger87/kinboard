"use client";

import { useEffect, useState } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { useTranslations } from "next-intl";
import { GripVertical, ListOrdered, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { useVisibleNavItems } from "@/hooks/use-visible-nav-items";
import { setNavOrder, clearNavOrder } from "@/lib/nav-order";

export default function NavigationSettingsPage() {
  const t = useTranslations("settings.navigation");
  const tNav = useTranslations("nav");
  const visibleItems = useVisibleNavItems();

  // Local working copy. Initialized from useVisibleNavItems (which already
  // reflects the saved order); subsequent drags update local state, and
  // we persist on each commit so the bottom nav reflects the change live.
  const [order, setOrder] = useState<readonly string[]>(() =>
    visibleItems.map((i) => i.href),
  );

  // Sync if upstream visibility changes (e.g., a plugin gets toggled
  // in another tab). Only resets the order when the underlying set
  // changes — preserves an in-progress drag otherwise.
  useEffect(() => {
    const visibleSet = new Set(visibleItems.map((i) => i.href));
    const currentSet = new Set(order);
    const same =
      visibleSet.size === currentSet.size &&
      [...visibleSet].every((h) => currentSet.has(h));
    if (!same) setOrder(visibleItems.map((i) => i.href));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems]);

  const handleReorder = (next: string[]) => {
    setOrder(next);
    setNavOrder(next);
  };

  const handleReset = () => {
    clearNavOrder();
    setOrder(visibleItems.map((i) => i.href));
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
      className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset"
    >
      <div className="relative z-10 max-w-2xl mx-auto space-y-6">
        <PageHeader
          title={t("title")}
          icon={ListOrdered}
          backHref="/settings"
        />

        <p className="text-sm text-muted-foreground">{t("intro")}</p>

        <Card className="p-2">
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
                  Icon={item.icon}
                  label={tNav(item.labelKey as never)}
                />
              );
            })}
          </Reorder.Group>
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

function NavItemRow({
  href,
  Icon,
  label,
}: {
  href: string;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  // Per-item dragControls + dragListener=false constrains the drag
  // affordance to the explicit handle, so taps on the row body don't
  // accidentally pick up a drag (matters on touch).
  const controls = useDragControls();

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
        aria-label="Drag to reorder"
      >
        <GripVertical className="size-4" />
      </button>
      <Icon className="size-5" />
      <span className="text-sm font-medium">{label}</span>
      <span className="ml-auto text-xs text-muted-foreground">{href}</span>
    </Reorder.Item>
  );
}
