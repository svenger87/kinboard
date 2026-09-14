"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
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
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${className}`}
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
