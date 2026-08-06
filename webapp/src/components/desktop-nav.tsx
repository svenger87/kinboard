"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ThemeToggle } from "@/components/theme-toggle";
import { isNoNavPath } from "@/lib/constants";
import { useVisibleNavItems } from "@/hooks/use-visible-nav-items";
import { useNavBadges } from "@/hooks/use-nav-badges";

export function DesktopNav() {
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const badges = useNavBadges();
  const navItems = useVisibleNavItems();

  const updateScrollIndicators = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  // Auto-scroll active item into view on route change
  useEffect(() => {
    const el = activeRef.current;
    if (el) {
      el.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    }
    const timer = setTimeout(updateScrollIndicators, 350);
    return () => clearTimeout(timer);
  }, [pathname, updateScrollIndicators]);

  // Track scroll position for gradient indicators
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollIndicators();
    el.addEventListener("scroll", updateScrollIndicators, { passive: true });
    return () => el.removeEventListener("scroll", updateScrollIndicators);
  }, [updateScrollIndicators]);

  if (isNoNavPath(pathname)) {
    return null;
  }

  return (
    <nav
      className="hidden md:block fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border py-3"
      aria-label={tNav("main")}
    >
      {/* Scroll fade indicators */}
      <div
        className="pointer-events-none absolute top-0 bottom-0 w-8 z-10 transition-opacity duration-200 left-[8.5rem] lg:left-[10.5rem]"
        aria-hidden="true"
        style={{
          opacity: canScrollLeft ? 1 : 0,
          background: "linear-gradient(to right, hsl(var(--card)), transparent)",
        }}
      />
      <div
        className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 z-10 transition-opacity duration-200"
        aria-hidden="true"
        style={{
          opacity: canScrollRight ? 1 : 0,
          background: "linear-gradient(to left, hsl(var(--card)), transparent)",
        }}
      />

      {/* Home is pinned outside the scroll container. Inside it, `scrollIntoView`
          on route change centres the active item, which pushed Home off the left
          edge on deeper routes — on a kiosk with no browser chrome and no back
          button that left no way home (audit KB-22). MobileNav already treats
          Home as fixed; this brings the wall in line. */}
      {(() => {
        const home = navItems.find((i) => i.href === "/");
        if (!home) return null;
        const HomeIcon = home.icon;
        const isActive = pathname === "/";
        return (
          <div className="absolute left-0 top-0 bottom-0 z-20 flex items-center pl-4 pr-2 bg-card">
            <Link
              href="/"
              aria-current={isActive ? "page" : undefined}
              className={`group relative flex min-h-[44px] flex-shrink-0 items-center gap-2 rounded-full px-4 py-2 transition-colors duration-200 lg:min-h-[48px] lg:px-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                isActive ? "bg-primary/[0.12] text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <HomeIcon className="size-4 lg:size-5" strokeWidth={1.75} />
              <span className="whitespace-nowrap text-sm font-medium lg:text-base">
                {tNav(home.labelKey)}
              </span>
              {isActive && (
                <div className="absolute -bottom-0.5 left-1/2 h-[3px] w-8 -translate-x-1/2 rounded-full bg-primary" />
              )}
            </Link>
            <div className="ml-2 h-6 w-px bg-border" aria-hidden="true" />
          </div>
        );
      })()}

      <div
        ref={scrollRef}
        className="flex items-center overflow-x-auto scrollbar-hide pl-[8.5rem] pr-4 lg:pl-[10.5rem] gap-2 overscroll-x-contain touch-pan-x"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            scrollRef.current?.scrollBy({
              left: e.key === "ArrowRight" ? 120 : -120,
              behavior: "smooth",
            });
          }
        }}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {navItems.filter((item) => item.href !== "/").map((item) => {
          // Home is rendered separately above, so the old `href !== "/"` guard
          // here is now unreachable. Matching on `href + "/"` rather than a bare
          // prefix also stops "/settings" claiming a hypothetical "/settings-x".
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              ref={isActive ? activeRef : undefined}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              // 44px minimum, 48px on kiosk-width displays. These were 36px tall
              // with 14px labels — the single largest cluster of undersized
              // targets in the audit (3,840 hits), on the product's primary
              // device, while MobileNav already enforced 44px (KB-22).
              className={`group relative min-h-[44px] lg:min-h-[48px] px-4 lg:px-5 py-2 rounded-full transition-colors duration-200 flex items-center gap-2 flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                isActive
                  ? "bg-primary/[0.12] text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <span className="relative">
                <Icon className="size-4 lg:size-5" strokeWidth={1.75} />
                {badges[item.href] && !isActive && (
                  <span
                    className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-primary text-3xs font-bold text-primary-foreground px-1"
                    aria-label={tCommon("newEntriesAria", { count: badges[item.href] })}
                  >
                    {badges[item.href]}
                  </span>
                )}
              </span>
              <span className="whitespace-nowrap text-sm font-medium lg:text-base">{tNav(item.labelKey)}</span>
              {isActive && (
                <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-8 h-[3px] bg-primary rounded-full" />
              )}
            </Link>
          );
        })}
        <div className="flex-shrink-0 ml-2">
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
