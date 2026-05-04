"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { NAV_ITEMS, NO_NAV_PATHS } from "@/lib/constants";
import { useNavBadges } from "@/hooks/use-nav-badges";

export function MobileNav() {
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const badges = useNavBadges();

  const updateScrollIndicators = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  // Auto-scroll active item into view on mount / route change
  useEffect(() => {
    const el = activeRef.current;
    if (el) {
      el.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    }
    // Update indicators after scroll settles
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

  if (NO_NAV_PATHS.includes(pathname as (typeof NO_NAV_PATHS)[number])) {
    return null;
  }

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/95 border-t border-white/[0.12] shadow-[0_-4px_20px_hsl(var(--background)/0.8)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label={tNav("mobile")}
    >
      {/* Scroll fade indicators */}
      <div
        className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 z-10 transition-opacity duration-200"
        aria-hidden="true"
        style={{
          opacity: canScrollLeft ? 1 : 0,
          background: "linear-gradient(to right, hsl(var(--background)), transparent)",
        }}
      />
      <div
        className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 z-10 transition-opacity duration-200"
        aria-hidden="true"
        style={{
          opacity: canScrollRight ? 1 : 0,
          background: "linear-gradient(to left, hsl(var(--background)), transparent)",
        }}
      />

      <div
        ref={scrollRef}
        className="flex items-center overflow-x-auto scrollbar-hide px-2 py-2 gap-1 overscroll-x-contain touch-pan-x"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              ref={isActive ? activeRef : undefined}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              aria-label={tNav(item.labelKey)}
              className={`relative flex flex-col items-center justify-center p-2 rounded-lg transition-all min-w-[4rem] min-h-[3rem] flex-shrink-0 active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-month-primary/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
                isActive
                  ? "text-month-primary bg-month-primary/10 shadow-[0_0_12px_hsl(var(--month-primary)/0.15)]"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
              }`}
            >
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-month-primary" />
              )}
              <span className="relative">
                <Icon className={`size-5 transition-transform ${isActive ? "scale-110" : ""}`} />
                {badges[item.href] && !isActive && (
                  <span
                    className="absolute -top-1.5 -right-2 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-month-primary text-[10px] font-bold text-month-primary-foreground px-1 shadow-[0_0_6px_hsl(var(--month-primary)/0.4)]"
                    aria-label={tCommon("newEntriesAria", { count: badges[item.href] })}
                  >
                    {badges[item.href]}
                  </span>
                )}
              </span>
              <span className={`text-[11px] mt-1 ${isActive ? "font-semibold" : "font-medium"}`}>
                {tNav(item.labelKey)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
