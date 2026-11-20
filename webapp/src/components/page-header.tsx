"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { settingsBackHref } from "@/lib/constants";

interface PageHeaderProps {
  /** Lucide icon rendered in the standard tinted container. Ignored if `iconSlot` is provided. */
  icon?: LucideIcon;
  /** Custom visual that replaces the standard icon container entirely (e.g. a progress ring SVG). */
  iconSlot?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  backHref?: string;
  /**
   * Names where `backHref` goes, for assistive tech and the tooltip.
   *
   * Settings sub-pages receive their parent destination automatically. Supply
   * this label with an explicit `backHref` on other page hierarchies.
   */
  backLabel?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  icon: Icon,
  iconSlot,
  title,
  subtitle,
  backHref,
  backLabel,
  actions,
  className = "",
}: PageHeaderProps) {
  const t = useTranslations("components");
  const settingsT = useTranslations("settings");
  const pathname = usePathname();
  const settingsBack = pathname.startsWith("/settings/")
    ? settingsBackHref(pathname)
    : undefined;
  const resolvedBackHref = backHref ?? settingsBack;
  const resolvedBackLabel = backLabel ?? (settingsBack ? settingsT("layoutBackLabel") : undefined);
  // Settings sub-pages keep their header (back button and name) in view while
  // a long page scrolls (#282). It gets its backdrop only once it is stuck, so
  // at rest it looks exactly as before.
  const sticky = settingsBack !== undefined;
  const stuck = useStuck(sticky);
  return (
    <motion.div
      ref={stuck.ref}
      data-stuck={stuck.value ? "" : undefined}
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
        sticky
          ? "sticky top-[env(safe-area-inset-top,0px)] z-30 -mx-3 rounded-b-xl px-3 py-2 transition-[background-color,box-shadow] duration-200 data-[stuck]:bg-background data-[stuck]:shadow-sm"
          : ""
      } ${className}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {resolvedBackHref && (
          <Link href={resolvedBackHref} title={resolvedBackLabel}>
            <Button variant="ghost" size="icon" className="shrink-0" aria-label={resolvedBackLabel ?? t("back")}>
              <ChevronLeft className="size-5" />
            </Button>
          </Link>
        )}
        {iconSlot ?? (
          Icon && (
            <div className="p-2.5 rounded-xl bg-month-primary/10 shrink-0">
              <Icon className="size-6 text-month-primary" strokeWidth={1.5} />
            </div>
          )
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-display font-light truncate">{title}</h1>
          {subtitle && (
            <div className="text-sm text-muted-foreground truncate">{subtitle}</div>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center justify-end gap-2 w-full sm:w-auto">{actions}</div>
      )}
    </motion.div>
  );
}

/**
 * Whether a sticky element is currently held at the top of the viewport, i.e.
 * the page has scrolled past its resting place. Read on scroll, throttled to
 * one check per frame.
 */
function useStuck(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const top = parseFloat(getComputedStyle(el).top) || 0;
      setValue(window.scrollY > 0 && el.getBoundingClientRect().top <= top + 1);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [enabled]);
  return { ref, value };
}
