"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Home, CalendarDays, ShoppingCart, MoreHorizontal } from "lucide-react";
import { isNoNavPath } from "@/lib/constants";
import { useNavBadges } from "@/hooks/use-nav-badges";
import { useVisibleNavItems } from "@/hooks/use-visible-nav-items";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme-toggle";

const FIXED_HREFS = new Set(["/", "/calendar", "/shopping"]);

export function MobileNav() {
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const router = useRouter();
  const badges = useNavBadges();
  const navItems = useVisibleNavItems();
  const [moreOpen, setMoreOpen] = useState(false);

  // Remaining routes for the "Mehr" sheet: everything visible that isn't a
  // fixed tab, in the per-device order useVisibleNavItems already applied.
  const moreItems = useMemo(
    () => navItems.filter((item) => !FIXED_HREFS.has(item.href)),
    [navItems]
  );

  const startActive = pathname === "/";
  const calendarActive = pathname === "/calendar" || pathname.startsWith("/calendar/");
  const shoppingActive = pathname === "/shopping" || pathname.startsWith("/shopping/");
  const moreActive = !startActive && !calendarActive && !shoppingActive;

  if (isNoNavPath(pathname)) {
    return null;
  }

  const tabClass = (active: boolean) =>
    `relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${
      active ? "text-primary" : "text-muted-foreground"
    }`;

  const fixedTabs = [
    { href: "/", icon: Home, labelKey: "home", active: startActive },
    { href: "/calendar", icon: CalendarDays, labelKey: "calendar", active: calendarActive },
    { href: "/shopping", icon: ShoppingCart, labelKey: "shopping", active: shoppingActive },
  ];

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch border-t border-border bg-card"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        aria-label={tNav("mobile")}
      >
        {fixedTabs.map((tab) => {
          const Icon = tab.icon;
          const badge = badges[tab.href];
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={tab.active ? "page" : undefined}
              aria-label={tNav(tab.labelKey)}
              className={tabClass(tab.active)}
            >
              <span className="relative">
                <Icon size={23} strokeWidth={1.75} />
                {badge && !tab.active && (
                  <span
                    className="absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-3xs font-bold text-primary-foreground"
                    aria-label={tCommon("newEntriesAria", { count: badge })}
                  >
                    {badge}
                  </span>
                )}
              </span>
              <span className={`text-3xs ${tab.active ? "font-semibold" : "font-medium"}`}>
                {tNav(tab.labelKey)}
              </span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          aria-label={tNav("more")}
          className={tabClass(moreActive)}
        >
          <MoreHorizontal size={23} strokeWidth={1.75} />
          <span className={`text-3xs ${moreActive ? "font-semibold" : "font-medium"}`}>
            {tNav("more")}
          </span>
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-2xl bg-card border-border">
          <SheetHeader>
            {/* The theme toggle lives only in DesktopNav, which is `hidden md:block`
                — so on a phone the control exists in the DOM but is never visible,
                and light/dark can only be reached via Settings → Design (audit
                KB-33). The "More" sheet is the phone's equivalent surface. */}
            <div className="flex items-center justify-between gap-3 pr-6">
              <SheetTitle>{tNav("more")}</SheetTitle>
              <ThemeToggle />
            </div>
          </SheetHeader>
          <ul className="mt-4 grid grid-cols-2 gap-2 pb-2">
            {moreItems.map((item) => {
              const Icon = item.icon;
              const badge = badges[item.href];
              const active =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href + "/"));
              return (
                <li key={item.href}>
                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      router.push(item.href);
                    }}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-border bg-card px-4 text-left transition-colors hover:bg-accent ${
                      active ? "text-primary" : "text-foreground"
                    }`}
                  >
                    <Icon size={22} strokeWidth={1.75} className="shrink-0" />
                    <span className="flex-1 truncate text-sm font-medium">
                      {tNav(item.labelKey)}
                    </span>
                    {badge && (
                      <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-2xs font-bold text-primary-foreground tabular-nums">
                        {badge}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
